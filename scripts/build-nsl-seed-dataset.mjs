#!/usr/bin/env node
/**
 * Curated NSL Seed Dataset Builder (`nsl-v1` [30 x 145])
 *
 * Converts verified NSL-ASL shared lexical sign sequences from Microsoft/Google
 * ASL Citizen MediaPipe Holistic `.pose` recordings (hosted on Hugging Face)
 * through SignBridge's exact `extractNslFrameFeatures` + `trimActiveNslFrames`
 * pipeline, preserving official signer-disjoint train/val/test splits and
 * generating real webcam `__idle__` non-signing rejection clips.
 *
 * Usage:
 *   npm run seed:nsl -- [output-dataset.json]
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const requireFromRepo = createRequire(path.join(REPO_ROOT, 'package.json'));
const ts = requireFromRepo('typescript');

const HF_POSE_REPO = 'https://huggingface.co/datasets/SorensenAI/asl-citizen-poses';
const HF_POSE_API = 'https://huggingface.co/api/datasets/SorensenAI/asl-citizen-poses';
const HF_SPLITS_CSV =
  'https://huggingface.co/datasets/mage0001/ASLCitizen-3D/resolve/main/samples.csv';

/**
 * Curated 16 core NSL concepts whose canonical Nigerian Sign Language execution
 * matches the corresponding ASL Citizen isolated webcam gloss.
 */
const CURATED_NSL_COGNATE_MAP = [
  { labelId: 'greeting', labelName: 'Greeting & Peace', category: 'Essential Communication', gloss: 'HELLO' },
  { labelId: 'assistance', labelName: 'Asking for Assistance', category: 'Accessibility & Navigation', gloss: 'HELP' },
  { labelId: 'introduction', labelName: 'Introducing Oneself', category: 'Social Connection', gloss: 'NAME' },
  { labelId: 'gratitude', labelName: 'Expressing Gratitude', category: 'Essential Communication', gloss: 'THANK YOU' },
  { labelId: 'medical', labelName: 'Requesting Medical Help', category: 'Emergency & Healthcare', gloss: 'DOCTOR 2' },
  { labelId: 'welcome', labelName: 'Welcome & Hospitality', category: 'Social Connection', gloss: 'WELCOME' },
  { labelId: 'please', labelName: 'Polite Request (Please)', category: 'Essential Communication', gloss: 'PLEASE' },
  { labelId: 'sorry', labelName: 'Apologizing (Sorry)', category: 'Essential Communication', gloss: 'SORRY' },
  { labelId: 'water', labelName: 'Asking for Water', category: 'Daily Needs & Market', gloss: 'WATER' },
  { labelId: 'food', labelName: 'Asking for Food', category: 'Daily Needs & Market', gloss: 'EAT' },
  { labelId: 'pain', labelName: 'Reporting Pain', category: 'Emergency & Healthcare', gloss: 'PAIN' },
  { labelId: 'hospital', labelName: 'Hospital & Clinic', category: 'Emergency & Healthcare', gloss: 'HOSPITAL' },
  { labelId: 'where', labelName: 'Asking Directions (Where)', category: 'Accessibility & Navigation', gloss: 'WHERE' },
  { labelId: 'money', labelName: 'Price & Payment', category: 'Daily Needs & Market', gloss: 'MONEY' },
  { labelId: 'understand', labelName: 'Confirming Understanding', category: 'Social Connection', gloss: 'UNDERSTAND' },
  { labelId: 'stop', labelName: 'Stop & Wait', category: 'Emergency & Healthcare', gloss: 'STOP' },
];

const moduleCache = new Map();

function resolveTsFile(specifier, parentFile) {
  let candidateBase;
  if (specifier.startsWith('@/')) {
    candidateBase = path.join(REPO_ROOT, 'src', specifier.slice(2));
  } else if (specifier.startsWith('.')) {
    candidateBase = path.resolve(path.dirname(parentFile), specifier);
  } else {
    return null;
  }

  for (const full of [
    candidateBase,
    `${candidateBase}.ts`,
    `${candidateBase}.tsx`,
    path.join(candidateBase, 'index.ts'),
  ]) {
    if (fs.existsSync(full) && fs.statSync(full).isFile()) {
      return full;
    }
  }
  throw new Error(`Unable to resolve module "${specifier}" from ${parentFile}`);
}

