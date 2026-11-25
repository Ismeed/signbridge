#!/usr/bin/env node
/**
 * Offline & Hybrid Cloud NSL Sequence Classifier Trainer
 *
 * Trains the on-device neural NSL model from:
 *   1. One or more JSON datasets (e.g. `data/nsl-seed-dataset.json` or `/collect` exports)
 *   2. Directly from the shared Supabase Postgres team dataset (`--supabase`)
 *   3. A hybrid merge of seed JSON + live Supabase team clips (`data/nsl-seed-dataset.json --supabase`),
 *      automatically upweighting native Nigerian contributor clips (2.5x) over seed clips (1.0x).
 *
 * Usage:
 *   npm run train:nsl -- data/nsl-seed-dataset.json [--out public/models/nsl-model.json]
 *   npm run train:nsl -- data/nsl-seed-dataset.json --supabase
 *   npm run train:nsl -- --supabase
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

function loadEnvFiles() {
  for (const filename of ['.env.local', '.env']) {
    const filePath = path.join(REPO_ROOT, filename);
    if (!fs.existsSync(filePath)) continue;
    const raw = fs.readFileSync(filePath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx <= 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) {
        process.env[key] = val;
      }
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  let useSupabase = false;
  let outputArg = null;
  const inputFiles = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--supabase') {
      useSupabase = true;
    } else if (arg === '--out' || arg === '-o') {
      outputArg = args[++i] || null;
    } else {
      inputFiles.push(arg);
    }
  }

  // Backward compatibility: `train:nsl dataset.json output-model.json`
  if (
    !outputArg &&
    inputFiles.length === 2 &&
    inputFiles[1].includes('model') &&
    !fs.existsSync(path.resolve(process.cwd(), inputFiles[1]))
  ) {
    outputArg = inputFiles.pop();
  } else if (!outputArg && useSupabase && inputFiles.length === 1 && !fs.existsSync(path.resolve(process.cwd(), inputFiles[0]))) {
    outputArg = inputFiles.pop();
  }

  if (!useSupabase && inputFiles.length === 0) {
    const defaultSeed = path.join(REPO_ROOT, 'data', 'nsl-seed-dataset.json');
    if (fs.existsSync(defaultSeed)) {
      inputFiles.push(defaultSeed);
    } else {
      console.error(
        'Usage:\n  node scripts/train-nsl-model.mjs <dataset.json> [--out public/models/nsl-model.json]\n  node scripts/train-nsl-model.mjs data/nsl-seed-dataset.json --supabase'
      );
      process.exit(1);
    }
  }

  const outputPath = path.resolve(
    process.cwd(),
    outputArg || path.join(REPO_ROOT, 'public', 'models', 'nsl-model.json')
  );

  const { parseImportedDatasetJson, countSamplesByLabel, normalizeSignerTag } = loadTsModule(
    path.join(REPO_ROOT, 'src', 'lib', 'nslDataset.ts')
  );
  const {
    trainNslModel,
    serializeModelJson,
    parseImportedModelJson,
    predictSequence,
    getVisibleModelClasses,
    NSL_IDLE_CLASS_ID,
  } = loadTsModule(path.join(REPO_ROOT, 'src', 'lib', 'nslModel.ts'));
  const { trimActiveNslFrames, resampleNslSequence, NSL_SEQUENCE_LENGTH } = loadTsModule(
    path.join(REPO_ROOT, 'src', 'lib', 'nslFeatures.ts')
  );

  const mergedById = new Map();
  const sampleWeights = {};

  for (const relPath of inputFiles) {
    const fullPath = path.resolve(process.cwd(), relPath);
    if (!fs.existsSync(fullPath)) {
      console.error(`Dataset file not found: ${fullPath}`);
      process.exit(1);
    }
    const rawJson = fs.readFileSync(fullPath, 'utf8');
    const parsed = parseImportedDatasetJson(rawJson);
    if (!parsed.ok) {
      console.error(`Invalid dataset (${fullPath}): ${parsed.error}`);
      process.exit(1);
    }
    for (const s of parsed.dataset.samples) {
      mergedById.set(s.id, s);
      const isSeed = (s.signerTag || '').startsWith('seed-') || s.id.startsWith('seed-');
      sampleWeights[s.id] = isSeed ? 1.0 : 2.5;
    }
  }

  if (useSupabase) {
    loadEnvFiles();
    const { isCloudDatasetConfigured, fetchAllCloudNslSamples } = loadTsModule(
      path.join(REPO_ROOT, 'src', 'lib', 'supabaseNsl.ts')
    );
    if (!isCloudDatasetConfigured()) {
      console.error(
        'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (set in environment or .env.local).'
      );
      process.exit(1);
    }
    console.log('Fetching native team NSL clips from Supabase...');
    const fetched = await fetchAllCloudNslSamples();
    console.log(`Fetched ${fetched.samples.length} cloud clip(s) from Supabase.`);
    for (const s of fetched.samples) {
      mergedById.set(s.id, s);
      sampleWeights[s.id] = 2.5; // Prioritize native Nigerian contributor clips
    }
  }

  const samples = Array.from(mergedById.values());
  const counts = countSamplesByLabel(samples);
  const uniqueSigners = new Set(
    samples.map((sample) => normalizeSignerTag(sample.signerTag).toLowerCase())
  );
  console.log(
    `Loaded ${samples.length} sample(s) across ${Object.keys(counts).length} class(es) from ${uniqueSigners.size} signer bucket(s):`
  );
  for (const [labelId, count] of Object.entries(counts)) {
    console.log(`  - ${labelId.padEnd(15)}: ${count} clip(s)`);
  }

  const startMs = Date.now();
  const trained = trainNslModel(samples, {
    hiddenDim: 128,
    hiddenDim2: 64,
    epochs: 120,
    augmentFactor: 5,
    sampleWeights,
  });
  if (!trained.ok) {
    console.error(`Training failed: ${trained.error}`);
    process.exit(1);
  }

  const { model } = trained;
  const elapsedMs = Date.now() - startMs;

  const compactJson = serializeModelJson(model, true);
  const roundtrip = parseImportedModelJson(compactJson);
  if (!roundtrip.ok) {
    throw new Error(`Serialized model failed roundtrip validation: ${roundtrip.error}`);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, compactJson, 'utf8');

  // Detailed unseen-signer holdout breakdown
  const holdoutSamples = samples.filter(
    (s) => normalizeSignerTag(s.signerTag).toLowerCase() === 'seed-holdout'
  );
  if (holdoutSamples.length > 0) {
    const perClass = new Map();
    let idleTotal = 0;
    let idleFalsePositives = 0;

    for (const s of holdoutSamples) {
      const seq =
        s.labelId === NSL_IDLE_CLASS_ID
          ? s.sequence
          : resampleNslSequence(trimActiveNslFrames(s.sequence, 10), NSL_SEQUENCE_LENGTH);
      const pred = predictSequence(roundtrip.model, seq);
      const predId = roundtrip.model.classes[pred.topIndex]?.id;
      const stat = perClass.get(s.labelId) || { ok: 0, total: 0 };
      stat.total += 1;
      if (predId === s.labelId) stat.ok += 1;
      perClass.set(s.labelId, stat);

      if (s.labelId === NSL_IDLE_CLASS_ID) {
        idleTotal += 1;
        if (predId !== NSL_IDLE_CLASS_ID && pred.confidence >= 0.56 && pred.margin >= 0.14) {
          idleFalsePositives += 1;
        }
      }
    }

    console.log('\nHeld-Out Unseen Signer Per-Class Recall:');
    for (const [labelId, stat] of perClass.entries()) {
      const pct = ((stat.ok / Math.max(1, stat.total)) * 100).toFixed(1);
      console.log(`  - ${labelId.padEnd(15)}: ${stat.ok}/${stat.total} (${pct}%)`);
    }
    if (idleTotal > 0) {
      console.log(
        `  * Idle False-Trigger Rate: ${idleFalsePositives}/${idleTotal} (${(
          (idleFalsePositives / idleTotal) *
          100
        ).toFixed(1)}%)`
      );
    }
  }

  const visible = getVisibleModelClasses(model);
  const sizeKb = (Buffer.byteLength(compactJson, 'utf8') / 1024).toFixed(1);
  console.log(`\nTraining succeeded in ${(elapsedMs / 1000).toFixed(2)}s:`);
  console.log(`  User-Facing Signs (${visible.length}): ${visible.map((c) => c.name).join(', ')}`);
  console.log(
    `  Split (${model.metrics.splitStrategy ?? 'stratified-clip'}): ${model.metrics.trainCount} train / ${model.metrics.valCount} val (best epoch ${model.metrics.bestEpoch}/${model.metrics.epochs})`
  );
  console.log(
    `  Train Acc: ${(model.metrics.trainAccuracy * 100).toFixed(1)}% | Unseen-Signer Val Acc: ${(
      model.metrics.valAccuracy * 100
    ).toFixed(1)}% | Val Loss: ${model.metrics.bestValLoss}`
  );
  console.log(`  Saved compact model (${sizeKb} KB) -> ${outputPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
