'use client';

import { BoundedCache } from './cache';
import { DEMO_PHRASES, SUPPORTED_LANGUAGES } from './translations';
import { SupportedLanguage } from './types';

export interface TranslationResult {
  translatedText: string;
  targetLang: SupportedLanguage;
  source: 'offline' | 'cache' | 'api' | 'fallback';
  model?: string;
}

const clientTranslationCache = new BoundedCache<string>(150);

function findOfflineTranslation(
  cleanText: string,
  targetLang: SupportedLanguage
): string | null {
  const normalized = cleanText.toLowerCase();
  for (const phrase of DEMO_PHRASES) {
    if (
      phrase.translations.en.toLowerCase() === normalized ||
      phrase.signConcept.toLowerCase() === normalized
    ) {
      return phrase.translations[targetLang];
    }
  }
  return null;
}

/**
 * Translate dynamic sign glosses or English captions into any supported Nigerian language.
 * Uses local preset matches first, an in-memory LRU cache, and `/api/translate` with timeout fallback.
 */
export class TranslationService {
  public static async translate(
    text: string,
    targetLang: SupportedLanguage,
    sourceLang: SupportedLanguage = 'en'
  ): Promise<TranslationResult> {
    const cleanText = text.trim();
    if (!cleanText || !(targetLang in SUPPORTED_LANGUAGES)) {
      return {
        translatedText: cleanText,
        targetLang,
        source: 'fallback',
      };
    }

    const offlineMatch = findOfflineTranslation(cleanText, targetLang);
    if (offlineMatch) {
      return {
        translatedText: offlineMatch,
        targetLang,
        source: 'offline',
      };
    }

    if (sourceLang === targetLang) {
      return {
        translatedText: cleanText,
        targetLang,
        source: 'offline',
      };
    }

    const cacheKey = `${sourceLang}->${targetLang}:${cleanText}`;
    const cached = clientTranslationCache.get(cacheKey);
    if (cached) {
      return {
        translatedText: cached,
        targetLang,
        source: 'cache',
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);

    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: cleanText, targetLang, sourceLang }),
        signal: controller.signal,
      });

      if (!res.ok) {
        return {
          translatedText: cleanText,
          targetLang,
          source: 'fallback',
        };
      }

      const data = (await res.json()) as {
        translatedText?: string;
        model?: string;
      };
      const translatedText = data.translatedText?.trim();
      if (!translatedText) {
        return {
          translatedText: cleanText,
          targetLang,
          source: 'fallback',
        };
      }

      clientTranslationCache.set(cacheKey, translatedText);
      return {
        translatedText,
        targetLang,
        source: 'api',
        model: data.model,
      };
    } catch {
      return {
        translatedText: cleanText,
        targetLang,
        source: 'fallback',
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