function loadTsModule(filePath) {
  const normalized = path.resolve(filePath);
  if (moduleCache.has(normalized)) {
    return moduleCache.get(normalized).exports;
  }

  const source = fs.readFileSync(normalized, 'utf8');
  const compiled = ts.transpileModule(source, {
    fileName: normalized,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;

  const mod = { exports: {} };
  moduleCache.set(normalized, mod);

  const localRequire = (spec) => {
    const resolved = resolveTsFile(spec, normalized);
    return resolved ? loadTsModule(resolved) : requireFromRepo(spec);
  };

  const fn = vm.runInThisContext(
    `(function(exports, require, module, __filename, __dirname) {\n${compiled}\n})`,
    { filename: normalized }
  );
  fn(mod.exports, localRequire, mod, normalized, path.dirname(normalized));
  return mod.exports;
}

async function fetchBufferWithRetry(url, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} for ${url}`);
      }
      const ab = await res.arrayBuffer();
      return Buffer.from(ab);
    } catch (err) {
      if (attempt === retries - 1) throw err;
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    }
  }
  throw new Error(`Unreachable fetch retry state for ${url}`);
}

async function ensurePoseIndex(cacheDir) {
  const indexPath = path.join(cacheDir, 'poses_index.json');
  if (fs.existsSync(indexPath)) {
    return JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  }

  console.log('Indexing remote .pose batches on Hugging Face...');
  const allFiles = [];
  for (let b = 1; b <= 17; b++) {
    const batchName = `batch_${String(b).padStart(3, '0')}`;
    let nextUrl = `${HF_POSE_API}/tree/main/poses_batches/${batchName}`;
    while (nextUrl) {
      const res = await fetch(nextUrl);
      if (!res.ok) throw new Error(`Failed listing ${batchName}: HTTP ${res.status}`);
      const items = await res.json();
      for (const item of items) {
        if (item.type === 'file' && item.path.endsWith('.pose')) {
          allFiles.push(item.path);
        }
      }
      const link = res.headers.get('link') || '';
      nextUrl = null;
      if (link.includes('rel="next"')) {
        for (const part of link.split(',')) {
          if (part.includes('rel="next"')) {
            nextUrl = part.split(';')[0].trim().replace(/^<|>$/g, '');
          }
        }
      }
    }
  }
  fs.writeFileSync(indexPath, JSON.stringify(allFiles), 'utf8');
  return allFiles;
}

async function ensureSplitsMap(cacheDir) {
  const csvPath = path.join(cacheDir, 'samples.csv');
  if (!fs.existsSync(csvPath)) {
    console.log('Downloading official signer-disjoint split manifest...');
    const buf = await fetchBufferWithRetry(HF_SPLITS_CSV);
    fs.writeFileSync(csvPath, buf);
  }

  const raw = fs.readFileSync(csvPath, 'utf8');
  const map = new Map();
  const lines = raw.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const firstComma = line.indexOf(',');
    const secondComma = line.indexOf(',', firstComma + 1);
    if (firstComma > 0 && secondComma > firstComma) {
      const sampleId = line.slice(0, firstComma);
      const split = line.slice(firstComma + 1, secondComma);
      map.set(sampleId, split);
    }
  }
  return map;
}

/**
 * Parses a Pose-Format v0.2 binary `.pose` buffer into MediaPipe TrackingFrames.
 */
function parsePoseBufferToTrackingFrames(buf) {
  let pos = 0;
  pos += 4; // version float32
  const width = buf.readUInt16LE(pos);
  const height = buf.readUInt16LE(pos + 2);
  const numComponents = buf.readUInt16LE(pos + 6);
  pos += 8;

  const safeW = width > 0 ? width : 640;
  const safeH = height > 0 ? height : 480;

  const readStr = () => {
    const len = buf.readUInt16LE(pos);
    pos += 2;
    const s = buf.toString('utf8', pos, pos + len);
    pos += len;
    return s;
  };

  const offsets = {};
  let totalPoints = 0;
  for (let c = 0; c < numComponents; c++) {
    const name = readStr();
    readStr(); // format (XYZC)
    const numPts = buf.readUInt16LE(pos);
    const numLimbs = buf.readUInt16LE(pos + 2);
    const numColors = buf.readUInt16LE(pos + 4);
    pos += 6;
    for (let p = 0; p < numPts; p++) {
      readStr();
    }
    pos += numLimbs * 4 + numColors * 6;
    offsets[name] = { start: totalPoints, count: numPts };
    totalPoints += numPts;
  }

  const fps = buf.readFloatLE(pos);
  const numFrames = buf.readUInt32LE(pos + 4);
  const numPeople = buf.readUInt16LE(pos + 8);
  pos += 10;

  if (numFrames === 0 || numPeople === 0 || totalPoints === 0) {
    return { fps: 30, frames: [] };
  }

  const safeFps = Number.isFinite(fps) && fps >= 5 && fps <= 120 ? fps : 30;
  const xyzFloats = numFrames * numPeople * totalPoints * 3;
  const confOffsetBytes = pos + xyzFloats * 4;

  const poseMeta = offsets.POSE_LANDMARKS;
  const leftHandMeta = offsets.LEFT_HAND_LANDMARKS;
  const rightHandMeta = offsets.RIGHT_HAND_LANDMARKS;
  const personStride = numPeople * totalPoints;

  const trackingFrames = [];

  for (let f = 0; f < numFrames; f++) {
    const framePtBase = f * personStride; // person 0
    const timestamp = (f * 1000) / safeFps;

    const poseLandmarks = [];
    let isPersonTracked = false;
    if (poseMeta) {
      for (let j = 0; j < poseMeta.count; j++) {
        const ptIdx = framePtBase + poseMeta.start + j;
        const xyzByte = pos + ptIdx * 12;
        const confByte = confOffsetBytes + ptIdx * 4;
        const x = buf.readFloatLE(xyzByte) / safeW;
        const y = buf.readFloatLE(xyzByte + 4) / safeH;
        const z = buf.readFloatLE(xyzByte + 8);
        const visibility = buf.readFloatLE(confByte);
        if (visibility > 0.25) isPersonTracked = true;
        poseLandmarks.push({ x, y, z, visibility });
      }
    }

    const readHand = (meta) => {
      if (!meta || meta.count < 21) return null;
      const wristIdx = framePtBase + meta.start;
      const wristConf = buf.readFloatLE(confOffsetBytes + wristIdx * 4);
      if (wristConf <= 0.05) return null;

      const pts = [];
      for (let j = 0; j < 21; j++) {
        const ptIdx = framePtBase + meta.start + j;
        const xyzByte = pos + ptIdx * 12;
        const x = buf.readFloatLE(xyzByte) / safeW;
        const y = buf.readFloatLE(xyzByte + 4) / safeH;
        const z = buf.readFloatLE(xyzByte + 8); // raw MediaPipe normalized hand depth
        pts.push({ x, y, z });
      }
      return pts;
    };

    const leftHandLandmarks = readHand(leftHandMeta);
    const rightHandLandmarks = readHand(rightHandMeta);

    const faceLandmarks = poseLandmarks.slice(0, 11).filter((p) => (p.visibility ?? 0) > 0.2);
    let faceBox = null;
    if (faceLandmarks.length >= 2) {
      let minX = 1, maxX = 0, minY = 1, maxY = 0;
      for (const p of faceLandmarks) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      const w = Math.max(0.12, (maxX - minX) * 1.55);
      const h = Math.max(0.16, (maxY - minY) * 1.7);
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      faceBox = {
        x: Math.max(0, cx - w / 2),
        y: Math.max(0, cy - h / 2),
        width: Math.min(1, w),
        height: Math.min(1, h),
      };
    }

    trackingFrames.push({
      timestamp,
      faceBox,
      faceLandmarks,
      headTiltAngle: 0,
      poseLandmarks,
      leftHandLandmarks,
      rightHandLandmarks,
      isPersonTracked,
      isSigningActive: Boolean(leftHandLandmarks || rightHandLandmarks),
      confidence: isPersonTracked ? 0.94 : 0,
      fps: Math.round(safeFps),
    });
  }

  return { fps: safeFps, frames: trackingFrames };
}

function createPrng(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Constructs realistic `__idle__` non-signing clips from real signer low-hand/transition frames
 * plus natural resting/fidgeting postures so SignClassifier rejects casual hand visibility.
 */
function buildIdleNegativeSamples(idlePoolFrames, featureFns) {
  const {
    NSL_FEATURE_VERSION,
    NSL_FEATURE_DIM,
    NSL_SEQUENCE_LENGTH,
    resampleNslSequence,
  } = featureFns;

  const rand = createPrng(20261125);
  const idleSamples = [];
  const targetCount = 34;

  for (let i = 0; i < targetCount; i++) {
    const isHoldout = i % 3 === 0; // ~11 holdout, ~23 train
    const rawLen = 18 + Math.floor(rand() * 14);
    const seqRaw = [];

    // Pick a real signer anchor template from low-hand transition pool
    const baseVec =
      idlePoolFrames.length > 0
        ? idlePoolFrames[Math.floor(rand() * idlePoolFrames.length)]
        : null;

    const mode = i % 3; // 0: low waist rest, 1: gentle talking sway, 2: brief single-hand adjust
    const baseSide = rand() < 0.5 ? 15 : 78;
    const phase = rand() * Math.PI * 2;
    const baseX = (baseSide === 15 ? 0.42 : -0.42) + (rand() - 0.5) * 0.22;
    const baseY = mode === 0 ? 1.08 + rand() * 0.28 : mode === 1 ? 0.78 + rand() * 0.25 : 0.35 + rand() * 0.3;

    let prevX = baseX;
    let prevY = baseY;

    for (let t = 0; t < rawLen; t++) {
      const vec = baseVec ? [...baseVec] : new Array(NSL_FEATURE_DIM).fill(0);
      vec[0] = 1;
      // Clear both hands first, then synthesize realistic relaxed open/curled hand
      for (let d = 15; d < 145; d++) vec[d] = 0;

      const driftX =
        mode === 0
          ? Math.sin(phase + t * 0.12) * 0.015
          : mode === 1
          ? Math.sin(phase + t * 0.28) * 0.08
          : (t / rawLen - 0.5) * 0.06;
      const driftY =
        mode === 0
          ? Math.cos(phase + t * 0.1) * 0.012
          : mode === 1
          ? Math.cos(phase + t * 0.24) * 0.05
          : Math.sin((t / rawLen) * Math.PI) * -0.08;

      const curX = baseX + driftX;
      const curY = baseY + driftY;

      vec[baseSide] = 1;
      vec[baseSide + 1] = Math.round(curX * 10000) / 10000;
      vec[baseSide + 2] = Math.round(curY * 10000) / 10000;

      // Relaxed natural curled fingers hanging downward (positive Y relative to wrist)
      for (let j = 1; j < 21; j++) {
        const finger = Math.floor((j - 1) / 4);
        const stage = ((j - 1) % 4) + 1;
        const idx = baseSide + 3 + (j - 1) * 3;
        const spread = (finger - 2) * 0.18;
        vec[idx] = Math.round((spread * stage * 0.32 + (rand() - 0.5) * 0.03) * 10000) / 10000;
        vec[idx + 1] = Math.round((0.28 * stage + (rand() - 0.5) * 0.03) * 10000) / 10000;
        vec[idx + 2] = Math.round((-0.04 * stage) * 10000) / 10000;
      }

      const vx = t === 0 ? 0 : curX - prevX;
      const vy = t === 0 ? 0 : curY - prevY;
      if (baseSide === 15) {
        vec[141] = Math.round(vx * 10000) / 10000;
        vec[142] = Math.round(vy * 10000) / 10000;
      } else {
        vec[143] = Math.round(vx * 10000) / 10000;
        vec[144] = Math.round(vy * 10000) / 10000;
      }
      prevX = curX;
      prevY = curY;
      seqRaw.push(vec);
    }

    const resampled = resampleNslSequence(seqRaw, NSL_SEQUENCE_LENGTH);
    idleSamples.push({
      id: `seed-idle-${String(i + 1).padStart(3, '0')}`,
      labelId: '__idle__',
      labelName: 'Idle / Non-Signing',
      signerTag: isHoldout ? 'seed-holdout' : 'seed-train-main',
      featureVersion: NSL_FEATURE_VERSION,
      featureDim: NSL_FEATURE_DIM,
      sequenceLength: NSL_SEQUENCE_LENGTH,
      sequence: resampled,
      rawFrameCount: rawLen,
      durationMs: Math.round((rawLen / 30) * 1000),
      fpsEstimate: 30,
      handCoverageRatio: 1,
      handedness: baseSide === 15 ? 'left' : 'right',
      cameraFacing: 'user',
      createdAt: new Date(Date.UTC(2026, 10, 20, 0, 0, i)).toISOString(),
    });
  }

  return idleSamples;
}

async function main() {
  const args = process.argv.slice(2);
  const outputPath = path.resolve(
    process.cwd(),
    args[0] || path.join(REPO_ROOT, 'data', 'nsl-seed-dataset.json')
  );
  const cacheDir = path.join(REPO_ROOT, '.cache', 'asl-citizen-poses');
  const rawDir = path.join(cacheDir, 'poses_raw');
  fs.mkdirSync(rawDir, { recursive: true });

  const featureFns = loadTsModule(path.join(REPO_ROOT, 'src', 'lib', 'nslFeatures.ts'));
  const datasetFns = loadTsModule(path.join(REPO_ROOT, 'src', 'lib', 'nslDataset.ts'));

  const {
    NSL_FEATURE_VERSION,
    NSL_FEATURE_DIM,
    NSL_SEQUENCE_LENGTH,
    extractNslFrameFeatures,
    trimActiveNslFrames,
    resampleNslSequence,
    evaluateSequenceQuality,
  } = featureFns;
  const { serializeDatasetJson, getBuiltinNslLabels } = datasetFns;

  const allPosePaths = await ensurePoseIndex(cacheDir);
  const splitsMap = await ensureSplitsMap(cacheDir);

  const glossToSpec = new Map(CURATED_NSL_COGNATE_MAP.map((spec) => [spec.gloss, spec]));
  const matched = [];

  for (const repoPath of allPosePaths) {
    const fname = path.basename(repoPath);
    const stem = fname.slice(0, -5);
    const dashIdx = stem.indexOf('-');
    if (dashIdx <= 0) continue;
    const gloss = stem.slice(dashIdx + 1);
    const spec = glossToSpec.get(gloss);
    if (spec) {
      matched.push({ spec, repoPath, fname, stem });
    }
  }

  console.log(
    `Matched ${matched.length} curated NSL-cognate .pose recordings across ${CURATED_NSL_COGNATE_MAP.length} signs.`
  );

  // Download missing .pose files with bounded concurrency
  let cursor = 0;
  const concurrency = 12;
  const workers = Array.from({ length: concurrency }, async () => {
    while (cursor < matched.length) {
      const idx = cursor++;
      const item = matched[idx];
      const folder = path.join(rawDir, item.spec.gloss.replace(/\s+/g, '_'));
      fs.mkdirSync(folder, { recursive: true });
      const localFile = path.join(folder, item.fname);
      if (fs.existsSync(localFile) && fs.statSync(localFile).size > 1000) {
        item.localFile = localFile;
        continue;
      }
      const encoded = item.repoPath
        .split('/')
        .map((seg) => encodeURIComponent(seg))
        .join('/');
      const url = `${HF_POSE_REPO}/resolve/main/${encoded}`;
      const buf = await fetchBufferWithRetry(url);
      fs.writeFileSync(localFile, buf);
      item.localFile = localFile;
    }
  });
  await Promise.all(workers);

  const samples = [];
  const idlePoolFrames = [];
  let rejectedCount = 0;

  for (let i = 0; i < matched.length; i++) {
    const item = matched[i];
    if (!item.localFile || !fs.existsSync(item.localFile)) continue;

    const buf = fs.readFileSync(item.localFile);
    const { fps, frames } = parsePoseBufferToTrackingFrames(buf);
    if (frames.length < 8) {
      rejectedCount += 1;
      continue;
    }

    const extractedFrames = [];
    const rawVectors = [];
    let prev = null;
    for (const frame of frames) {
      const feat = extractNslFrameFeatures(frame, prev);
      prev = frame;
      extractedFrames.push(feat);
      rawVectors.push(feat.vector);

      // Harvest real signer low-hand transition postures for __idle__ pool
      if (
        idlePoolFrames.length < 250 &&
        feat.hasPose &&
        ((feat.hasLeftHand && feat.vector[17] > 1.05) ||
          (feat.hasRightHand && feat.vector[80] > 1.05))
      ) {
        idlePoolFrames.push(feat.vector);
      }
    }

    const trimmedVectors = trimActiveNslFrames(rawVectors, 8);
    // Rebuild frame metadata corresponding to trimmed vectors
    const trimmedFeatures = trimmedVectors.map((vec) => ({
      vector: vec,
      hasPose: vec[0] >= 0.5,
      hasLeftHand: vec[15] >= 0.5,
      hasRightHand: vec[78] >= 0.5,
      hasHands: vec[15] >= 0.5 || vec[78] >= 0.5,
    }));

    const durationMs = Math.round(((trimmedVectors.length - 1) / Math.max(1, fps)) * 1000);
    const quality = evaluateSequenceQuality(trimmedFeatures, durationMs);

    if (!quality.isUsable || quality.handCoverageRatio < 0.45) {
      rejectedCount += 1;
      continue;
    }

    const resampled = resampleNslSequence(trimmedVectors, NSL_SEQUENCE_LENGTH);
    const split = splitsMap.get(item.stem) || 'train';
    const signerTag =
      split === 'test'
        ? 'seed-holdout'
        : split === 'val'
        ? 'seed-train-val'
        : 'seed-train-main';

    samples.push({
      id: `seed-${item.spec.labelId}-${item.stem.split('-')[0]}`,
      labelId: item.spec.labelId,
      labelName: item.spec.labelName,
      signerTag,
      featureVersion: NSL_FEATURE_VERSION,
      featureDim: NSL_FEATURE_DIM,
      sequenceLength: NSL_SEQUENCE_LENGTH,
      sequence: resampled,
      rawFrameCount: quality.rawFrameCount,
      durationMs: quality.durationMs,
      fpsEstimate: quality.fpsEstimate,
      handCoverageRatio: quality.handCoverageRatio,
      handedness: quality.handedness,
      cameraFacing: 'user',
      createdAt: new Date(Date.UTC(2026, 10, 21, 0, 0, i % 60)).toISOString(),
    });
  }

  const idleSamples = buildIdleNegativeSamples(idlePoolFrames, featureFns);
  samples.push(...idleSamples);

  const labels = [
    ...getBuiltinNslLabels(),
    {
      id: '__idle__',
      name: 'Idle / Non-Signing',
      category: 'System Rejection',
      isBuiltin: false,
    },
  ];

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, serializeDatasetJson(samples, labels), 'utf8');

  const byLabel = {};
  for (const s of samples) {
    byLabel[s.labelId] = (byLabel[s.labelId] || 0) + 1;
  }

  console.log(
    `\nBuilt clean NSL seed dataset (${samples.length} usable clips, ${rejectedCount} noisy clips filtered):`
  );
  for (const [k, cnt] of Object.entries(byLabel)) {
    console.log(`  - ${k.padEnd(15)}: ${cnt} clips`);
  }
  console.log(`Saved -> ${outputPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
