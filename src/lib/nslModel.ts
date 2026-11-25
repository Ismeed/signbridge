import {
  mirrorNslSequence,
  NSL_FEATURE_DIM,
  NSL_FEATURE_VERSION,
  NSL_SEQUENCE_LENGTH,
  resampleNslSequence,
  trimActiveNslFrames,
} from '@/lib/nslFeatures';
import { normalizeSignerTag, type NslRecordedSample } from '@/lib/nslDataset';

export const NSL_MODEL_STORAGE_KEY = 'signbridge_nsl_trained_model_v2';
export const NSL_IDLE_CLASS_ID = '__idle__';
export const NSL_DESCRIPTOR_DIM = NSL_FEATURE_DIM * 5;
const NSL_MODEL_EVENT = 'signbridge:nsl-model';

const PRESENCE_DIMS = new Set<number>([0, 15, 78]);
const WRIST_MOTION_DIMS = [141, 142, 143, 144] as const;

export interface NslModelClass {
  id: string;
  name: string;
}

export interface NslModelMetrics {
  sampleCount: number;
  trainCount: number;
  valCount: number;
  trainAccuracy: number;
  valAccuracy: number;
  splitStrategy?: 'signer-grouped' | 'stratified-clip';
  epochs: number;
  bestEpoch?: number;
  finalLoss: number;
  bestValLoss?: number;
  lossHistory: number[];
  trainedAt: string;
}

export interface NslTrainedModel {
  schema: 'signbridge-nsl-model';
  version: 2;
  featureVersion: typeof NSL_FEATURE_VERSION;
  featureDim: number;
  sequenceLength: number;
  descriptorDim: number;
  hiddenDim: number;
  hiddenDim2: number;
  classes: NslModelClass[];
  scaler: {
    mean: number[];
    std: number[];
  };
  weights: {
    w1: number[];
    b1: number[];
    w2: number[];
    b2: number[];
    w3: number[];
    b3: number[];
  };
  centroids: number[][];
  metrics: NslModelMetrics;
}

export interface SequenceMotionStats {
  handCoverage: number;
  wristMotion: number;
  leftActivity: number;
  rightActivity: number;
}

export interface NslPredictionCandidate {
  id: string;
  name: string;
  probability: number;
}

export interface NslForwardOutput {
  probabilities: number[];
  topIndex: number;
  secondIndex: number;
  confidence: number;
  margin: number;
  cosineSimilarity: number;
  zRms: number;
  candidates: NslPredictionCandidate[];
}

export interface TrainNslOptions {
  hiddenDim?: number;
  hiddenDim2?: number;
  epochs?: number;
  learningRate?: number;
  weightDecay?: number;
  dropoutRate?: number;
  labelSmoothing?: number;
  augmentFactor?: number;
  sampleWeights?: Record<string, number>;
  seed?: number;
}

export type TrainNslResult =
  | { ok: true; model: NslTrainedModel }
  | { ok: false; error: string };

export type ParseModelResult =
  | { ok: true; model: NslTrainedModel }
  | { ok: false; error: string };

let lastModelRaw: string | null | undefined;
let lastModelSnapshot: NslTrainedModel | null = null;

function isBrowserStorageAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function emitModelChanged(): void {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new Event(NSL_MODEL_EVENT));
  }
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function createPrng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussianNoise(rand: () => number): number {
  const u1 = Math.max(rand(), 1e-7);
  const u2 = rand();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Returns user-facing sign classes (excluding internal `__idle__` rejection class). */
export function getVisibleModelClasses(model: NslTrainedModel | null | undefined): NslModelClass[] {
  if (!model) return [];
  return model.classes.filter((cls) => cls.id !== NSL_IDLE_CLASS_ID);
}

/** Measures active signing hand visibility, wrist velocity, and per-hand dominance over a clip. */
export function computeSequenceMotionStats(sequence: number[][]): SequenceMotionStats {
  if (sequence.length === 0) {
    return { handCoverage: 0, wristMotion: 0, leftActivity: 0, rightActivity: 0 };
  }

  let handFrames = 0;
  let motionAccum = 0;
  let leftActivity = 0;
  let rightActivity = 0;

  for (const row of sequence) {
    const hasL = (row[15] ?? 0) >= 0.5;
    const hasR = (row[78] ?? 0) >= 0.5;
    if (hasL || hasR) {
      handFrames += 1;
    }

    const lSpeed = Math.hypot(row[141] ?? 0, row[142] ?? 0);
    const rSpeed = Math.hypot(row[143] ?? 0, row[144] ?? 0);

    if (hasL) leftActivity += 1 + lSpeed * 4;
    if (hasR) rightActivity += 1 + rSpeed * 4;

    let speedSq = 0;
    for (const dim of WRIST_MOTION_DIMS) {
      const val = row[dim] ?? 0;
      speedSq += val * val;
    }
    motionAccum += Math.sqrt(speedSq);
  }

  return {
    handCoverage: handFrames / sequence.length,
    wristMotion: motionAccum / sequence.length,
    leftActivity: leftActivity / sequence.length,
    rightActivity: rightActivity / sequence.length,
  };
}

/** Aligns dominant hand activity to the right-hand slot for prototype centroid averaging. */
export function alignDominantRight(sequence: number[][]): number[][] {
  const stats = computeSequenceMotionStats(sequence);
  return stats.leftActivity > stats.rightActivity + 0.02 ? mirrorNslSequence(sequence) : sequence;
}

/**
 * Summarizes a [30 x 145] NSL feature clip into a fixed 725-dim spatio-temporal vector:
 * 4 temporal-quartile segment means (Q1/Q2/Q3/Q4 -> [0..579]) + whole-clip std dev ([580..724]).
 */
export function extractSequenceDescriptor(sequence: number[][]): number[] {
  const descriptor = new Array<number>(NSL_DESCRIPTOR_DIM).fill(0);
  if (sequence.length === 0) return descriptor;

  const len = sequence.length;
  const q1 = Math.max(1, Math.floor(len * 0.25));
  const q2 = Math.max(q1 + 1, Math.floor(len * 0.5));
  const q3 = Math.max(q2 + 1, Math.floor(len * 0.75));
  const bounds: Array<[number, number]> = [
    [0, q1],
    [q1, Math.min(len, q2)],
    [Math.min(len, q2), Math.min(len, q3)],
    [Math.min(len, q3), len],
  ];

  // 4 Quartile segment means ([0..579])
  for (let seg = 0; seg < 4; seg++) {
    const [start, end] = bounds[seg];
    const count = Math.max(1, end - start);
    const outOffset = seg * NSL_FEATURE_DIM;

    for (let t = start; t < end; t++) {
      const row = sequence[t];
      for (let d = 0; d < NSL_FEATURE_DIM; d++) {
        const val = row[d];
        if (Number.isFinite(val)) {
          descriptor[outOffset + d] += val / count;
        }
      }
    }
  }

  // Whole-clip temporal std dev ([580..724])
  const globalMean = new Array<number>(NSL_FEATURE_DIM).fill(0);
  for (const row of sequence) {
    for (let d = 0; d < NSL_FEATURE_DIM; d++) {
      const val = row[d];
      if (Number.isFinite(val)) {
        globalMean[d] += val / len;
      }
    }
  }

  const stdOffset = 4 * NSL_FEATURE_DIM;
  for (const row of sequence) {
    for (let d = 0; d < NSL_FEATURE_DIM; d++) {
      const val = Number.isFinite(row[d]) ? row[d] : 0;
      const diff = val - globalMean[d];
      descriptor[stdOffset + d] += (diff * diff) / len;
    }
  }

  for (let d = 0; d < NSL_FEATURE_DIM; d++) {
    descriptor[stdOffset + d] = Math.sqrt(descriptor[stdOffset + d]);
  }

  return descriptor;
}

function rotate2DPair(row: number[], xIdx: number, yIdx: number, cosA: number, sinA: number): void {
  const x = row[xIdx] ?? 0;
  const y = row[yIdx] ?? 0;
  row[xIdx] = Math.max(-4, Math.min(4, x * cosA - y * sinA));
  row[yIdx] = Math.max(-4, Math.min(4, x * sinA + y * cosA));
}

function rotateFrame2D(row: number[], cosA: number, sinA: number): void {
  if ((row[0] ?? 0) >= 0.5) {
    for (let cursor = 1; cursor <= 13; cursor += 2) {
      rotate2DPair(row, cursor, cursor + 1, cosA, sinA);
    }
  }
  for (const handOffset of [15, 78]) {
    if ((row[handOffset] ?? 0) >= 0.5) {
      rotate2DPair(row, handOffset + 1, handOffset + 2, cosA, sinA);
      for (let j = 1; j < 21; j++) {
        const idx = handOffset + 3 + (j - 1) * 3;
        rotate2DPair(row, idx, idx + 1, cosA, sinA);
      }
    }
  }
  rotate2DPair(row, 141, 142, cosA, sinA);
  rotate2DPair(row, 143, 144, cosA, sinA);
}

function augmentSequence(sequence: number[][], rand: () => number): number[][] {
  // 50% anatomical horizontal mirror (chirality invariance)
  const base = rand() < 0.5 ? mirrorNslSequence(sequence) : sequence;
  const len = base.length;

  // Temporal sub-window crop (0.76x .. 1.0x) to bridge 3s studio clips and 1.8s live windows
  const trimMax = Math.max(1, Math.floor(len * 0.22));
  const startOffset = Math.floor(rand() * (trimMax + 1));
  const endOffset = len - Math.floor(rand() * (Math.floor(trimMax * 0.7) + 1));
  const safeSlice =
    endOffset - startOffset >= 10 ? base.slice(startOffset, endOffset) : base;
  const warped = resampleNslSequence(safeSlice, NSL_SEQUENCE_LENGTH);

  const scaleFactor = 0.91 + rand() * 0.18;
  const noiseStd = 0.016;
  const angleRad = (rand() * 2 - 1) * ((8 * Math.PI) / 180);
  const cosA = Math.cos(angleRad);
  const sinA = Math.sin(angleRad);

  // Simulate 1-3 frames of MediaPipe motion-blur hand dropout with p=0.28
  const dropStart = rand() < 0.28 ? Math.floor(rand() * (NSL_SEQUENCE_LENGTH - 2)) : -1;
  const dropLen = dropStart >= 0 ? 1 + Math.floor(rand() * 2) : 0;

  return warped.map((row, tIdx) => {
    const out = row.map((val, dim) => {
      if (PRESENCE_DIMS.has(dim)) {
        return val >= 0.5 ? 1 : 0;
      }
      const perturbed = val * scaleFactor + gaussianNoise(rand) * noiseStd;
      return Math.max(-4, Math.min(4, perturbed));
    });

    rotateFrame2D(out, cosA, sinA);

    if (dropStart >= 0 && tIdx >= dropStart && tIdx < dropStart + dropLen) {
      for (let d = 15; d < 141; d++) {
        out[d] = 0;
      }
    }

    return out;
  });
}

function standardizeDescriptor(
  descriptor: number[],
  mean: number[],
  std: number[]
): Float64Array {
  const out = new Float64Array(descriptor.length);
  for (let d = 0; d < descriptor.length; d++) {
    const z = (descriptor[d] - mean[d]) / std[d];
    out[d] = Math.max(-6, Math.min(6, Number.isFinite(z) ? z : 0));
  }
  return out;
}

function normalizeUnit(vec: Float64Array): number[] {
  let normSq = 0;
  for (let i = 0; i < vec.length; i++) {
    normSq += vec[i] * vec[i];
  }
  const norm = Math.sqrt(normSq);
  if (norm < 1e-8) {
    return new Array<number>(vec.length).fill(0);
  }
  const out = new Array<number>(vec.length);
  for (let i = 0; i < vec.length; i++) {
    out[i] = vec[i] / norm;
  }
  return out;
}

function cosineDot(zVec: Float64Array, unitCentroid: number[]): number {
  let normSq = 0;
  let dot = 0;
  for (let i = 0; i < zVec.length; i++) {
    normSq += zVec[i] * zVec[i];
    dot += zVec[i] * (unitCentroid[i] ?? 0);
  }
  const norm = Math.sqrt(normSq);
  if (norm < 1e-8) return 0;
  return dot / norm;
}

function forwardStandardized(
  model: NslTrainedModel,
  z: Float64Array
): { probabilities: number[]; zRms: number } {
  const D = model.descriptorDim;
  const H1 = model.hiddenDim;
  const H2 = model.hiddenDim2;
  const C = model.classes.length;
  const { w1, b1, w2, b2, w3, b3 } = model.weights;

  const h1 = new Float64Array(H1);
  for (let k = 0; k < H1; k++) {
    let sum = b1[k];
    const rowOff = k * D;
    for (let d = 0; d < D; d++) {
      sum += z[d] * w1[rowOff + d];
    }
    h1[k] = sum > 0 ? sum : 0;
  }

  const h2 = new Float64Array(H2);
  for (let j = 0; j < H2; j++) {
    let sum = b2[j];
    const rowOff = j * H1;
    for (let k = 0; k < H1; k++) {
      sum += h1[k] * w2[rowOff + k];
    }
    h2[j] = sum > 0 ? sum : 0;
  }

  const logits = new Float64Array(C);
  let maxLogit = -Infinity;
  for (let c = 0; c < C; c++) {
    let sum = b3[c];
    const rowOff = c * H2;
    for (let j = 0; j < H2; j++) {
      sum += h2[j] * w3[rowOff + j];
    }
    logits[c] = sum;
    if (sum > maxLogit) maxLogit = sum;
  }

  const probabilities = new Array<number>(C);
  let expSum = 0;
  for (let c = 0; c < C; c++) {
    const e = Math.exp(logits[c] - maxLogit);
    probabilities[c] = e;
    expSum += e;
  }
  for (let c = 0; c < C; c++) {
    probabilities[c] /= expSum > 0 ? expSum : 1;
  }

  let zNormSq = 0;
  for (let d = 0; d < z.length; d++) {
    zNormSq += z[d] * z[d];
  }
  const zRms = Math.sqrt(zNormSq / Math.max(1, z.length));

  return { probabilities, zRms };
}

function summarizePredictions(
  model: NslTrainedModel,
  probabilities: number[],
  cosineSimilarity: number,
  zRms: number
): NslForwardOutput {
  const ranked = model.classes
    .map((cls, idx) => ({
      idx,
      id: cls.id,
      name: cls.name,
      probability: probabilities[idx],
    }))
    .sort((a, b) => b.probability - a.probability);

  const top = ranked[0];
  const second = ranked[1] ?? top;

  const visibleCandidates = ranked
    .filter((item) => item.id !== NSL_IDLE_CLASS_ID)
    .slice(0, 3)
    .map((item) => ({
      id: item.id,
      name: item.name,
      probability: item.probability,
    }));

  return {
    probabilities,
    topIndex: top.idx,
    secondIndex: second.idx,
    confidence: top.probability,
    margin: ranked.length > 1 ? top.probability - second.probability : top.probability,
    cosineSimilarity,
    zRms,
    candidates: visibleCandidates,
  };
}

/** Runs forward neural pass and centroid similarity scoring on a single descriptor. */
export function predictDescriptor(
  model: NslTrainedModel,
  descriptor: number[]
): NslForwardOutput {
  const z = standardizeDescriptor(descriptor, model.scaler.mean, model.scaler.std);
  const { probabilities, zRms } = forwardStandardized(model, z);

  let topIdx = 0;
  for (let c = 1; c < probabilities.length; c++) {
    if (probabilities[c] > probabilities[topIdx]) topIdx = c;
  }
  const centroid = model.centroids[topIdx] ?? [];
  const cosineSimilarity = cosineDot(z, centroid);

  return summarizePredictions(model, probabilities, cosineSimilarity, zRms);
}

/**
 * Runs chirality-invariant test-time ensembled inference over `sequence` and `mirrorNslSequence(sequence)`,
 * guaranteeing identical accuracy for left-handed/right-handed signers and front/rear cameras.
 */
export function predictSequence(
  model: NslTrainedModel,
  sequence: number[][]
): NslForwardOutput {
  const descOrig = extractSequenceDescriptor(sequence);
  const descMirr = extractSequenceDescriptor(mirrorNslSequence(sequence));

  const zOrig = standardizeDescriptor(descOrig, model.scaler.mean, model.scaler.std);
  const zMirr = standardizeDescriptor(descMirr, model.scaler.mean, model.scaler.std);

  const outOrig = forwardStandardized(model, zOrig);
  const outMirr = forwardStandardized(model, zMirr);

  const C = model.classes.length;
  const probabilities = new Array<number>(C);
  let topIdx = 0;
  for (let c = 0; c < C; c++) {
    const avg = 0.5 * (outOrig.probabilities[c] + outMirr.probabilities[c]);
    probabilities[c] = avg;
    if (avg > probabilities[topIdx]) topIdx = c;
  }

  const centroid = model.centroids[topIdx] ?? [];
  const cosOrig = cosineDot(zOrig, centroid);
  const cosMirr = cosineDot(zMirr, centroid);
  const cosineSimilarity = Math.max(cosOrig, cosMirr);
  const zRms = 0.5 * (outOrig.zRms + outMirr.zRms);

  return summarizePredictions(model, probabilities, cosineSimilarity, zRms);
}

function evaluateSplitMetrics(
  model: NslTrainedModel,
  items: Array<{ zOrig: Float64Array; zMirr: Float64Array; classIdx: number }>
): { accuracy: number; loss: number } {
  if (items.length === 0) return { accuracy: 0, loss: 0 };
  let correct = 0;
  let lossSum = 0;

  for (const item of items) {
    const a = forwardStandardized(model, item.zOrig);
    const b = forwardStandardized(model, item.zMirr);
    let topIdx = 0;
    let topProb = -1;
    for (let c = 0; c < a.probabilities.length; c++) {
      const p = 0.5 * (a.probabilities[c] + b.probabilities[c]);
      if (p > topProb) {
        topProb = p;
        topIdx = c;
      }
      if (c === item.classIdx) {
        lossSum += -Math.log(Math.max(p, 1e-7));
      }
    }
    if (topIdx === item.classIdx) {
      correct += 1;
    }
  }

  return {
    accuracy: Math.round((correct / items.length) * 1000) / 1000,
    loss: Math.round((lossSum / items.length) * 10000) / 10000,
  };
}

class AdamBuffer {
  readonly m: Float64Array;
  readonly v: Float64Array;

  constructor(size: number) {
    this.m = new Float64Array(size);
    this.v = new Float64Array(size);
  }

  step(
    params: Float64Array,
    grads: Float64Array,
    lr: number,
    weightDecay: number,
    stepNum: number
  ): void {
    const beta1 = 0.9;
    const beta2 = 0.999;
    const eps = 1e-8;
    const biasCorr1 = 1 - Math.pow(beta1, stepNum);
    const biasCorr2 = 1 - Math.pow(beta2, stepNum);

    for (let i = 0; i < params.length; i++) {
      const g = grads[i];
      this.m[i] = beta1 * this.m[i] + (1 - beta1) * g;
      this.v[i] = beta2 * this.v[i] + (1 - beta2) * g * g;
      const mHat = this.m[i] / biasCorr1;
      const vHat = this.v[i] / biasCorr2;
      params[i] = params[i] * (1 - lr * weightDecay) - (lr * mHat) / (Math.sqrt(vHat) + eps);
    }
  }
}

/**
 * Trains an on-device 2-hidden-layer neural sequence classifier + dominant-aligned centroids on NSL clips.
 * Features chirality pairing, sub-window/rotation/dropout augmentation, label smoothing, and best-val checkpointing.
 */
export function trainNslModel(
  samples: NslRecordedSample[],
  options: TrainNslOptions = {}
): TrainNslResult {
  const validSamples = samples.filter(
    (s) =>
      s.featureVersion === NSL_FEATURE_VERSION &&
      s.sequenceLength === NSL_SEQUENCE_LENGTH &&
      s.featureDim === NSL_FEATURE_DIM &&
      s.sequence.length === NSL_SEQUENCE_LENGTH
  );

  const grouped = new Map<string, { name: string; items: NslRecordedSample[] }>();
  for (const sample of validSamples) {
    const bucket = grouped.get(sample.labelId);
    if (bucket) {
      bucket.items.push(sample);
    } else {
      grouped.set(sample.labelId, { name: sample.labelName, items: [sample] });
    }
  }

  const eligibleClasses = Array.from(grouped.entries())
    .filter(([, group]) => group.items.length >= 2)
    .sort(([a], [b]) => a.localeCompare(b));

  const visibleEligibleCount = eligibleClasses.filter(([id]) => id !== NSL_IDLE_CLASS_ID).length;
  if (visibleEligibleCount < 2) {
    return {
      ok: false,
      error:
        'Training requires at least 2 sign classes with at least 2 recorded clips each (5+ clips per sign recommended).',
    };
  }

  const classes: NslModelClass[] = eligibleClasses.map(([id, group]) => ({
    id,
    name: group.name,
  }));

  const rand = createPrng(options.seed ?? 20261125);
  const isSmallDataset = validSamples.length < 80;
  const H1 = Math.max(24, Math.min(192, options.hiddenDim ?? (isSmallDataset ? 64 : 112)));
  const H2 = Math.max(16, Math.min(128, options.hiddenDim2 ?? (isSmallDataset ? 32 : 64)));
  const epochs = Math.max(20, Math.min(300, options.epochs ?? 110));
  const baseLr = options.learningRate ?? 0.0035;
  const weightDecay = options.weightDecay ?? 3e-4;
  const dropoutRate = Math.max(0, Math.min(0.5, options.dropoutRate ?? 0.22));
  const labelSmoothing = Math.max(0, Math.min(0.2, options.labelSmoothing ?? 0.04));
  const augmentFactor = options.augmentFactor ?? 4;

  // Prefer signer-grouped validation split when >= 2 distinct named signers contributed
  const trainRaw: Array<{
    sample: NslRecordedSample;
    trimmedSeq: number[][];
    classIdx: number;
    weight: number;
  }> = [];
  const valRaw: Array<{
    sample: NslRecordedSample;
    trimmedSeq: number[][];
    classIdx: number;
  }> = [];
  const genericSigners = new Set(['local-signer', 'anonymous']);
  let signerSplitClassCount = 0;

  for (let classIdx = 0; classIdx < eligibleClasses.length; classIdx++) {
    const groupItems = [...eligibleClasses[classIdx][1].items].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt)
    );

    const signerBuckets = new Map<string, NslRecordedSample[]>();
    for (const sample of groupItems) {
      const signerKey = normalizeSignerTag(sample.signerTag).toLowerCase();
      if (genericSigners.has(signerKey)) continue;
      const list = signerBuckets.get(signerKey) ?? [];
      list.push(sample);
      signerBuckets.set(signerKey, list);
    }

    let heldOutIds: Set<string> | null = null;
    if (signerBuckets.size >= 2) {
      // Prefer an explicit holdout bucket if present, else smallest named signer bucket
      const explicitHoldout = signerBuckets.get('seed-holdout');
      if (
        explicitHoldout &&
        groupItems.length - explicitHoldout.length >= 1 &&
        explicitHoldout.length <= Math.floor(groupItems.length * 0.5)
      ) {
        heldOutIds = new Set(explicitHoldout.map((item) => item.id));
      } else {
        const sortedSigners = Array.from(signerBuckets.entries()).sort((a, b) => {
          if (a[1].length !== b[1].length) return a[1].length - b[1].length;
          return a[0].localeCompare(b[0]);
        });
        const candidateVal = sortedSigners[0][1];
        const remainingCount = groupItems.length - candidateVal.length;
        if (remainingCount >= 1 && candidateVal.length <= Math.floor(groupItems.length * 0.5)) {
          heldOutIds = new Set(candidateVal.map((item) => item.id));
        }
      }
    }

    const valIds = new Set<string>();
    if (heldOutIds) {
      signerSplitClassCount += 1;
      for (const id of heldOutIds) valIds.add(id);
    } else {
      const valCount = groupItems.length >= 4 ? Math.max(1, Math.round(groupItems.length * 0.25)) : 1;
      const trainCount = groupItems.length - valCount;
      for (let i = trainCount; i < groupItems.length; i++) {
        valIds.add(groupItems[i].id);
      }
    }

    for (const sample of groupItems) {
      const activeSlice =
        sample.labelId === NSL_IDLE_CLASS_ID
          ? sample.sequence
          : resampleNslSequence(trimActiveNslFrames(sample.sequence, 10), NSL_SEQUENCE_LENGTH);
      const customWeight = options.sampleWeights?.[sample.id] ?? 1;

      if (valIds.has(sample.id)) {
        valRaw.push({ sample, trimmedSeq: activeSlice, classIdx });
      } else {
        trainRaw.push({
          sample,
          trimmedSeq: activeSlice,
          classIdx,
          weight: Math.max(0.25, Math.min(5, customWeight)),
        });
      }
    }
  }

  // Build augmented training set (original + exact mirror + stochastic domain augmentations)
  const trainAugmented: Array<{ descriptor: number[]; classIdx: number; weight: number }> = [];

  for (const item of trainRaw) {
    trainAugmented.push({
      descriptor: extractSequenceDescriptor(item.trimmedSeq),
      classIdx: item.classIdx,
      weight: item.weight,
    });
    trainAugmented.push({
      descriptor: extractSequenceDescriptor(mirrorNslSequence(item.trimmedSeq)),
      classIdx: item.classIdx,
      weight: item.weight,
    });

    for (let a = 0; a < augmentFactor; a++) {
      const augSeq = augmentSequence(item.trimmedSeq, rand);
      trainAugmented.push({
        descriptor: extractSequenceDescriptor(augSeq),
        classIdx: item.classIdx,
        weight: item.weight,
      });
    }
  }

  const D = NSL_DESCRIPTOR_DIM;
  const C = classes.length;
  const N = trainAugmented.length;

  const mean = new Array<number>(D).fill(0);
  for (const row of trainAugmented) {
    for (let d = 0; d < D; d++) {
      mean[d] += row.descriptor[d] / N;
    }
  }

  const variance = new Array<number>(D).fill(0);
  for (const row of trainAugmented) {
    for (let d = 0; d < D; d++) {
      const diff = row.descriptor[d] - mean[d];
      variance[d] += (diff * diff) / N;
    }
  }
  const std = variance.map((v) => Math.max(Math.sqrt(v), 0.05));

  const zTrain = trainAugmented.map((row) => ({
    z: standardizeDescriptor(row.descriptor, mean, std),
    y: row.classIdx,
    weight: row.weight,
  }));

  const evalTrainItems = trainRaw.map((item) => ({
    zOrig: standardizeDescriptor(extractSequenceDescriptor(item.trimmedSeq), mean, std),
    zMirr: standardizeDescriptor(
      extractSequenceDescriptor(mirrorNslSequence(item.trimmedSeq)),
      mean,
      std
    ),
    classIdx: item.classIdx,
  }));

  const evalValItems = valRaw.map((item) => ({
    zOrig: standardizeDescriptor(extractSequenceDescriptor(item.trimmedSeq), mean, std),
    zMirr: standardizeDescriptor(
      extractSequenceDescriptor(mirrorNslSequence(item.trimmedSeq)),
      mean,
      std
    ),
    classIdx: item.classIdx,
  }));

  // Compute dominant-right-aligned class centroids from unaugmented real training clips
  const centroidSums = Array.from({ length: C }, () => new Float64Array(D));
  const classWeightSums = new Array<number>(C).fill(0);
  for (const item of trainRaw) {
    const alignedSeq = alignDominantRight(item.trimmedSeq);
    const z = standardizeDescriptor(extractSequenceDescriptor(alignedSeq), mean, std);
    classWeightSums[item.classIdx] += item.weight;
    for (let d = 0; d < D; d++) {
      centroidSums[item.classIdx][d] += z[d] * item.weight;
    }
  }
  const centroids = centroidSums.map((sumVec, cIdx) => {
    const cnt = Math.max(1e-6, classWeightSums[cIdx]);
    for (let d = 0; d < D; d++) {
      sumVec[d] /= cnt;
    }
    return normalizeUnit(sumVec).map(round4);
  });

  // Initialize weights (He for ReLU layers 1 & 2, Xavier for softmax layer 3)
  const w1 = new Float64Array(H1 * D);
  const b1 = new Float64Array(H1);
  const w2 = new Float64Array(H2 * H1);
  const b2 = new Float64Array(H2);
  const w3 = new Float64Array(C * H2);
  const b3 = new Float64Array(C);

  const scale1 = Math.sqrt(2 / D);
  for (let i = 0; i < w1.length; i++) w1[i] = gaussianNoise(rand) * scale1;
  const scale2 = Math.sqrt(2 / H1);
  for (let i = 0; i < w2.length; i++) w2[i] = gaussianNoise(rand) * scale2;
  const scale3 = Math.sqrt(1 / H2);
  for (let i = 0; i < w3.length; i++) w3[i] = gaussianNoise(rand) * scale3;

  const adamW1 = new AdamBuffer(w1.length);
  const adamB1 = new AdamBuffer(b1.length);
  const adamW2 = new AdamBuffer(w2.length);
  const adamB2 = new AdamBuffer(b2.length);
  const adamW3 = new AdamBuffer(w3.length);
  const adamB3 = new AdamBuffer(b3.length);

  const gradW1 = new Float64Array(w1.length);
  const gradB1 = new Float64Array(b1.length);
  const gradW2 = new Float64Array(w2.length);
  const gradB2 = new Float64Array(b2.length);
  const gradW3 = new Float64Array(w3.length);
  const gradB3 = new Float64Array(b3.length);

  const h1Pre = new Float64Array(H1);
  const h1Act = new Float64Array(H1);
  const dropMask1 = new Float64Array(H1);
  const h2Pre = new Float64Array(H2);
  const h2Act = new Float64Array(H2);
  const logits = new Float64Array(C);
  const probs = new Float64Array(C);
  const dH2 = new Float64Array(H2);
  const dH1 = new Float64Array(H1);

  const bestW1 = new Float64Array(w1);
  const bestB1 = new Float64Array(b1);
  const bestW2 = new Float64Array(w2);
  const bestB2 = new Float64Array(b2);
  const bestW3 = new Float64Array(w3);
  const bestB3 = new Float64Array(b3);
  let bestValAcc = -1;
  let bestValLoss = Infinity;
  let bestEpoch = 0;

  const indices = Array.from({ length: N }, (_, idx) => idx);
  const batchSize = Math.min(32, Math.max(8, N));
  const keepProb = 1 - dropoutRate;
  const smoothPos = 1 - labelSmoothing + labelSmoothing / C;
  const smoothNeg = labelSmoothing / C;

  const lossHistory: number[] = [];
  let adamStep = 0;
  let lastEpochLoss = 0;

  const workingModel: NslTrainedModel = {
    schema: 'signbridge-nsl-model',
    version: 2,
    featureVersion: NSL_FEATURE_VERSION,
    featureDim: NSL_FEATURE_DIM,
    sequenceLength: NSL_SEQUENCE_LENGTH,
    descriptorDim: D,
    hiddenDim: H1,
    hiddenDim2: H2,
    classes,
    scaler: { mean, std },
    weights: {
      w1: [],
      b1: [],
      w2: [],
      b2: [],
      w3: [],
      b3: [],
    },
    centroids,
    metrics: {
      sampleCount: trainRaw.length + valRaw.length,
      trainCount: trainRaw.length,
      valCount: valRaw.length,
      trainAccuracy: 0,
      valAccuracy: 0,
      splitStrategy:
        signerSplitClassCount === eligibleClasses.length ? 'signer-grouped' : 'stratified-clip',
      epochs,
      finalLoss: 0,
      lossHistory,
      trainedAt: new Date().toISOString(),
    },
  };

  for (let epoch = 0; epoch < epochs; epoch++) {
    for (let i = N - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = indices[i];
      indices[i] = indices[j];
      indices[j] = tmp;
    }

    const cosineFactor = 0.5 * (1 + Math.cos((Math.PI * epoch) / epochs));
    const epochLr = baseLr * (0.06 + 0.94 * cosineFactor);
    let epochLossSum = 0;
    let epochWeightSum = 0;

    for (let batchStart = 0; batchStart < N; batchStart += batchSize) {
      const batchEnd = Math.min(N, batchStart + batchSize);
      let batchWeightSum = 0;
      for (let b = batchStart; b < batchEnd; b++) {
        batchWeightSum += zTrain[indices[b]].weight;
      }
      batchWeightSum = Math.max(1e-6, batchWeightSum);

      gradW1.fill(0);
      gradB1.fill(0);
      gradW2.fill(0);
      gradB2.fill(0);
      gradW3.fill(0);
      gradB3.fill(0);

      for (let b = batchStart; b < batchEnd; b++) {
        const sample = zTrain[indices[b]];
        const z = sample.z;
        const y = sample.y;
        const wScale = sample.weight / batchWeightSum;

        // Forward layer 1 + ReLU + inverted dropout
        for (let k = 0; k < H1; k++) {
          let sum = b1[k];
          const off = k * D;
          for (let d = 0; d < D; d++) {
            sum += z[d] * w1[off + d];
          }
          h1Pre[k] = sum;
          if (sum > 0) {
            if (dropoutRate > 0) {
              const keep = rand() < keepProb ? 1 / keepProb : 0;
              dropMask1[k] = keep;
              h1Act[k] = sum * keep;
            } else {
              dropMask1[k] = 1;
              h1Act[k] = sum;
            }
          } else {
            dropMask1[k] = 0;
            h1Act[k] = 0;
          }
        }

        // Forward layer 2 + ReLU
        for (let j = 0; j < H2; j++) {
          let sum = b2[j];
          const off = j * H1;
          for (let k = 0; k < H1; k++) {
            sum += h1Act[k] * w2[off + k];
          }
          h2Pre[j] = sum;
          h2Act[j] = sum > 0 ? sum : 0;
        }

        // Forward layer 3 + Softmax
        let maxLogit = -Infinity;
        for (let c = 0; c < C; c++) {
          let sum = b3[c];
          const off = c * H2;
          for (let j = 0; j < H2; j++) {
            sum += h2Act[j] * w3[off + j];
          }
          logits[c] = sum;
          if (sum > maxLogit) maxLogit = sum;
        }

        let expSum = 0;
        for (let c = 0; c < C; c++) {
          const e = Math.exp(logits[c] - maxLogit);
          probs[c] = e;
          expSum += e;
        }
        for (let c = 0; c < C; c++) {
          probs[c] /= expSum;
        }

        epochLossSum += sample.weight * -Math.log(Math.max(probs[y], 1e-7));
        epochWeightSum += sample.weight;

        // Backward layer 3 (with label smoothing)
        dH2.fill(0);
        for (let c = 0; c < C; c++) {
          const target = c === y ? smoothPos : smoothNeg;
          const dLogit = (probs[c] - target) * wScale;
          gradB3[c] += dLogit;
          const off = c * H2;
          for (let j = 0; j < H2; j++) {
            gradW3[off + j] += dLogit * h2Act[j];
            dH2[j] += dLogit * w3[off + j];
          }
        }

        // Backward layer 2
        dH1.fill(0);
        for (let j = 0; j < H2; j++) {
          if (h2Pre[j] <= 0) continue;
          const g2 = dH2[j];
          gradB2[j] += g2;
          const off = j * H1;
          for (let k = 0; k < H1; k++) {
            gradW2[off + k] += g2 * h1Act[k];
            dH1[k] += g2 * w2[off + k];
          }
        }

        // Backward layer 1
        for (let k = 0; k < H1; k++) {
          if (h1Pre[k] <= 0 || dropMask1[k] === 0) continue;
          const g1 = dH1[k] * dropMask1[k];
          gradB1[k] += g1;
          const off = k * D;
          for (let d = 0; d < D; d++) {
            gradW1[off + d] += g1 * z[d];
          }
        }
      }

      adamStep += 1;
      adamW1.step(w1, gradW1, epochLr, weightDecay, adamStep);
      adamB1.step(b1, gradB1, epochLr, 0, adamStep);
      adamW2.step(w2, gradW2, epochLr, weightDecay, adamStep);
      adamB2.step(b2, gradB2, epochLr, 0, adamStep);
      adamW3.step(w3, gradW3, epochLr, weightDecay, adamStep);
      adamB3.step(b3, gradB3, epochLr, 0, adamStep);
    }

    lastEpochLoss = round4(epochLossSum / Math.max(1e-6, epochWeightSum));
    if (epoch % Math.max(1, Math.floor(epochs / 12)) === 0 || epoch === epochs - 1) {
      lossHistory.push(lastEpochLoss);
    }

    // Evaluate validation checkpoint periodically & across final epochs
    if (epoch >= Math.floor(epochs * 0.2) && (epoch % 3 === 0 || epoch === epochs - 1)) {
      workingModel.weights.w1 = w1 as unknown as number[];
      workingModel.weights.b1 = b1 as unknown as number[];
      workingModel.weights.w2 = w2 as unknown as number[];
      workingModel.weights.b2 = b2 as unknown as number[];
      workingModel.weights.w3 = w3 as unknown as number[];
      workingModel.weights.b3 = b3 as unknown as number[];

      const valEval = evaluateSplitMetrics(
        workingModel,
        evalValItems.length > 0 ? evalValItems : evalTrainItems
      );
      const improved =
        valEval.accuracy > bestValAcc + 1e-4 ||
        (Math.abs(valEval.accuracy - bestValAcc) <= 1e-4 && valEval.loss < bestValLoss);

      if (improved) {
        bestValAcc = valEval.accuracy;
        bestValLoss = valEval.loss;
        bestEpoch = epoch + 1;
        bestW1.set(w1);
        bestB1.set(b1);
        bestW2.set(w2);
        bestB2.set(b2);
        bestW3.set(w3);
        bestB3.set(b3);
      }
    }
  }

  const candidateModel: NslTrainedModel = {
    schema: 'signbridge-nsl-model',
    version: 2,
    featureVersion: NSL_FEATURE_VERSION,
    featureDim: NSL_FEATURE_DIM,
    sequenceLength: NSL_SEQUENCE_LENGTH,
    descriptorDim: D,
    hiddenDim: H1,
    hiddenDim2: H2,
    classes,
    scaler: {
      mean: mean.map(round4),
      std: std.map(round4),
    },
    weights: {
      w1: Array.from(bestW1, round4),
      b1: Array.from(bestB1, round4),
      w2: Array.from(bestW2, round4),
      b2: Array.from(bestB2, round4),
      w3: Array.from(bestW3, round4),
      b3: Array.from(bestB3, round4),
    },
    centroids,
    metrics: {
      sampleCount: trainRaw.length + valRaw.length,
      trainCount: trainRaw.length,
      valCount: valRaw.length,
      trainAccuracy: 0,
      valAccuracy: 0,
      splitStrategy:
        signerSplitClassCount === eligibleClasses.length ? 'signer-grouped' : 'stratified-clip',
      epochs,
      bestEpoch,
      finalLoss: lastEpochLoss,
      bestValLoss: Number.isFinite(bestValLoss) ? bestValLoss : lastEpochLoss,
      lossHistory,
      trainedAt: new Date().toISOString(),
    },
  };

  candidateModel.metrics.trainAccuracy = evaluateSplitMetrics(candidateModel, evalTrainItems).accuracy;
  candidateModel.metrics.valAccuracy = evaluateSplitMetrics(candidateModel, evalValItems).accuracy;

  return { ok: true, model: candidateModel };
}

