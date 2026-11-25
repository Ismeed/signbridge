import type { NormalizedPoint, TrackingFrame } from '@/lib/neuralVision';

/** Version identifier stamped onto extracted NSL feature sequences. */
export const NSL_FEATURE_VERSION = 'nsl-v1' as const;

/** Fixed per-frame feature dimensionality for NSL posture, hand shape, and motion. */
export const NSL_FEATURE_DIM = 145;

/** Fixed target frame count produced by temporal resampling for model training/inference. */
export const NSL_SEQUENCE_LENGTH = 30;

/** Minimum raw frames required for a captured clip to represent a dynamic sign. */
export const NSL_MIN_RAW_FRAMES = 8;

const UPPER_BODY_INDICES = [0, 11, 12, 13, 14, 15, 16] as const;
const HAND_START_LEFT = 15;
const HAND_START_RIGHT = 78;
const PRESENCE_INDICES = new Set<number>([0, HAND_START_LEFT, HAND_START_RIGHT]);

export interface NslFrameFeatures {
  vector: number[];
  hasPose: boolean;
  hasLeftHand: boolean;
  hasRightHand: boolean;
  hasHands: boolean;
}

export interface NslSequenceQuality {
  rawFrameCount: number;
  durationMs: number;
  fpsEstimate: number;
  handCoverageRatio: number;
  poseCoverageRatio: number;
  handedness: 'left' | 'right' | 'both' | 'none';
  isUsable: boolean;
}

