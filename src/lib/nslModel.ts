import {
  NSL_FEATURE_DIM,
  NSL_FEATURE_VERSION,
  NSL_SEQUENCE_LENGTH,
  resampleNslSequence,
} from '@/lib/nslFeatures';
import type { NslRecordedSample } from '@/lib/nslDataset';

export const NSL_MODEL_STORAGE_KEY = 'signbridge_nsl_trained_model_v1';
export const NSL_DESCRIPTOR_DIM = NSL_FEATURE_DIM * 4;
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
  epochs: number;
  finalLoss: number;
  lossHistory: number[];
  trainedAt: string;
}

export interface NslTrainedModel {
  schema: 'signbridge-nsl-model';
  version: 1;
  featureVersion: typeof NSL_FEATURE_VERSION;
  featureDim: number;
  sequenceLength: number;
  descriptorDim: number;
  hiddenDim: number;
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
  };
  centroids: number[][];
  metrics: NslModelMetrics;
}

export interface SequenceMotionStats {
  handCoverage: number;
  wristMotion: number;
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
  epochs?: number;
  learningRate?: number;
  weightDecay?: number;
  augmentFactor?: number;
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

function round5(value: number): number {
  return Math.round(value * 100000) / 100000;
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

/** Measures active signing hand visibility and average wrist velocity over a clip. */
export function computeSequenceMotionStats(sequence: number[][]): SequenceMotionStats {
  if (sequence.length === 0) {
    return { handCoverage: 0, wristMotion: 0 };
  }

  let handFrames = 0;
  let motionAccum = 0;

  for (const row of sequence) {
    if ((row[15] ?? 0) >= 0.5 || (row[78] ?? 0) >= 0.5) {
      handFrames += 1;
    }
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
  };
}

/**
 * Summarizes a [30 x 145] NSL feature clip into a fixed 580-dim spatio-temporal vector:
 * 3 temporal-third segment means (Start/Mid/End) + global per-dimension std dev.
 */
export function extractSequenceDescriptor(sequence: number[][]): number[] {
  const descriptor = new Array<number>(NSL_DESCRIPTOR_DIM).fill(0);
  if (sequence.length === 0) return descriptor;

  const third = Math.max(1, Math.floor(sequence.length / 3));
  const bounds: Array<[number, number]> = [
    [0, third],
    [third, Math.min(sequence.length, third * 2)],
    [Math.min(sequence.length, third * 2), sequence.length],
  ];

  // Segment means ([0..434])
  for (let seg = 0; seg < 3; seg++) {
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

  // Whole-clip mean & std dev ([435..579])
  const globalMean = new Array<number>(NSL_FEATURE_DIM).fill(0);
  for (const row of sequence) {
    for (let d = 0; d < NSL_FEATURE_DIM; d++) {
      const val = row[d];
      if (Number.isFinite(val)) {
        globalMean[d] += val / sequence.length;
      }
    }
  }

  const stdOffset = 3 * NSL_FEATURE_DIM;
  for (const row of sequence) {
    for (let d = 0; d < NSL_FEATURE_DIM; d++) {
      const val = Number.isFinite(row[d]) ? row[d] : 0;
      const diff = val - globalMean[d];
      descriptor[stdOffset + d] += (diff * diff) / sequence.length;
    }
  }

  for (let d = 0; d < NSL_FEATURE_DIM; d++) {
    descriptor[stdOffset + d] = Math.sqrt(descriptor[stdOffset + d]);
  }

  return descriptor;
}

function augmentSequence(sequence: number[][], rand: () => number): number[][] {
  const len = sequence.length;
  // Subtle temporal trim/stretch (0.85x .. 1.0x window resampled back to NSL_SEQUENCE_LENGTH)
  const trimMax = Math.max(1, Math.floor(len * 0.14));
  const startOffset = Math.floor(rand() * (trimMax + 1));
  const endOffset = len - Math.floor(rand() * (trimMax + 1));
  const safeSlice =
    endOffset - startOffset >= 8 ? sequence.slice(startOffset, endOffset) : sequence;
  const warped = resampleNslSequence(safeSlice, NSL_SEQUENCE_LENGTH);

  const scaleFactor = 0.94 + rand() * 0.12;
  const noiseStd = 0.015;

  return warped.map((row) =>
    row.map((val, dim) => {
      if (PRESENCE_DIMS.has(dim)) {
        return val >= 0.5 ? 1 : 0;
      }
      const perturbed = val * scaleFactor + gaussianNoise(rand) * noiseStd;
      return Math.max(-4, Math.min(4, perturbed));
    })
  );
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

/** Runs forward neural pass and centroid similarity scoring on a trained model. */
export function predictDescriptor(
  model: NslTrainedModel,
  descriptor: number[]
): NslForwardOutput {
  const D = model.descriptorDim;
  const H = model.hiddenDim;
  const C = model.classes.length;

  const z = standardizeDescriptor(descriptor, model.scaler.mean, model.scaler.std);
  const { w1, b1, w2, b2 } = model.weights;

  const hidden = new Float64Array(H);
  for (let k = 0; k < H; k++) {
    let sum = b1[k];
    const rowOff = k * D;
    for (let d = 0; d < D; d++) {
      sum += z[d] * w1[rowOff + d];
    }
    hidden[k] = sum > 0 ? sum : 0;
  }

  const logits = new Float64Array(C);
  let maxLogit = -Infinity;
  for (let c = 0; c < C; c++) {
    let sum = b2[c];
    const rowOff = c * H;
    for (let k = 0; k < H; k++) {
      sum += hidden[k] * w2[rowOff + k];
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
  const centroid = model.centroids[top.idx] ?? [];
  const cosineSimilarity = cosineDot(z, centroid);

  let zNormSq = 0;
  for (let d = 0; d < z.length; d++) {
    zNormSq += z[d] * z[d];
  }
  const zRms = Math.sqrt(zNormSq / Math.max(1, z.length));

  return {
    probabilities,
    topIndex: top.idx,
    secondIndex: second.idx,
    confidence: top.probability,
    margin: ranked.length > 1 ? top.probability - second.probability : top.probability,
    cosineSimilarity,
    zRms,
    candidates: ranked.slice(0, 3).map((item) => ({
      id: item.id,
      name: item.name,
      probability: item.probability,
    })),
  };
}

function evaluateSplitAccuracy(
  model: NslTrainedModel,
  items: Array<{ descriptor: number[]; classIdx: number }>
): number {
  if (items.length === 0) return 0;
  let correct = 0;
  for (const item of items) {
    const out = predictDescriptor(model, item.descriptor);
    if (out.topIndex === item.classIdx) {
      correct += 1;
    }
  }
  return Math.round((correct / items.length) * 1000) / 1000;
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
      const g = grads[i] + weightDecay * params[i];
      this.m[i] = beta1 * this.m[i] + (1 - beta1) * g;
      this.v[i] = beta2 * this.v[i] + (1 - beta2) * g * g;
      const mHat = this.m[i] / biasCorr1;
      const vHat = this.v[i] / biasCorr2;
      params[i] -= (lr * mHat) / (Math.sqrt(vHat) + eps);
    }
  }
}

/**
 * Trains an on-device 2-layer neural sequence classifier + class centroids on NSL clips.
 * Requires at least 2 distinct sign classes with at least 2 clips per class.
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

  // Group by sign label
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

  if (eligibleClasses.length < 2) {
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

  const rand = createPrng(options.seed ?? 20261114);
  const hiddenDim = Math.max(16, Math.min(128, options.hiddenDim ?? 48));
  const epochs = Math.max(20, Math.min(300, options.epochs ?? 110));
  const baseLr = options.learningRate ?? 0.014;
  const weightDecay = options.weightDecay ?? 2e-4;
  const augmentFactor = options.augmentFactor ?? 4;

  // Deterministic stratified train / validation split
  const trainRaw: Array<{ sample: NslRecordedSample; classIdx: number; descriptor: number[] }> = [];
  const valRaw: Array<{ sample: NslRecordedSample; classIdx: number; descriptor: number[] }> = [];

  for (let classIdx = 0; classIdx < eligibleClasses.length; classIdx++) {
    const groupItems = [...eligibleClasses[classIdx][1].items].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt)
    );
    const valCount = groupItems.length >= 4 ? Math.max(1, Math.round(groupItems.length * 0.25)) : 1;
    const trainCount = groupItems.length - valCount;

    for (let i = 0; i < groupItems.length; i++) {
      const sample = groupItems[i];
      const item = {
        sample,
        classIdx,
        descriptor: extractSequenceDescriptor(sample.sequence),
      };
      if (i < trainCount) {
        trainRaw.push(item);
      } else {
        valRaw.push(item);
      }
    }
  }

  // Augment training split ONLY (zero data leakage into validation)
  const trainAugmented: Array<{ descriptor: number[]; classIdx: number }> = trainRaw.map((item) => ({
    descriptor: item.descriptor,
    classIdx: item.classIdx,
  }));

  for (const item of trainRaw) {
    for (let a = 0; a < augmentFactor; a++) {
      const augSeq = augmentSequence(item.sample.sequence, rand);
      trainAugmented.push({
        descriptor: extractSequenceDescriptor(augSeq),
        classIdx: item.classIdx,
      });
    }
  }

  // Standardize across augmented training set
  const D = NSL_DESCRIPTOR_DIM;
  const H = hiddenDim;
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
  }));

  // Compute normalized class centroids from unaugmented real training clips
  const centroidSums = Array.from({ length: C }, () => new Float64Array(D));
  const classCounts = new Array<number>(C).fill(0);
  for (const item of trainRaw) {
    const z = standardizeDescriptor(item.descriptor, mean, std);
    classCounts[item.classIdx] += 1;
    for (let d = 0; d < D; d++) {
      centroidSums[item.classIdx][d] += z[d];
    }
  }
  const centroids = centroidSums.map((sumVec, cIdx) => {
    const cnt = Math.max(1, classCounts[cIdx]);
    for (let d = 0; d < D; d++) {
      sumVec[d] /= cnt;
    }
    return normalizeUnit(sumVec).map(round5);
  });

  // Initialize weights (He for ReLU layer 1, Xavier for softmax layer 2)
  const w1 = new Float64Array(H * D);
  const b1 = new Float64Array(H);
  const w2 = new Float64Array(C * H);
  const b2 = new Float64Array(C);

  const scale1 = Math.sqrt(2 / D);
  for (let i = 0; i < w1.length; i++) {
    w1[i] = gaussianNoise(rand) * scale1;
  }
  const scale2 = Math.sqrt(1 / H);
  for (let i = 0; i < w2.length; i++) {
    w2[i] = gaussianNoise(rand) * scale2;
  }

  const adamW1 = new AdamBuffer(w1.length);
  const adamB1 = new AdamBuffer(b1.length);
  const adamW2 = new AdamBuffer(w2.length);
  const adamB2 = new AdamBuffer(b2.length);

  const gradW1 = new Float64Array(w1.length);
  const gradB1 = new Float64Array(b1.length);
  const gradW2 = new Float64Array(w2.length);
  const gradB2 = new Float64Array(b2.length);

  const hPre = new Float64Array(H);
  const hAct = new Float64Array(H);
  const logits = new Float64Array(C);
  const probs = new Float64Array(C);
  const dH = new Float64Array(H);

  const indices = Array.from({ length: N }, (_, idx) => idx);
  const batchSize = Math.min(16, Math.max(4, N));
  const lossHistory: number[] = [];
  let adamStep = 0;
  let lastEpochLoss = 0;

  for (let epoch = 0; epoch < epochs; epoch++) {
    // Fisher-Yates shuffle
    for (let i = N - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = indices[i];
      indices[i] = indices[j];
      indices[j] = tmp;
    }

    const cosineFactor = 0.5 * (1 + Math.cos((Math.PI * epoch) / epochs));
    const epochLr = baseLr * (0.1 + 0.9 * cosineFactor);
    let epochLossSum = 0;

    for (let batchStart = 0; batchStart < N; batchStart += batchSize) {
      const batchEnd = Math.min(N, batchStart + batchSize);
      const currentBatch = batchEnd - batchStart;

      gradW1.fill(0);
      gradB1.fill(0);
      gradW2.fill(0);
      gradB2.fill(0);

      for (let b = batchStart; b < batchEnd; b++) {
        const sample = zTrain[indices[b]];
        const z = sample.z;
        const y = sample.y;

        // Forward layer 1
        for (let k = 0; k < H; k++) {
          let sum = b1[k];
          const off = k * D;
          for (let d = 0; d < D; d++) {
            sum += z[d] * w1[off + d];
          }
          hPre[k] = sum;
          hAct[k] = sum > 0 ? sum : 0;
        }

        // Forward layer 2 + softmax
        let maxLogit = -Infinity;
        for (let c = 0; c < C; c++) {
          let sum = b2[c];
          const off = c * H;
          for (let k = 0; k < H; k++) {
            sum += hAct[k] * w2[off + k];
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

        epochLossSum += -Math.log(Math.max(probs[y], 1e-7));

        // Backward layer 2
        dH.fill(0);
        for (let c = 0; c < C; c++) {
          const dLogit = (probs[c] - (c === y ? 1 : 0)) / currentBatch;
          gradB2[c] += dLogit;
          const off = c * H;
          for (let k = 0; k < H; k++) {
            gradW2[off + k] += dLogit * hAct[k];
            dH[k] += dLogit * w2[off + k];
          }
        }

        // Backward layer 1
        for (let k = 0; k < H; k++) {
          if (hPre[k] <= 0) continue;
          const g = dH[k];
          gradB1[k] += g;
          const off = k * D;
          for (let d = 0; d < D; d++) {
            gradW1[off + d] += g * z[d];
          }
        }
      }

      adamStep += 1;
      adamW1.step(w1, gradW1, epochLr, weightDecay, adamStep);
      adamB1.step(b1, gradB1, epochLr, 0, adamStep);
      adamW2.step(w2, gradW2, epochLr, weightDecay, adamStep);
      adamB2.step(b2, gradB2, epochLr, 0, adamStep);
    }

    lastEpochLoss = Math.round((epochLossSum / N) * 10000) / 10000;
    if (epoch % Math.max(1, Math.floor(epochs / 12)) === 0 || epoch === epochs - 1) {
      lossHistory.push(lastEpochLoss);
    }
  }

  const candidateModel: NslTrainedModel = {
    schema: 'signbridge-nsl-model',
    version: 1,
    featureVersion: NSL_FEATURE_VERSION,
    featureDim: NSL_FEATURE_DIM,
    sequenceLength: NSL_SEQUENCE_LENGTH,
    descriptorDim: D,
    hiddenDim: H,
    classes,
    scaler: {
      mean: mean.map(round5),
      std: std.map(round5),
    },
    weights: {
      w1: Array.from(w1, round5),
      b1: Array.from(b1, round5),
      w2: Array.from(w2, round5),
      b2: Array.from(b2, round5),
    },
    centroids,
    metrics: {
      sampleCount: trainRaw.length + valRaw.length,
      trainCount: trainRaw.length,
      valCount: valRaw.length,
      trainAccuracy: 0,
      valAccuracy: 0,
      epochs,
      finalLoss: lastEpochLoss,
      lossHistory,
      trainedAt: new Date().toISOString(),
    },
  };

  candidateModel.metrics.trainAccuracy = evaluateSplitAccuracy(candidateModel, trainRaw);
  candidateModel.metrics.valAccuracy = evaluateSplitAccuracy(candidateModel, valRaw);

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
    m.version !== 1 ||
    m.featureVersion !== NSL_FEATURE_VERSION ||
    m.featureDim !== NSL_FEATURE_DIM ||
    m.sequenceLength !== NSL_SEQUENCE_LENGTH ||
    m.descriptorDim !== NSL_DESCRIPTOR_DIM ||
    typeof m.hiddenDim !== 'number' ||
    m.hiddenDim < 8 ||
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
  const H = m.hiddenDim;
  const C = m.classes.length;

  if (
    !m.scaler ||
    !isFiniteNumberArray(m.scaler.mean, D) ||
    !isFiniteNumberArray(m.scaler.std, D) ||
    !m.weights ||
    !isFiniteNumberArray(m.weights.w1, H * D) ||
    !isFiniteNumberArray(m.weights.b1, H) ||
    !isFiniteNumberArray(m.weights.w2, C * H) ||
    !isFiniteNumberArray(m.weights.b2, C) ||
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

export function serializeModelJson(model: NslTrainedModel): string {
  return JSON.stringify(model, null, 2);
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
 * Loads optional bundled default NSL model weights from `/models/nsl-model.json` once.
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