function isFiniteNumberArray(arr: unknown, expectedLength: number): arr is number[] {
  if (!Array.isArray(arr) || arr.length !== expectedLength) return false;
  for (const val of arr) {
    if (typeof val !== 'number' || !Number.isFinite(val)) return false;
  }
  return true;
}

export function parseImportedModelJson(rawJson: string): ParseModelResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return { ok: false, error: 'Model file is not valid JSON.' };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: 'Model root must be a JSON object.' };
  }

  const m = parsed as Partial<NslTrainedModel>;
  if (
    m.schema !== 'signbridge-nsl-model' ||
    m.version !== 2 ||
    m.featureVersion !== NSL_FEATURE_VERSION ||
    m.featureDim !== NSL_FEATURE_DIM ||
    m.sequenceLength !== NSL_SEQUENCE_LENGTH ||
    m.descriptorDim !== NSL_DESCRIPTOR_DIM ||
    typeof m.hiddenDim !== 'number' ||
    m.hiddenDim < 8 ||
    typeof m.hiddenDim2 !== 'number' ||
    m.hiddenDim2 < 8 ||
    !Array.isArray(m.classes) ||
    m.classes.length < 2
  ) {
    return { ok: false, error: 'Incompatible NSL model architecture or version.' };
  }

  for (const cls of m.classes) {
    if (
      !cls ||
      typeof cls !== 'object' ||
      typeof cls.id !== 'string' ||
      cls.id.length === 0 ||
      typeof cls.name !== 'string' ||
      cls.name.length === 0
    ) {
      return { ok: false, error: 'Model contains invalid class metadata.' };
    }
  }

  const D = m.descriptorDim;
  const H1 = m.hiddenDim;
  const H2 = m.hiddenDim2;
  const C = m.classes.length;

  if (
    !m.scaler ||
    !isFiniteNumberArray(m.scaler.mean, D) ||
    !isFiniteNumberArray(m.scaler.std, D) ||
    !m.weights ||
    !isFiniteNumberArray(m.weights.w1, H1 * D) ||
    !isFiniteNumberArray(m.weights.b1, H1) ||
    !isFiniteNumberArray(m.weights.w2, H2 * H1) ||
    !isFiniteNumberArray(m.weights.b2, H2) ||
    !isFiniteNumberArray(m.weights.w3, C * H2) ||
    !isFiniteNumberArray(m.weights.b3, C) ||
    !Array.isArray(m.centroids) ||
    m.centroids.length !== C ||
    !m.centroids.every((row) => isFiniteNumberArray(row, D)) ||
    !m.metrics ||
    typeof m.metrics.trainedAt !== 'string'
  ) {
    return { ok: false, error: 'Model weights or scaler tensors are invalid or corrupt.' };
  }

  return { ok: true, model: m as NslTrainedModel };
}

