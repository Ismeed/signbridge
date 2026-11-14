import { NextRequest, NextResponse } from 'next/server';
import { BoundedCache } from '@/lib/cache';
import {
  buildModelChain,
  callGeminiWithFallback,
  checkRateLimit,
  getClientIdentifier,
  getGeminiApiKey,
  isSupportedLanguage,
  TTS_MODELS,
} from '@/lib/gemini';
import { SupportedLanguage } from '@/lib/types';

const MAX_TTS_CHARS = 400;
const RATE_LIMIT_MAX_REQUESTS = 40;
const RATE_LIMIT_WINDOW_MS = 60_000;
const TTS_TIMEOUT_MS = 12_000;

const ttsAudioCache = new BoundedCache<Uint8Array>(50);

interface GeminiAudioResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        inlineData?: {
          mimeType?: string;
          data?: string;
        };
      }>;
    };
  }>;
}

function pcmToWav(
  pcmBuffer: Buffer,
  sampleRate = 24000,
  numChannels = 1,
  bitsPerSample = 16
): Buffer {
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcmBuffer.length;
  const header = Buffer.alloc(44);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmBuffer]);
}

function parseSampleRate(mimeType?: string): number {
  if (!mimeType) return 24000;
  const match = mimeType.match(/rate=(\d+)/i);
  if (!match) return 24000;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) && parsed >= 8000 && parsed <= 48000 ? parsed : 24000;
}

function inlineAudioToWav(base64Data: string, mimeType?: string): Uint8Array {
  const rawBuffer = Buffer.from(base64Data, 'base64');
  const hasRiffHeader =
    rawBuffer.length >= 12 &&
    rawBuffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    rawBuffer.subarray(8, 12).toString('ascii') === 'WAVE';

  if (hasRiffHeader) {
    return new Uint8Array(rawBuffer);
  }

  const sampleRate = parseSampleRate(mimeType);
  const wavBuffer = pcmToWav(rawBuffer, sampleRate, 1, 16);
  return new Uint8Array(wavBuffer);
}

function createWavResponse(
  wavBytes: Uint8Array,
  cacheStatus: 'HIT' | 'MISS',
  model: string
): Response {
  return new Response(new Uint8Array(wavBytes), {
    status: 200,
    headers: {
      'Content-Type': 'audio/wav',
      'Content-Length': wavBytes.byteLength.toString(),
      'Cache-Control': 'private, max-age=86400',
      'X-TTS-Cache': cacheStatus,
      'X-TTS-Model': model,
    },
  });
}

export async function POST(req: NextRequest) {
  let body: { text?: unknown; lang?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request body' }, { status: 400 });
  }

  const rawText = body.text;
  if (typeof rawText !== 'string' || rawText.trim().length === 0) {
    return NextResponse.json({ error: 'Text parameter is required' }, { status: 400 });
  }

  const cleanText = rawText.trim();
  if (cleanText.length > MAX_TTS_CHARS) {
    return NextResponse.json(
      { error: `Text exceeds maximum length of ${MAX_TTS_CHARS} characters` },
      { status: 400 }
    );
  }

  let lang: SupportedLanguage = 'en';
  if (body.lang !== undefined) {
    if (!isSupportedLanguage(body.lang)) {
      return NextResponse.json(
        { error: 'Unsupported lang. Expected one of: en, ha, yo, ig, pcm' },
        { status: 400 }
      );
    }
    lang = body.lang;
  }

  const rateLimit = checkRateLimit(
    'tts',
    getClientIdentifier(req),
    RATE_LIMIT_MAX_REQUESTS,
    RATE_LIMIT_WINDOW_MS
  );
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many speech requests. Please wait a moment and try again.' },
      {
        status: 429,
        headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) },
      }
    );
  }

  const cacheKey = `${lang}:${cleanText}`;
  const cachedWav = ttsAudioCache.get(cacheKey);
  if (cachedWav) {
    return createWavResponse(cachedWav, 'HIT', 'cache');
  }

  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    return NextResponse.json({ error: 'GEMINI_API_KEY is not configured' }, { status: 500 });
  }

  const models = buildModelChain(TTS_MODELS, process.env.GEMINI_TTS_MODEL);
  const result = await callGeminiWithFallback<GeminiAudioResponse>({
    apiKey,
    models,
    timeoutMs: TTS_TIMEOUT_MS,
    payload: {
      // Keep transcript verbatim so Gemini 3.x TTS does not read metadata directives aloud
      contents: [{ parts: [{ text: cleanText }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: 'Puck',
            },
          },
        },
      },
    },
    validateData: (data) =>
      Boolean(data.candidates?.[0]?.content?.parts?.find((part) => Boolean(part.inlineData?.data))),
  });

  if (!result.ok) {
    console.error('TTS models failed:', result.attempts);
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const inlineData = result.data.candidates?.[0]?.content?.parts?.find((part) =>
    Boolean(part.inlineData?.data)
  )?.inlineData;
  if (!inlineData?.data) {
    return NextResponse.json({ error: 'No audio returned from Gemini TTS' }, { status: 502 });
  }

  const wavBytes = inlineAudioToWav(inlineData.data, inlineData.mimeType);
  ttsAudioCache.set(cacheKey, wavBytes);

  return createWavResponse(wavBytes, 'MISS', result.model);
}
