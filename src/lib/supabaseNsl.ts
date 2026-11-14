import crypto from 'node:crypto';
import type { NslRecordedSample } from '@/lib/nslDataset';
import { getBuiltinNslLabels, type NslLabelDefinition } from '@/lib/nslDataset';
import { NSL_FEATURE_DIM, NSL_FEATURE_VERSION, NSL_SEQUENCE_LENGTH } from '@/lib/nslFeatures';

interface SupabaseConfig {
  url: string;
  serviceKey: string;
}

interface CloudSummaryRow {
  label_id: string;
  label_name: string;
  signer_tag: string;
}

interface CloudSampleRow {
  sample_uid: string;
  label_id: string;
  label_name: string;
  category: string;
  signer_tag: string;
  feature_version: typeof NSL_FEATURE_VERSION;
  feature_dim: number;
  sequence_length: number;
  sequence: number[][];
  raw_frame_count: number;
  duration_ms: number;
  fps_estimate: number;
  hand_coverage_ratio: number;
  handedness: NslRecordedSample['handedness'];
  camera_facing: 'user' | 'environment';
  recorded_at: string;
}

export interface CloudDatasetSummary {
  cloudConfigured: boolean;
  collectPasscodeRequired: boolean;
  adminPasscodeRequired: boolean;
  totalSamples: number;
  signersCount: number;
  labelsSummary: Array<{ id: string; name: string; count: number }>;
}

export function getSupabaseConfig(): SupabaseConfig | null {
  const url = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL)?.trim();
  const serviceKey = (
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY
  )?.trim();

  if (!url || !serviceKey || url.length === 0 || serviceKey.length === 0) {
    return null;
  }

  return {
    url: url.endsWith('/') ? url.slice(0, -1) : url,
    serviceKey,
  };
}

export function isCloudDatasetConfigured(): boolean {
  return getSupabaseConfig() !== null;
}

export function getPasscodes(): { collectPasscode?: string; adminPasscode?: string } {
  const rawCollect = process.env.NSL_COLLECT_PASSCODE?.trim();
  const rawAdmin = process.env.NSL_ADMIN_PASSCODE?.trim();
  const collectPasscode = rawCollect && rawCollect.length > 0 ? rawCollect : undefined;
  const adminPasscode =
    rawAdmin && rawAdmin.length > 0 ? rawAdmin : collectPasscode;
  return { collectPasscode, adminPasscode };
}