export function serializeModelJson(model: NslTrainedModel, compact = false): string {
  return compact ? JSON.stringify(model) : JSON.stringify(model, null, 2);
}

export function saveTrainedModel(
  model: NslTrainedModel
): { ok: true } | { ok: false; error: string } {
  if (!isBrowserStorageAvailable()) {
    return { ok: false, error: 'Browser storage is unavailable in this environment.' };
  }
  try {
    const serialized = JSON.stringify(model);
    window.localStorage.setItem(NSL_MODEL_STORAGE_KEY, serialized);
    lastModelRaw = serialized;
    lastModelSnapshot = model;
    emitModelChanged();
    return { ok: true };
  } catch {
    return {
      ok: false,
      error: 'Unable to save trained NSL model to device storage (quota exceeded).',
    };
  }
}

export function loadTrainedModel(): NslTrainedModel | null {
  if (!isBrowserStorageAvailable()) return null;
  try {
    const raw = window.localStorage.getItem(NSL_MODEL_STORAGE_KEY);
    if (!raw) {
      lastModelRaw = null;
      lastModelSnapshot = null;
      return null;
    }
    if (raw === lastModelRaw) {
      return lastModelSnapshot;
    }
    const parsed = parseImportedModelJson(raw);
    if (!parsed.ok) {
      lastModelRaw = raw;
      lastModelSnapshot = null;
      return null;
    }
    lastModelRaw = raw;
    lastModelSnapshot = parsed.model;
    return parsed.model;
  } catch {
    return null;
  }
}

