import { NextRequest, NextResponse } from 'next/server';
import { BoundedCache } from '@/lib/cache';
import {
  buildModelChain,
  callGeminiWithFallback,
  checkRateLimit,
  getClientIdentifier,
  getGeminiApiKey,
  isSupportedLanguage,
  TRANSLATE_MODELS,
} from '@/lib/gemini';
import { SupportedLanguage } from '@/lib/types';

const MAX_TRANSLATE_CHARS = 500;
const RATE_LIMIT_MAX_REQUESTS = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;
const TRANSLATE_TIMEOUT_MS = 10_000;

const translationCache = new BoundedCache<string>(200);

const TARGET_LANGUAGE_INSTRUCTIONS: Record<SupportedLanguage, string> = {
  ha: 'Hausa (natural everyday Northern Nigerian phrasing)',
  yo: 'Yoruba (natural Southwestern Nigerian phrasing with proper tonal diacritics)',
  ig: 'Igbo (natural Southeastern Nigerian phrasing with accurate Igbo diacritics)',
  pcm: 'Nigerian Pidgin (authentic everyday Naija Pidgin spoken in Nigeria, e.g., use natural markers like "dey", "abeg", "fit", "na", not formal English)',
  en: 'English (clear everyday Nigerian English)',
};

interface GeminiTextResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
}

function stripOuterQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === '`' && last === '`')) {
      return trimmed.slice(1, -1).trim();
    }
  }
  return trimmed;
}

export async function POST(req: NextRequest) {
  let body: { text?: unknown; targetLang?: unknown; sourceLang?: unknown };
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
  if (cleanText.length > MAX_TRANSLATE_CHARS) {
    return NextResponse.json(
      { error: `Text exceeds maximum length of ${MAX_TRANSLATE_CHARS} characters` },
      { status: 400 }
    );
  }

  if (!isSupportedLanguage(body.targetLang)) {
    return NextResponse.json(
      { error: 'Unsupported targetLang. Expected one of: en, ha, yo, ig, pcm' },
      { status: 400 }
    );
  }
  const targetLang = body.targetLang;

  let sourceLang: SupportedLanguage = 'en';
  if (body.sourceLang !== undefined) {
    if (!isSupportedLanguage(body.sourceLang)) {
      return NextResponse.json(
        { error: 'Unsupported sourceLang. Expected one of: en, ha, yo, ig, pcm' },
        { status: 400 }
      );
    }
    sourceLang = body.sourceLang;
  }

  const rateLimit = checkRateLimit(
    'translate',
    getClientIdentifier(req),
    RATE_LIMIT_MAX_REQUESTS,
    RATE_LIMIT_WINDOW_MS
  );
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many translation requests. Please wait a moment and try again.' },
      {
        status: 429,
        headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) },
      }
    );
  }

  if (sourceLang === targetLang) {
    return NextResponse.json({
      translatedText: cleanText,
      targetLang,
      model: 'passthrough',
      cached: false,
    });
  }

  const cacheKey = `${sourceLang}->${targetLang}:${cleanText}`;
  const cachedText = translationCache.get(cacheKey);
  if (cachedText) {
    return NextResponse.json({
      translatedText: cachedText,
      targetLang,
      model: 'cache',
      cached: true,
    });
  }

  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    return NextResponse.json({ error: 'GEMINI_API_KEY is not configured' }, { status: 500 });
  }

  const prompt = `You are a translator for SignBridge AI, a Nigerian Sign Language assistive communication app.
Translate the following text from ${TARGET_LANGUAGE_INSTRUCTIONS[sourceLang]} into ${TARGET_LANGUAGE_INSTRUCTIONS[targetLang]}.
Keep the translation concise, respectful, and natural for spoken conversation in Nigeria.
Respond ONLY with the translated text, without quotation marks, labels, or explanations.

Text to translate:
${cleanText}`;

  const models = buildModelChain(TRANSLATE_MODELS, process.env.GEMINI_TRANSLATE_MODEL);
  const result = await callGeminiWithFallback<GeminiTextResponse>({
    apiKey,
    models,
    timeoutMs: TRANSLATE_TIMEOUT_MS,
    payload: {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 256,
      },
    },
  });

  if (!result.ok) {
    console.error('Translation models failed:', result.attempts);
    return NextResponse.json(
      { error: result.error },
      { status: result.status }
    );
  }

  const rawTranslated = result.data.candidates?.[0]?.content?.parts?.[0]?.text;
  const translatedText = rawTranslated ? stripOuterQuotes(rawTranslated) : cleanText;
  translationCache.set(cacheKey, translatedText);

  return NextResponse.json({
    translatedText,
    targetLang,
    model: result.model,
    cached: false,
  });
}