interface AnchorTransform {
  x: number;
  y: number;
  scale: number;
  hasPose: boolean;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function clampFinite(value: number, limit = 4): number {
  if (!Number.isFinite(value)) return 0;
  if (value > limit) return limit;
  if (value < -limit) return -limit;
  return round4(value);
}

function isValidPoint(point: NormalizedPoint | undefined, minVisibility = 0.2): point is NormalizedPoint {
  if (!point) return false;
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
  if (point.visibility !== undefined && point.visibility < minVisibility) return false;
  return true;
}

function computeAnchor(frame: TrackingFrame): AnchorTransform {
  const pose = frame.poseLandmarks;
  const leftShoulder = pose.length > 12 ? pose[11] : undefined;
  const rightShoulder = pose.length > 12 ? pose[12] : undefined;

  if (isValidPoint(leftShoulder, 0.25) && isValidPoint(rightShoulder, 0.25)) {
    const x = (leftShoulder.x + rightShoulder.x) / 2;
    const y = (leftShoulder.y + rightShoulder.y) / 2;
    const shoulderWidth = Math.hypot(
      rightShoulder.x - leftShoulder.x,
      rightShoulder.y - leftShoulder.y
    );
    return {
      x,
      y,
      scale: Math.max(shoulderWidth, 0.12),
      hasPose: true,
    };
  }

  if (frame.faceBox && frame.faceBox.width > 0 && frame.faceBox.height > 0) {
    return {
      x: frame.faceBox.x + frame.faceBox.width / 2,
      y: frame.faceBox.y + frame.faceBox.height * 1.4,
      scale: Math.max(frame.faceBox.width * 2.0, 0.16),
      hasPose: false,
    };
  }

  return {
    x: 0.5,
    y: 0.45,
    scale: 0.35,
    hasPose: false,
  };
}

function writeHandSlice(
  out: number[],
  offset: number,
  hand: NormalizedPoint[] | null,
  anchor: AnchorTransform
): boolean {
  if (!hand || hand.length < 21 || !isValidPoint(hand[0], 0)) {
    return false;
  }

  const wrist = hand[0];
  const middleMcp = isValidPoint(hand[9], 0) ? hand[9] : null;
  const indexMcp = isValidPoint(hand[5], 0) ? hand[5] : null;
  const pinkyMcp = isValidPoint(hand[17], 0) ? hand[17] : null;

  const refJoint = middleMcp ?? indexMcp ?? pinkyMcp;
  const rawPalm = refJoint ? Math.hypot(refJoint.x - wrist.x, refJoint.y - wrist.y) : 0.08;
  const palmScale = Math.max(rawPalm, 0.025);

  out[offset] = 1;
  out[offset + 1] = clampFinite((wrist.x - anchor.x) / anchor.scale);
  out[offset + 2] = clampFinite((wrist.y - anchor.y) / anchor.scale);

  let cursor = offset + 3;
  for (let i = 1; i < 21; i++) {
    const pt = hand[i];
    if (isValidPoint(pt, 0)) {
      out[cursor] = clampFinite((pt.x - wrist.x) / palmScale);
      out[cursor + 1] = clampFinite((pt.y - wrist.y) / palmScale);
      out[cursor + 2] = clampFinite(((pt.z ?? 0) - (wrist.z ?? 0)) / palmScale);
    }
    cursor += 3;
  }

  return true;
}

function computeWristDelta(
  currHand: NormalizedPoint[] | null,
  prevHand: NormalizedPoint[] | null,
  anchor: AnchorTransform,
  prevAnchor: AnchorTransform | null,
  stepScale: number
): [number, number] {
  if (!currHand || !prevHand || !prevAnchor) return [0, 0];
  const cw = currHand[0];
  const pw = prevHand[0];
  if (!isValidPoint(cw, 0) || !isValidPoint(pw, 0)) return [0, 0];

  const currNormX = (cw.x - anchor.x) / anchor.scale;
  const currNormY = (cw.y - anchor.y) / anchor.scale;
  const prevNormX = (pw.x - prevAnchor.x) / prevAnchor.scale;
  const prevNormY = (pw.y - prevAnchor.y) / prevAnchor.scale;

  return [
    clampFinite((currNormX - prevNormX) * stepScale, 3),
    clampFinite((currNormY - prevNormY) * stepScale, 3),
  ];
}

/**
 * Converts a raw MediaPipe TrackingFrame into a canonical 145-dim feature vector
 * invariant to camera translation and torso/palm scale.
 */
export function extractNslFrameFeatures(
  frame: TrackingFrame,
  prevFrame?: TrackingFrame | null
): NslFrameFeatures {
  const vector = new Array<number>(NSL_FEATURE_DIM).fill(0);
  const anchor = computeAnchor(frame);

  // [0..14] Upper-body pose anchor summary (hasPose + 7 normalized 2D joints)
  vector[0] = anchor.hasPose ? 1 : 0;
  if (anchor.hasPose) {
    let cursor = 1;
    for (const jointIdx of UPPER_BODY_INDICES) {
      const pt = frame.poseLandmarks[jointIdx];
      if (isValidPoint(pt, 0.2)) {
        vector[cursor] = clampFinite((pt.x - anchor.x) / anchor.scale);
        vector[cursor + 1] = clampFinite((pt.y - anchor.y) / anchor.scale);
      }
      cursor += 2;
    }
  }

  // [15..77] Left hand and [78..140] Right hand
  const hasLeftHand = writeHandSlice(vector, HAND_START_LEFT, frame.leftHandLandmarks, anchor);
  const hasRightHand = writeHandSlice(vector, HAND_START_RIGHT, frame.rightHandLandmarks, anchor);

  // [141..144] Time-normalized torso-relative wrist velocities
  let stepScale = 1;
  let prevAnchor: AnchorTransform | null = null;
  if (prevFrame) {
    prevAnchor = computeAnchor(prevFrame);
    const dtSec = (frame.timestamp - prevFrame.timestamp) / 1000;
    if (dtSec >= 0.005 && dtSec <= 0.6) {
      stepScale = Math.min(Math.max((1 / 30) / dtSec, 0.1), 4);
    } else {
      stepScale = 0;
    }
  }

  if (stepScale > 0 && prevFrame) {
    const [lvx, lvy] = computeWristDelta(
      frame.leftHandLandmarks,
      prevFrame.leftHandLandmarks,
      anchor,
      prevAnchor,
      stepScale
    );
    const [rvx, rvy] = computeWristDelta(
      frame.rightHandLandmarks,
      prevFrame.rightHandLandmarks,
      anchor,
      prevAnchor,
      stepScale
    );
    vector[141] = lvx;
    vector[142] = lvy;
    vector[143] = rvx;
    vector[144] = rvy;
  }

  return {
    vector,
    hasPose: anchor.hasPose,
    hasLeftHand,
    hasRightHand,
    hasHands: hasLeftHand || hasRightHand,
  };
}

/**
 * Linearly resamples a variable-length sequence of frame vectors to fixed length T.
 * Binary landmark-presence dimensions remain snapped to 0 or 1.
 */
export function resampleNslSequence(
  frames: number[][],
  targetLength = NSL_SEQUENCE_LENGTH
): number[][] {
  if (frames.length === 0 || targetLength <= 0) {
    return [];
  }

  const dim = frames[0].length;
  if (frames.length === 1) {
    const single = frames[0].map((v) => clampFinite(v));
    return Array.from({ length: targetLength }, () => [...single]);
  }

  if (targetLength === 1) {
    return [frames[0].map((v) => clampFinite(v))];
  }

  const result: number[][] = [];
  const maxSrcIdx = frames.length - 1;

  for (let t = 0; t < targetLength; t++) {
    const srcPos = (t * maxSrcIdx) / (targetLength - 1);
    const lowIdx = Math.floor(srcPos);
    const highIdx = Math.min(lowIdx + 1, maxSrcIdx);
    const alpha = srcPos - lowIdx;

    const lowVec = frames[lowIdx];
    const highVec = frames[highIdx];
    const row = new Array<number>(dim).fill(0);

    for (let d = 0; d < dim; d++) {
      const a = Number.isFinite(lowVec[d]) ? lowVec[d] : 0;
      const b = Number.isFinite(highVec[d]) ? highVec[d] : 0;
      const interpolated = a + (b - a) * alpha;
      row[d] = PRESENCE_INDICES.has(d)
        ? interpolated >= 0.5
          ? 1
          : 0
        : clampFinite(interpolated);
    }

    result.push(row);
  }

  return result;
}

/**
 * Computes clip duration, FPS, hand/pose coverage, and dataset usability metrics.
 */
export function evaluateSequenceQuality(
  frames: NslFrameFeatures[],
  durationMs: number
): NslSequenceQuality {
  const rawFrameCount = frames.length;
  const safeDurationMs = Math.max(0, Math.round(durationMs));
  const fpsEstimate =
    safeDurationMs > 0 && rawFrameCount > 1
      ? Math.round(((rawFrameCount - 1) / (safeDurationMs / 1000)) * 10) / 10
      : 0;

  if (rawFrameCount === 0) {
    return {
      rawFrameCount: 0,
      durationMs: safeDurationMs,
      fpsEstimate: 0,
      handCoverageRatio: 0,
      poseCoverageRatio: 0,
      handedness: 'none',
      isUsable: false,
    };
  }

  let handFrames = 0;
  let poseFrames = 0;
  let leftFrames = 0;
  let rightFrames = 0;

  for (const frame of frames) {
    if (frame.hasHands) handFrames += 1;
    if (frame.hasPose) poseFrames += 1;
    if (frame.hasLeftHand) leftFrames += 1;
    if (frame.hasRightHand) rightFrames += 1;
  }

  const handCoverageRatio = round4(handFrames / rawFrameCount);
  const poseCoverageRatio = round4(poseFrames / rawFrameCount);
  const handedness: NslSequenceQuality['handedness'] =
    leftFrames > 0 && rightFrames > 0
      ? 'both'
      : leftFrames > 0
      ? 'left'
      : rightFrames > 0
      ? 'right'
      : 'none';

  return {
    rawFrameCount,
    durationMs: safeDurationMs,
    fpsEstimate,
    handCoverageRatio,
    poseCoverageRatio,
    handedness,
    isUsable: rawFrameCount >= NSL_MIN_RAW_FRAMES && handCoverageRatio >= 0.35,
  };
}

function isFrameSigningActive(vec: number[]): boolean {
  const hasLeft = (vec[HAND_START_LEFT] ?? 0) >= 0.5;
  const hasRight = (vec[HAND_START_RIGHT] ?? 0) >= 0.5;
  if (!hasLeft && !hasRight) return false;

  const speed =
    Math.hypot(vec[141] ?? 0, vec[142] ?? 0) + Math.hypot(vec[143] ?? 0, vec[144] ?? 0);

  // Normalized wrist Y = (wrist.y - shoulderCenter.y) / shoulderWidth:
  // <= 1.05 means hand is raised into chest/face signing space; > 1.05 is hanging low at waist.
  const leftElevated = hasLeft && (vec[HAND_START_LEFT + 2] ?? 1.5) <= 1.05;
  const rightElevated = hasRight && (vec[HAND_START_RIGHT + 2] ?? 1.5) <= 1.05;

  return leftElevated || rightElevated || speed >= 0.035;
}

/**
 * Trims leading and trailing dead/idle frames (hands absent or hanging motionless below waist)
 * while preserving a small onset/offset margin and at least `minKeepFrames` frames.
 */
export function trimActiveNslFrames(
  vectors: number[][],
  minKeepFrames = NSL_MIN_RAW_FRAMES
): number[][] {
  if (vectors.length <= minKeepFrames) {
    return vectors;
  }

  let firstActive = -1;
  let lastActive = -1;
  for (let i = 0; i < vectors.length; i++) {
    if (isFrameSigningActive(vectors[i])) {
      if (firstActive === -1) firstActive = i;
      lastActive = i;
    }
  }

  // Fallback to any frame with visible hands if all hands stayed low/slow
  if (firstActive === -1) {
    for (let i = 0; i < vectors.length; i++) {
      const v = vectors[i];
      if ((v[HAND_START_LEFT] ?? 0) >= 0.5 || (v[HAND_START_RIGHT] ?? 0) >= 0.5) {
        if (firstActive === -1) firstActive = i;
        lastActive = i;
      }
    }
  }

  if (firstActive === -1 || lastActive === -1) {
    return vectors;
  }

  let start = Math.max(0, firstActive - 2);
  let end = Math.min(vectors.length, lastActive + 3);

  while (end - start < minKeepFrames) {
    if (start > 0) start -= 1;
    if (end - start < minKeepFrames && end < vectors.length) end += 1;
    if (start === 0 && end === vectors.length) break;
  }

  return vectors.slice(start, end);
}

function copyMirroredHandSlice(out: number[], dstOffset: number, src: number[], srcOffset: number): void {
  const present = (src[srcOffset] ?? 0) >= 0.5 ? 1 : 0;
  out[dstOffset] = present;
  if (!present) return;

  out[dstOffset + 1] = clampFinite(-(src[srcOffset + 1] ?? 0));
  out[dstOffset + 2] = clampFinite(src[srcOffset + 2] ?? 0);

  for (let j = 1; j < 21; j++) {
    const sIdx = srcOffset + 3 + (j - 1) * 3;
    const dIdx = dstOffset + 3 + (j - 1) * 3;
    out[dIdx] = clampFinite(-(src[sIdx] ?? 0));
    out[dIdx + 1] = clampFinite(src[sIdx + 1] ?? 0);
    out[dIdx + 2] = clampFinite(src[sIdx + 2] ?? 0);
  }
}

/**
 * Applies an exact horizontal reflection + Left/Right anatomical swap to a single 145-dim frame.
 * Makes recognition invariant to left- vs right-handed signing and camera mirroring.
 */
export function mirrorNslVector(vec: number[]): number[] {
  const out = new Array<number>(NSL_FEATURE_DIM).fill(0);
  const hasPose = (vec[0] ?? 0) >= 0.5 ? 1 : 0;
  out[0] = hasPose;

  if (hasPose) {
    // Nose (joint 0 -> indices [1, 2])
    out[1] = clampFinite(-(vec[1] ?? 0));
    out[2] = clampFinite(vec[2] ?? 0);

    // Swap (L_SHOULDER [3,4] <-> R_SHOULDER [5,6]), (L_ELBOW [7,8] <-> R_ELBOW [9,10]), (L_WRIST [11,12] <-> R_WRIST [13,14])
    const pairs: Array<[number, number]> = [
      [3, 5],
      [7, 9],
      [11, 13],
    ];
    for (const [leftIdx, rightIdx] of pairs) {
      out[leftIdx] = clampFinite(-(vec[rightIdx] ?? 0));
      out[leftIdx + 1] = clampFinite(vec[rightIdx + 1] ?? 0);
      out[rightIdx] = clampFinite(-(vec[leftIdx] ?? 0));
      out[rightIdx + 1] = clampFinite(vec[leftIdx + 1] ?? 0);
    }
  }

  // Swap Left Hand [15..77] <-> Right Hand [78..140] with X negated
  copyMirroredHandSlice(out, HAND_START_LEFT, vec, HAND_START_RIGHT);
  copyMirroredHandSlice(out, HAND_START_RIGHT, vec, HAND_START_LEFT);

  // Swap & X-reflect wrist velocities ([141,142] <-> [143,144])
  out[141] = clampFinite(-(vec[143] ?? 0), 3);
  out[142] = clampFinite(vec[144] ?? 0, 3);
  out[143] = clampFinite(-(vec[141] ?? 0), 3);
  out[144] = clampFinite(vec[142] ?? 0, 3);

  return out;
}

/** Applies `mirrorNslVector` across an entire `[T x 145]` NSL feature sequence. */
export function mirrorNslSequence(sequence: number[][]): number[][] {
  return sequence.map(mirrorNslVector);
}

