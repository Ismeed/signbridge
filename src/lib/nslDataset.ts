import { DEMO_PHRASES } from '@/lib/translations';
import {
  NSL_FEATURE_DIM,
  NSL_FEATURE_VERSION,
  NSL_SEQUENCE_LENGTH,
  type NslSequenceQuality,
} from '@/lib/nslFeatures';

export const NSL_DATASET_STORAGE_KEY = 'signbridge_nsl_dataset_v1';
export const NSL_CUSTOM_LABELS_STORAGE_KEY = 'signbridge_nsl_labels_v1';
export const NSL_SIGNER_TAG_STORAGE_KEY = 'signbridge_nsl_signer_tag_v1';

export interface NslLabelDefinition {
  id: string;
  name: string;
  category: string;
  isBuiltin: boolean;
}

export interface NslRecordedSample {
  id: string;
  labelId: string;
  labelName: string;
  signerTag?: string;
  featureVersion: typeof NSL_FEATURE_VERSION;
  featureDim: number;
  sequenceLength: number;
  sequence: number[][];
  rawFrameCount: number;
  durationMs: number;
  fpsEstimate: number;
  handCoverageRatio: number;
  handedness: NslSequenceQuality['handedness'];
  cameraFacing: 'user' | 'environment';
  createdAt: string;
}

export interface NslDatasetExport {
  schema: 'signbridge-nsl-dataset';
  version: 1;
  featureVersion: typeof NSL_FEATURE_VERSION;
  featureDim: number;
  sequenceLength: number;
  exportedAt: string;
  labels: NslLabelDefinition[];
  samples: NslRecordedSample[];
}

export type SaveSampleResult =
  | { ok: true; sample: NslRecordedSample; samples: NslRecordedSample[] }
  | { ok: false; error: string; samples: NslRecordedSample[] };

export type ParseDatasetResult =
  | { ok: true; dataset: NslDatasetExport }
  | { ok: false; error: string };

function isBrowserStorageAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function slugifyLabel(input: string): string {
  const parts = input
    .toLowerCase()
    .trim()
    .split(/[^a-z0-9]+/)
    .filter((segment) => segment.length > 0);
  return parts.length > 0 ? parts.join('-') : 'custom-sign';
}