export function clearTrainedModel(): void {
  if (!isBrowserStorageAvailable()) return;
  try {
    window.localStorage.removeItem(NSL_MODEL_STORAGE_KEY);
    lastModelRaw = null;
    lastModelSnapshot = null;
    emitModelChanged();
  } catch {
    // Ignore storage removal errors.
  }
}

let bundledModelCache: NslTrainedModel | null = null;
let bundledModelFetchPromise: Promise<NslTrainedModel | null> | null = null;

export function getCachedBundledModel(): NslTrainedModel | null {
  return bundledModelCache;
}

/**
 * Loads bundled default NSL model weights from `/models/nsl-model.json` once.
 * Returns null quietly if no bundled weights file is deployed yet.
 */
export function loadBundledDefaultModel(): Promise<NslTrainedModel | null> {
  if (typeof window === 'undefined' || typeof fetch !== 'function') {
    return Promise.resolve(null);
  }
  if (bundledModelCache) {
    return Promise.resolve(bundledModelCache);
  }
  if (bundledModelFetchPromise) {
    return bundledModelFetchPromise;
  }

  bundledModelFetchPromise = fetch('/models/nsl-model.json', { cache: 'force-cache' })
    .then(async (res) => {
      if (!res.ok) return null;
      const text = await res.text();
      const parsed = parseImportedModelJson(text);
      if (!parsed.ok) return null;
      bundledModelCache = parsed.model;
      emitModelChanged();
      return parsed.model;
    })
    .catch(() => null);

  return bundledModelFetchPromise;
}

export function subscribeNslModel(listener: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
    return () => {};
  }
  window.addEventListener(NSL_MODEL_EVENT, listener);
  window.addEventListener('storage', listener);
  return () => {
    window.removeEventListener(NSL_MODEL_EVENT, listener);
    window.removeEventListener('storage', listener);
  };
}

export function getNslModelSnapshot(): NslTrainedModel | null {
  return loadTrainedModel() ?? bundledModelCache;
}