export function verifyPasscode(provided: string | null | undefined, expected?: string): boolean {
  if (!expected) return true;
  if (!provided || provided.trim().length === 0) return false;

  const hashA = crypto.createHash('sha256').update(provided.trim(), 'utf8').digest();
  const hashB = crypto.createHash('sha256').update(expected, 'utf8').digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

function supabaseHeaders(serviceKey: string, extra?: Record<string, string>): HeadersInit {
  // Modern Supabase sb_secret_* keys must NOT be sent as JWT Bearer tokens in Authorization.
  const isLegacyJwt = !serviceKey.startsWith('sb_secret_') && serviceKey.split('.').length === 3;
  const headers: Record<string, string> = {
    apikey: serviceKey,
    'Content-Type': 'application/json',
    ...extra,
  };
  if (isLegacyJwt) {
    headers.Authorization = `Bearer ${serviceKey}`;
  }
  return headers;
}

/** Inserts recorded NSL clips into `public.nsl_samples`, ignoring duplicate sample UIDs. */
export async function upsertNslSamples(
  samples: NslRecordedSample[],
  categoryLookup: Map<string, string>
): Promise<{ insertedCount: number }> {
  const cfg = getSupabaseConfig();
  if (!cfg) {
    throw new Error('Supabase credentials are not configured.');
  }

  const rows = samples.map((s) => ({
    sample_uid: s.id,
    label_id: s.labelId,
    label_name: s.labelName,
    category: categoryLookup.get(s.labelId) ?? 'NSL',
    signer_tag: s.signerTag ?? 'local-signer',
    feature_version: s.featureVersion,
    feature_dim: s.featureDim,
    sequence_length: s.sequenceLength,
    sequence: s.sequence,
    raw_frame_count: s.rawFrameCount,
    duration_ms: s.durationMs,
    fps_estimate: s.fpsEstimate,
    hand_coverage_ratio: s.handCoverageRatio,
    handedness: s.handedness,
    camera_facing: s.cameraFacing,
    recorded_at: s.createdAt,
  }));

  const res = await fetch(`${cfg.url}/rest/v1/nsl_samples?on_conflict=sample_uid`, {
    method: 'POST',
    headers: supabaseHeaders(cfg.serviceKey, {
      Prefer: 'resolution=ignore-duplicates,return=representation',
    }),
    body: JSON.stringify(rows),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => 'unknown');
    throw new Error(`Supabase insert failed (${res.status}): ${detail.slice(0, 180)}`);
  }

  const inserted = (await res.json()) as unknown[];
  return { insertedCount: Array.isArray(inserted) ? inserted.length : rows.length };
}

/** Fetches lightweight aggregate clip counts per sign and contributor count without raw tensors. */
export async function fetchCloudDatasetSummary(): Promise<CloudDatasetSummary> {
  const cfg = getSupabaseConfig();
  const { collectPasscode, adminPasscode } = getPasscodes();

  if (!cfg) {
    return {
      cloudConfigured: false,
      collectPasscodeRequired: Boolean(collectPasscode),
      adminPasscodeRequired: Boolean(adminPasscode),
      totalSamples: 0,
      signersCount: 0,
      labelsSummary: [],
    };
  }

  const allRows: CloudSummaryRow[] = [];
  const pageSize = 1000;

  for (let offset = 0; offset < 20000; offset += pageSize) {
    const res = await fetch(
      `${cfg.url}/rest/v1/nsl_samples?select=label_id,label_name,signer_tag&order=created_at.desc`,
      {
        method: 'GET',
        headers: supabaseHeaders(cfg.serviceKey, {
          Range: `${offset}-${offset + pageSize - 1}`,
        }),
        cache: 'no-store',
      }
    );

    if (!res.ok) {
      throw new Error(`Supabase summary query failed (${res.status})`);
    }

    const batch = (await res.json()) as CloudSummaryRow[];
    allRows.push(...batch);
    if (batch.length < pageSize) break;
  }

  const signers = new Set<string>();
  const labelMap = new Map<string, { id: string; name: string; count: number }>();

  for (const row of allRows) {
    if (row.signer_tag && row.signer_tag.length > 0) {
      signers.add(row.signer_tag.toLowerCase());
    }
    const existing = labelMap.get(row.label_id);
    if (existing) {
      existing.count += 1;
    } else {
      labelMap.set(row.label_id, {
        id: row.label_id,
        name: row.label_name,
        count: 1,
      });
    }
  }

  return {
    cloudConfigured: true,
    collectPasscodeRequired: Boolean(collectPasscode),
    adminPasscodeRequired: Boolean(adminPasscode),
    totalSamples: allRows.length,
    signersCount: signers.size,
    labelsSummary: Array.from(labelMap.values()).sort((a, b) => b.count - a.count),
  };
}

/** Downloads full validated cloud dataset rows mapped into canonical NslDatasetExport structures. */
export async function fetchAllCloudNslSamples(): Promise<{
  samples: NslRecordedSample[];
  labels: NslLabelDefinition[];
}> {
  const cfg = getSupabaseConfig();
  if (!cfg) {
    throw new Error('Supabase credentials are not configured.');
  }

  const rows: CloudSampleRow[] = [];
  const pageSize = 500;

  for (let offset = 0; offset < 15000; offset += pageSize) {
    const res = await fetch(
      `${cfg.url}/rest/v1/nsl_samples?select=sample_uid,label_id,label_name,category,signer_tag,feature_version,feature_dim,sequence_length,sequence,raw_frame_count,duration_ms,fps_estimate,hand_coverage_ratio,handedness,camera_facing,recorded_at&order=recorded_at.desc`,
      {
        method: 'GET',
        headers: supabaseHeaders(cfg.serviceKey, {
          Range: `${offset}-${offset + pageSize - 1}`,
        }),
        cache: 'no-store',
      }
    );

    if (!res.ok) {
      throw new Error(`Supabase export query failed (${res.status})`);
    }

    const batch = (await res.json()) as CloudSampleRow[];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }

  const builtins = getBuiltinNslLabels();
  const labelMap = new Map<string, NslLabelDefinition>(
    builtins.map((item) => [item.id, item])
  );

  const samples: NslRecordedSample[] = [];
  for (const row of rows) {
    if (
      row.feature_version !== NSL_FEATURE_VERSION ||
      row.feature_dim !== NSL_FEATURE_DIM ||
      row.sequence_length !== NSL_SEQUENCE_LENGTH
    ) {
      continue;
    }

    if (!labelMap.has(row.label_id)) {
      labelMap.set(row.label_id, {
        id: row.label_id,
        name: row.label_name,
        category: row.category || 'Custom',
        isBuiltin: false,
      });
    }

    samples.push({
      id: row.sample_uid,
      labelId: row.label_id,
      labelName: row.label_name,
      signerTag: row.signer_tag,
      featureVersion: row.feature_version,
      featureDim: row.feature_dim,
      sequenceLength: row.sequence_length,
      sequence: row.sequence,
      rawFrameCount: row.raw_frame_count,
      durationMs: row.duration_ms,
      fpsEstimate: row.fps_estimate,
      handCoverageRatio: row.hand_coverage_ratio,
      handedness: row.handedness,
      cameraFacing: row.camera_facing,
      createdAt: row.recorded_at,
    });
  }

  return {
    samples,
    labels: Array.from(labelMap.values()),
  };
}
