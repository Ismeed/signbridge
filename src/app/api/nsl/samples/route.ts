import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIdentifier } from '@/lib/gemini';
import {
  getBuiltinNslLabels,
  isValidRecordedSample,
  normalizeSignerTag,
  serializeDatasetJson,
  type NslRecordedSample,
} from '@/lib/nslDataset';
import {
  fetchAllCloudNslSamples,
  fetchCloudDatasetSummary,
  getPasscodes,
  isCloudDatasetConfigured,
  upsertNslSamples,
  verifyPasscode,
} from '@/lib/supabaseNsl';

export const runtime = 'nodejs';

const MAX_BATCH_SAMPLES = 25;

export async function GET(req: NextRequest) {
  const clientId = getClientIdentifier(req);
  const rate = checkRateLimit('nsl-get', clientId, 60, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Try again shortly.' },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds) } }
    );
  }

  const mode = req.nextUrl.searchParams.get('mode') ?? 'summary';

  if (mode === 'summary') {
    try {
      const summary = await fetchCloudDatasetSummary();
      return NextResponse.json(summary, { status: 200 });
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error ? error.message : 'Unable to fetch cloud NSL dataset summary.',
        },
        { status: 502 }
      );
    }
  }

  if (mode === 'export') {
    if (!isCloudDatasetConfigured()) {
      return NextResponse.json(
        { error: 'Cloud Supabase NSL dataset is not configured on this deployment.' },
        { status: 503 }
      );
    }

    const { adminPasscode } = getPasscodes();
    const provided = req.headers.get('x-nsl-passcode');
    if (!verifyPasscode(provided, adminPasscode)) {
      return NextResponse.json(
        { error: 'Invalid or missing team passcode for dataset export.' },
        { status: 401 }
      );
    }

    try {
      const { samples, labels } = await fetchAllCloudNslSamples();
      const json = serializeDatasetJson(samples, labels);
      return new NextResponse(json, {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
      });
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error ? error.message : 'Unable to export cloud NSL dataset.',
        },
        { status: 502 }
      );
    }
  }

  return NextResponse.json({ error: 'Unsupported query mode.' }, { status: 400 });
}

interface SubmitBody {
  signerTag?: string;
  passcode?: string;
  samples?: unknown[];
}

export async function POST(req: NextRequest) {
  const clientId = getClientIdentifier(req);
  const rate = checkRateLimit('nsl-post', clientId, 45, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'Too many submissions. Please wait a minute and retry.' },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds) } }
    );
  }

  if (!isCloudDatasetConfigured()) {
    return NextResponse.json(
      { error: 'Cloud Supabase NSL database is not configured on this deployment.' },
      { status: 503 }
    );
  }

  let body: SubmitBody;
  try {
    body = (await req.json()) as SubmitBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request body.' }, { status: 400 });
  }

  const { collectPasscode } = getPasscodes();
  const providedPasscode = req.headers.get('x-nsl-passcode') ?? body.passcode;
  if (!verifyPasscode(providedPasscode, collectPasscode)) {
    return NextResponse.json(
      { error: 'Invalid or missing team access code.' },
      { status: 401 }
    );
  }

  if (!Array.isArray(body.samples) || body.samples.length === 0) {
    return NextResponse.json(
      { error: 'Provide at least 1 recorded NSL sample to submit.' },
      { status: 400 }
    );
  }

  if (body.samples.length > MAX_BATCH_SAMPLES) {
    return NextResponse.json(
      { error: `Submit at most ${MAX_BATCH_SAMPLES} clips per request.` },
      { status: 400 }
    );
  }

  const fallbackSignerTag = normalizeSignerTag(body.signerTag);
  const validSamples: NslRecordedSample[] = [];
  for (const item of body.samples) {
    if (!isValidRecordedSample(item)) {
      return NextResponse.json(
        { error: 'One or more clips failed [30x145] NSL schema validation.' },
        { status: 400 }
      );
    }
    validSamples.push({
      ...item,
      signerTag: normalizeSignerTag(item.signerTag ?? fallbackSignerTag),
    });
  }

  const categoryLookup = new Map<string, string>(
    getBuiltinNslLabels().map((label) => [label.id, label.category])
  );

  try {
    const { insertedCount } = await upsertNslSamples(validSamples, categoryLookup);
    const summary = await fetchCloudDatasetSummary();
    return NextResponse.json(
      {
        ok: true,
        submittedCount: validSamples.length,
        insertedCount,
        totalCloudCount: summary.totalSamples,
        signersCount: summary.signersCount,
      },
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed saving NSL clips to cloud database.',
      },
      { status: 502 }
    );
  }
}
