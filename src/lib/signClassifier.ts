import {
  extractNslFrameFeatures,
  NSL_FEATURE_DIM,
  NSL_MIN_RAW_FRAMES,
  NSL_SEQUENCE_LENGTH,
  resampleNslSequence,
  trimActiveNslFrames,
} from '@/lib/nslFeatures';
import type { TrackingFrame } from '@/lib/neuralVision';
import {
  computeSequenceMotionStats,
  getCachedBundledModel,
  getVisibleModelClasses,
  loadBundledDefaultModel,
  loadTrainedModel,
  NSL_IDLE_CLASS_ID,
  predictSequence,
  type NslPredictionCandidate,
  type NslTrainedModel,
} from '@/lib/nslModel';

export type ClassificationStatus = 'no_model' | 'no_hands' | 'uncertain' | 'recognized';

export interface SignClassificationResult {
  status: ClassificationStatus;
  labelId: string | null;
  labelName: string | null;
  confidence: number;
  margin: number;
  cosineSimilarity: number;
  handCoverage: number;
  candidates: NslPredictionCandidate[];
}

export interface StreamingClassifierTick {
  evaluated: boolean;
  detection: SignClassificationResult | null;
  latest: SignClassificationResult | null;
}

export interface ClassifierThresholds {
  minHandCoverage: number;
  minConfidence: number;
  minMargin: number;
  minCosineSimilarity: number;
  maxZRms: number;
  windowMs: number;
  evalIntervalMs: number;
  consensusCount: number;
  cooldownMs: number;
}

const DEFAULT_THRESHOLDS: ClassifierThresholds = {
  minHandCoverage: 0.35,
  minConfidence: 0.56,
  minMargin: 0.14,
  minCosineSimilarity: 0.38,
  maxZRms: 2.8,
  windowMs: 1800,
  evalIntervalMs: 220,
  consensusCount: 2,
  cooldownMs: 2600,
};

interface BufferedFrame {
  timestamp: number;
  vector: number[];
}

/**
 * On-device real-time NSL sign classifier operating over normalized 30x145 landmark clips
 * and live sliding-window camera streams with active-gesture trimming, chirality invariance,
 * `_idle` background rejection, and temporal consensus debouncing.
 */
export class SignClassifier {
  private model: NslTrainedModel | null;
  private thresholds: ClassifierThresholds;

  private buffer: BufferedFrame[] = [];
  private prevFrame: TrackingFrame | null = null;
  private lastEvalTimestamp: number | null = null;
  private streakLabelId: string | null = null;
  private streakCount = 0;
  private lastEmittedLabelId: string | null = null;
  private lastEmittedTimestamp: number | null = null;
  private lastResult: SignClassificationResult | null = null;

