import type { NextRequest } from 'next/server';
import { SUPPORTED_LANGUAGES } from './translations';
import { SupportedLanguage } from './types';

export const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export const TRANSLATE_MODELS = [
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash-lite',
  'gemini-3.5-flash',
  'gemini-flash-lite-latest',
] as const;

export const TTS_MODELS = [
  'gemini-3.8-flash-tts',
  'gemini-3.8-flash-lite-tts',
  'gemini-2.5-flash-preview-tts',
] as const;

const RETRYABLE_STATUSES = new Set([404, 408, 429, 500, 502, 503, 504]);

interface RateLimitWindow {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitWindow>();
const MAX_RATE_LIMIT_BUCKETS = 1000;

export function isSupportedLanguage(value: unknown): value is SupportedLanguage {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(SUPPORTED_LANGUAGES, value)
  );
}

export function getGeminiApiKey(): string | null {
  const key = process.env.GEMINI_API_KEY?.trim();
  return key && key.length > 0 ? key : null;
}

export function getClientIdentifier(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  const realIp = req.headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;
  return 'local-client';
}

export function checkRateLimit(
  namespace: string,
  clientId: string,
  maxRequests: number,
  windowMs: number
): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const key = `${namespace}:${clientId}`;

  if (rateLimitStore.size > MAX_RATE_LIMIT_BUCKETS) {
    for (const [entryKey, entry] of rateLimitStore.entries()) {
      if (entry.resetAt <= now) {
        rateLimitStore.delete(entryKey);
      }
    }
  }

  const existing = rateLimitStore.get(key);
  if (!existing || existing.resetAt <= now) {
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (existing.count >= maxRequests) {
    const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
    return { allowed: false, retryAfterSeconds };
  }

  existing.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

export interface GeminiAttemptError {
  model: string;
  status: number;
  details: string;
}

export type GeminiFallbackResult<T> =
  | { ok: true; model: string; data: T }
  | { ok: false; status: number; error: string; attempts: GeminiAttemptError[] };

export function buildModelChain(
  defaultModels: readonly string[],
  preferredModel?: string
): string[] {
  const cleanPreferred = preferredModel?.trim();
  const unique = new Set<string>();
  if (cleanPreferred && cleanPreferred.length > 0) {
    unique.add(cleanPreferred);
  }
  for (const model of defaultModels) {
    unique.add(model);
  }
  return Array.from(unique);
}

export async function callGeminiWithFallback<T>({
  apiKey,
  models,
  payload,
  timeoutMs,
}: {
  apiKey: string;
  models: readonly string[];
  payload: Record<string, unknown>;
  timeoutMs: number;
}): Promise<GeminiFallbackResult<T>> {
  const attempts: GeminiAttemptError[] = [];

  for (const model of models) {
    const url = `${GEMINI_API_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (res.ok) {
        const data = (await res.json()) as T;
        return { ok: true, model, data };
      }

      const details = (await res.text()).slice(0, 300);
      attempts.push({ model, status: res.status, details });

      if (!RETRYABLE_STATUSES.has(res.status)) {
        return {
          ok: false,
          status: res.status,
          error: `Gemini request rejected by ${model}`,
          attempts,
        };
      }
    } catch (error: unknown) {
      const isTimeout =
        error instanceof Error &&
        (error.name === 'TimeoutError' || error.name === 'AbortError');
      attempts.push({
        model,
        status: isTimeout ? 504 : 502,
        details: error instanceof Error ? error.message : 'Network failure',
      });
    }
  }

  const lastAttempt = attempts[attempts.length - 1];
  return {
    ok: false,
    status: lastAttempt?.status || 503,
    error: 'All configured Gemini models failed or timed out',
    attempts,
  };
}