function createSampleId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `nsl-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function isValidSequenceMatrix(sequence: unknown): sequence is number[][] {
  if (!Array.isArray(sequence) || sequence.length !== NSL_SEQUENCE_LENGTH) {
    return false;
  }
  for (const row of sequence) {
    if (!Array.isArray(row) || row.length !== NSL_FEATURE_DIM) {
      return false;
    }
    for (const val of row) {
      if (typeof val !== 'number' || !Number.isFinite(val)) {
        return false;
      }
    }
  }
  return true;
}

export function isValidRecordedSample(candidate: unknown): candidate is NslRecordedSample {
  if (!candidate || typeof candidate !== 'object') return false;
  const item = candidate as Partial<NslRecordedSample>;
  return (
    typeof item.id === 'string' &&
    item.id.length > 0 &&
    typeof item.labelId === 'string' &&
    item.labelId.length > 0 &&
    typeof item.labelName === 'string' &&
    item.labelName.length > 0 &&
    (item.signerTag === undefined ||
      (typeof item.signerTag === 'string' && item.signerTag.length <= 64)) &&
    item.featureVersion === NSL_FEATURE_VERSION &&
    item.featureDim === NSL_FEATURE_DIM &&
    item.sequenceLength === NSL_SEQUENCE_LENGTH &&
    typeof item.rawFrameCount === 'number' &&
    typeof item.durationMs === 'number' &&
    typeof item.fpsEstimate === 'number' &&
    typeof item.handCoverageRatio === 'number' &&
    (item.handedness === 'left' ||
      item.handedness === 'right' ||
      item.handedness === 'both' ||
      item.handedness === 'none') &&
    (item.cameraFacing === 'user' || item.cameraFacing === 'environment') &&
    typeof item.createdAt === 'string' &&
    isValidSequenceMatrix(item.sequence)
  );
}

/** Returns built-in NSL labels derived from the app's canonical demo phrase concepts. */
export function getBuiltinNslLabels(): NslLabelDefinition[] {
  return DEMO_PHRASES.map((phrase) => ({
    id: phrase.id,
    name: phrase.signConcept,
    category: phrase.category,
    isBuiltin: true,
  }));
}

export function loadCustomNslLabels(): NslLabelDefinition[] {
  if (!isBrowserStorageAvailable()) return [];
  try {
    const raw = window.localStorage.getItem(NSL_CUSTOM_LABELS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is NslLabelDefinition => {
      if (!item || typeof item !== 'object') return false;
      const label = item as Partial<NslLabelDefinition>;
      return (
        typeof label.id === 'string' &&
        label.id.length > 0 &&
        typeof label.name === 'string' &&
        label.name.length > 0 &&
        typeof label.category === 'string' &&
        label.isBuiltin === false
      );
    });
  } catch {
    return [];
  }
}

export function getAllNslLabels(): NslLabelDefinition[] {
  const builtins = getBuiltinNslLabels();
  const seen = new Set(builtins.map((label) => label.id));
  const custom = loadCustomNslLabels().filter((label) => !seen.has(label.id));
  return [...builtins, ...custom];
}

export function addCustomNslLabel(name: string, category = 'Custom'): NslLabelDefinition | null {
  const cleanedName = name.trim();
  if (cleanedName.length < 2) return null;

  const existing = getAllNslLabels();
  const baseSlug = slugifyLabel(cleanedName);
  const matchingExisting = existing.find(
    (item) => item.id === baseSlug || item.name.toLowerCase() === cleanedName.toLowerCase()
  );
  if (matchingExisting) {
    return matchingExisting;
  }

  const label: NslLabelDefinition = {
    id: baseSlug,
    name: cleanedName,
    category: category.trim().length > 0 ? category.trim() : 'Custom',
    isBuiltin: false,
  };

  if (isBrowserStorageAvailable()) {
    try {
      const updated = [...loadCustomNslLabels(), label];
      window.localStorage.setItem(NSL_CUSTOM_LABELS_STORAGE_KEY, JSON.stringify(updated));
    } catch {
      return null;
    }
  }

  return label;
}

export function loadNslSamples(): NslRecordedSample[] {
  if (!isBrowserStorageAvailable()) return [];
  try {
    const raw = window.localStorage.getItem(NSL_DATASET_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidRecordedSample);
  } catch {
    return [];
  }
}

const NSL_DATASET_EVENT = 'signbridge:nsl-dataset';

let lastSnapshotRaw: string | null | undefined;
let lastSnapshotCount = 0;

function emitDatasetChanged(): void {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new Event(NSL_DATASET_EVENT));
  }
}

export function subscribeNslDataset(listener: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
    return () => {};
  }
  window.addEventListener(NSL_DATASET_EVENT, listener);
  window.addEventListener('storage', listener);
  return () => {
    window.removeEventListener(NSL_DATASET_EVENT, listener);
    window.removeEventListener('storage', listener);
  };
}

export function getNslSampleCountSnapshot(): number {
  if (!isBrowserStorageAvailable()) return 0;
  try {
    const raw = window.localStorage.getItem(NSL_DATASET_STORAGE_KEY);
    if (raw === lastSnapshotRaw) return lastSnapshotCount;
    lastSnapshotRaw = raw;
    lastSnapshotCount = loadNslSamples().length;
    return lastSnapshotCount;
  } catch {
    return 0;
  }
}

function persistSamples(samples: NslRecordedSample[]): { ok: true } | { ok: false; error: string } {
  if (!isBrowserStorageAvailable()) {
    return { ok: false, error: 'Browser storage is unavailable in this environment.' };
  }
  try {
    window.localStorage.setItem(NSL_DATASET_STORAGE_KEY, JSON.stringify(samples));
    emitDatasetChanged();
    return { ok: true };
  } catch {
    return {
      ok: false,
      error: 'Device storage limit reached. Export your JSON dataset, then clear old clips.',
    };
  }
}

export interface NewSamplePayload {
  labelId: string;
  labelName: string;
  signerTag?: string;
  sequence: number[][];
  quality: NslSequenceQuality;
  cameraFacing: 'user' | 'environment';
}

export function normalizeSignerTag(raw?: string | null): string {
  const cleaned = (raw ?? 'local-signer').trim().slice(0, 48);
  return cleaned.length > 0 ? cleaned : 'local-signer';
}

export function loadSavedSignerTag(): string | null {
  if (!isBrowserStorageAvailable()) return null;
  try {
    const val = window.localStorage.getItem(NSL_SIGNER_TAG_STORAGE_KEY)?.trim();
    return val && val.length > 0 ? val : null;
  } catch {
    return null;
  }
}

export function saveSignerTag(tag: string): void {
  if (!isBrowserStorageAvailable()) return;
  try {
    const cleaned = tag.trim().slice(0, 48);
    if (cleaned.length > 0) {
      window.localStorage.setItem(NSL_SIGNER_TAG_STORAGE_KEY, cleaned);
    } else {
      window.localStorage.removeItem(NSL_SIGNER_TAG_STORAGE_KEY);
    }
  } catch {
    // Ignore storage error.
  }
}

export function saveNslSample(payload: NewSamplePayload): SaveSampleResult {
  const existing = loadNslSamples();

  if (!isValidSequenceMatrix(payload.sequence)) {
    return {
      ok: false,
      error: 'Invalid feature sequence shape; sample was not saved.',
      samples: existing,
    };
  }

  const sample: NslRecordedSample = {
    id: createSampleId(),
    labelId: payload.labelId,
    labelName: payload.labelName,
    signerTag: normalizeSignerTag(payload.signerTag),
    featureVersion: NSL_FEATURE_VERSION,
    featureDim: NSL_FEATURE_DIM,
    sequenceLength: NSL_SEQUENCE_LENGTH,
    sequence: payload.sequence,
    rawFrameCount: payload.quality.rawFrameCount,
    durationMs: payload.quality.durationMs,
    fpsEstimate: payload.quality.fpsEstimate,
    handCoverageRatio: payload.quality.handCoverageRatio,
    handedness: payload.quality.handedness,
    cameraFacing: payload.cameraFacing,
    createdAt: new Date().toISOString(),
  };

  const updated = [sample, ...existing];
  const saved = persistSamples(updated);
  if (!saved.ok) {
    return { ok: false, error: saved.error, samples: existing };
  }

  return { ok: true, sample, samples: updated };
}

export function deleteNslSample(sampleId: string): NslRecordedSample[] {
  const updated = loadNslSamples().filter((sample) => sample.id !== sampleId);
  persistSamples(updated);
  return updated;
}

export function clearNslDataset(): void {
  if (!isBrowserStorageAvailable()) return;
  try {
    window.localStorage.removeItem(NSL_DATASET_STORAGE_KEY);
    emitDatasetChanged();
  } catch {
    // Ignore storage removal failure.
  }
}

export function countSamplesByLabel(samples: NslRecordedSample[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const sample of samples) {
    counts[sample.labelId] = (counts[sample.labelId] ?? 0) + 1;
  }
  return counts;
}

export function serializeDatasetJson(
  samples: NslRecordedSample[],
  labels: NslLabelDefinition[] = getAllNslLabels()
): string {
  const payload: NslDatasetExport = {
    schema: 'signbridge-nsl-dataset',
    version: 1,
    featureVersion: NSL_FEATURE_VERSION,
    featureDim: NSL_FEATURE_DIM,
    sequenceLength: NSL_SEQUENCE_LENGTH,
    exportedAt: new Date().toISOString(),
    labels,
    samples,
  };
  return JSON.stringify(payload, null, 2);
}

export function parseImportedDatasetJson(rawJson: string): ParseDatasetResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return { ok: false, error: 'File is not valid JSON.' };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: 'Dataset root must be a JSON object.' };
  }

  const obj = parsed as Partial<NslDatasetExport>;
  if (obj.schema !== 'signbridge-nsl-dataset' || obj.version !== 1) {
    return { ok: false, error: 'Unsupported dataset schema or version.' };
  }
  if (
    obj.featureVersion !== NSL_FEATURE_VERSION ||
    obj.featureDim !== NSL_FEATURE_DIM ||
    obj.sequenceLength !== NSL_SEQUENCE_LENGTH
  ) {
    return {
      ok: false,
      error: `Incompatible feature layout (expected ${NSL_FEATURE_VERSION} [${NSL_SEQUENCE_LENGTH}x${NSL_FEATURE_DIM}]).`,
    };
  }
  if (!Array.isArray(obj.samples)) {
    return { ok: false, error: 'Dataset is missing samples array.' };
  }

  const validSamples = obj.samples.filter(isValidRecordedSample);
  if (validSamples.length === 0 && obj.samples.length > 0) {
    return { ok: false, error: 'No valid NSL sample sequences found in dataset.' };
  }

  const labels: NslLabelDefinition[] = Array.isArray(obj.labels)
    ? obj.labels.filter((item): item is NslLabelDefinition => {
        if (!item || typeof item !== 'object') return false;
        const l = item as Partial<NslLabelDefinition>;
        return (
          typeof l.id === 'string' &&
          l.id.length > 0 &&
          typeof l.name === 'string' &&
          l.name.length > 0 &&
          typeof l.category === 'string' &&
          typeof l.isBuiltin === 'boolean'
        );
      })
    : [];

  return {
    ok: true,
    dataset: {
      schema: 'signbridge-nsl-dataset',
      version: 1,
      featureVersion: NSL_FEATURE_VERSION,
      featureDim: NSL_FEATURE_DIM,
      sequenceLength: NSL_SEQUENCE_LENGTH,
      exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : new Date().toISOString(),
      labels,
      samples: validSamples,
    },
  };
}

export function mergeImportedDataset(imported: NslDatasetExport):
  | {
      ok: true;
      addedCount: number;
      totalCount: number;
      samples: NslRecordedSample[];
      labels: NslLabelDefinition[];
    }
  | {
      ok: false;
      error: string;
      samples: NslRecordedSample[];
      labels: NslLabelDefinition[];
    } {
  const existingSamples = loadNslSamples();
  const seenIds = new Set(existingSamples.map((s) => s.id));

  const newSamples: NslRecordedSample[] = [];
  for (const sample of imported.samples) {
    if (!seenIds.has(sample.id)) {
      seenIds.add(sample.id);
      newSamples.push(sample);
    }
  }

  for (const label of imported.labels) {
    if (!label.isBuiltin) {
      addCustomNslLabel(label.name, label.category);
    }
  }

  const knownLabelIds = new Set(getAllNslLabels().map((label) => label.id));
  for (const sample of newSamples) {
    if (!knownLabelIds.has(sample.labelId)) {
      const added = addCustomNslLabel(sample.labelName, 'Imported');
      if (added) knownLabelIds.add(added.id);
    }
  }

  const merged = [...newSamples, ...existingSamples];
  if (newSamples.length > 0) {
    const saved = persistSamples(merged);
    if (!saved.ok) {
      return {
        ok: false,
        error: saved.error,
        samples: existingSamples,
        labels: getAllNslLabels(),
      };
    }
  }

  return {
    ok: true,
    addedCount: newSamples.length,
    totalCount: merged.length,
    samples: merged,
    labels: getAllNslLabels(),
  };
}