  constructor(options?: {
    model?: NslTrainedModel | null;
    thresholds?: Partial<ClassifierThresholds>;
  }) {
    this.model = options && 'model' in options ? options.model ?? null : loadTrainedModel();
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...(options?.thresholds ?? {}) };
  }

  reloadFromStorage(): NslTrainedModel | null {
    this.model = loadTrainedModel() ?? getCachedBundledModel();
    this.reset();
    return this.model;
  }

  async ensureModelLoaded(): Promise<NslTrainedModel | null> {
    const local = loadTrainedModel();
    if (local) {
      if (this.model !== local) {
        this.model = local;
        this.reset();
      }
      return local;
    }
    const bundled = await loadBundledDefaultModel();
    if (bundled && !this.model) {
      this.model = bundled;
      this.reset();
    }
    return this.model;
  }

  setModel(model: NslTrainedModel | null): void {
    this.model = model;
    this.reset();
  }

  getModel(): NslTrainedModel | null {
    return this.model;
  }

  isReady(): boolean {
    return this.model !== null && getVisibleModelClasses(this.model).length >= 2;
  }

  reset(): void {
    this.buffer = [];
    this.prevFrame = null;
    this.lastEvalTimestamp = null;
    this.streakLabelId = null;
    this.streakCount = 0;
    this.lastEmittedLabelId = null;
    this.lastEmittedTimestamp = null;
    this.lastResult = null;
  }

  /** Classifies a single resampled [30 x 145] NSL landmark sequence. */
  classifySequence(sequence: number[][]): SignClassificationResult {
    if (!this.model || getVisibleModelClasses(this.model).length < 2) {
      return {
        status: 'no_model',
        labelId: null,
        labelName: null,
        confidence: 0,
        margin: 0,
        cosineSimilarity: 0,
        handCoverage: 0,
        candidates: [],
      };
    }

    if (
      sequence.length !== NSL_SEQUENCE_LENGTH ||
      sequence[0]?.length !== NSL_FEATURE_DIM
    ) {
      return {
        status: 'uncertain',
        labelId: null,
        labelName: null,
        confidence: 0,
        margin: 0,
        cosineSimilarity: 0,
        handCoverage: 0,
        candidates: [],
      };
    }

    const motion = computeSequenceMotionStats(sequence);
    if (motion.handCoverage < this.thresholds.minHandCoverage) {
      return {
        status: 'no_hands',
        labelId: null,
        labelName: null,
        confidence: 0,
        margin: 0,
        cosineSimilarity: 0,
        handCoverage: motion.handCoverage,
        candidates: [],
      };
    }

    const out = predictSequence(this.model, sequence);
    const topClass = this.model.classes[out.topIndex];

    // Explicitly suppress background/non-signing idle class
    if (!topClass || topClass.id === NSL_IDLE_CLASS_ID) {
      return {
        status: 'uncertain',
        labelId: null,
        labelName: null,
        confidence: Math.round(out.confidence * 1000) / 1000,
        margin: Math.round(out.margin * 1000) / 1000,
        cosineSimilarity: Math.round(out.cosineSimilarity * 1000) / 1000,
        handCoverage: Math.round(motion.handCoverage * 1000) / 1000,
        candidates: out.candidates,
      };
    }

    const passesConfidence = out.confidence >= this.thresholds.minConfidence;
    const passesMargin = out.margin >= this.thresholds.minMargin;
    const passesCosine = out.cosineSimilarity >= this.thresholds.minCosineSimilarity;
    const passesZRange = out.zRms <= this.thresholds.maxZRms;

    if (passesConfidence && passesMargin && passesCosine && passesZRange) {
      return {
        status: 'recognized',
        labelId: topClass.id,
        labelName: topClass.name,
        confidence: Math.round(out.confidence * 1000) / 1000,
        margin: Math.round(out.margin * 1000) / 1000,
        cosineSimilarity: Math.round(out.cosineSimilarity * 1000) / 1000,
        handCoverage: Math.round(motion.handCoverage * 1000) / 1000,
        candidates: out.candidates,
      };
    }

    return {
      status: 'uncertain',
      labelId: null,
      labelName: null,
      confidence: Math.round(out.confidence * 1000) / 1000,
      margin: Math.round(out.margin * 1000) / 1000,
      cosineSimilarity: Math.round(out.cosineSimilarity * 1000) / 1000,
      handCoverage: Math.round(motion.handCoverage * 1000) / 1000,
      candidates: out.candidates,
    };
  }

  /**
   * Streams a live MediaPipe TrackingFrame into the sliding temporal window and emits
   * a debounced sign detection when stability consensus + cooldown criteria are met.
   */
  pushFrame(frame: TrackingFrame): StreamingClassifierTick {
    if (!this.isReady()) {
      return {
        evaluated: false,
        detection: null,
        latest: {
          status: 'no_model',
          labelId: null,
          labelName: null,
          confidence: 0,
          margin: 0,
          cosineSimilarity: 0,
          handCoverage: 0,
          candidates: [],
        },
      };
    }

    if (this.prevFrame && frame.timestamp < this.prevFrame.timestamp) {
      this.reset();
    }

    const features = extractNslFrameFeatures(frame, this.prevFrame);
    this.prevFrame = frame;
    this.buffer.push({ timestamp: frame.timestamp, vector: features.vector });

    const cutoff = frame.timestamp - this.thresholds.windowMs;
    while (this.buffer.length > 0 && this.buffer[0].timestamp < cutoff) {
      this.buffer.shift();
    }

    if (
      this.lastEvalTimestamp !== null &&
      frame.timestamp - this.lastEvalTimestamp < this.thresholds.evalIntervalMs
    ) {
      return {
        evaluated: false,
        detection: null,
        latest: this.lastResult,
      };
    }

    if (this.buffer.length < NSL_MIN_RAW_FRAMES) {
      return {
        evaluated: false,
        detection: null,
        latest: this.lastResult,
      };
    }

    this.lastEvalTimestamp = frame.timestamp;
    const activeWindow = trimActiveNslFrames(
      this.buffer.map((entry) => entry.vector),
      NSL_MIN_RAW_FRAMES
    );
    const resampled = resampleNslSequence(activeWindow, NSL_SEQUENCE_LENGTH);
    const result = this.classifySequence(resampled);
    this.lastResult = result;

    if (result.status !== 'recognized' || !result.labelId) {
      this.streakLabelId = null;
      this.streakCount = 0;
      return { evaluated: true, detection: null, latest: result };
    }

    if (this.streakLabelId === result.labelId) {
      this.streakCount += 1;
    } else {
      this.streakLabelId = result.labelId;
      this.streakCount = 1;
    }

    if (this.streakCount < this.thresholds.consensusCount) {
      return { evaluated: true, detection: null, latest: result };
    }

    const cooldownElapsed =
      this.lastEmittedTimestamp === null ||
      frame.timestamp - this.lastEmittedTimestamp >= this.thresholds.cooldownMs;
    const changedSign = result.labelId !== this.lastEmittedLabelId;

    if (cooldownElapsed || changedSign) {
      this.lastEmittedTimestamp = frame.timestamp;
      this.lastEmittedLabelId = result.labelId;
      this.streakCount = 0;
      return { evaluated: true, detection: result, latest: result };
    }

    return { evaluated: true, detection: null, latest: result };
  }
}

export const signClassifier = new SignClassifier();
