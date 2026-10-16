'use client';

import { SupportedLanguage } from './types';
import { SUPPORTED_LANGUAGES } from './translations';

export interface VoiceDiagnostic {
  supported: boolean;
  selectedVoiceName: string | null;
  selectedVoiceLang: string | null;
  isExactMatch: boolean;
  isRegionalMatch: boolean;
  isFallback: boolean;
  statusMessage: string;
}

export type PlaybackState =
  | 'ready'
  | 'speaking'
  | 'finished'
  | 'unavailable'
  | 'error';

export interface SpeechCallbacks {
  onStart?: () => void;
  onBoundary?: (charIndex: number) => void;
  onEnd?: () => void;
  onError?: (errorMessage: string) => void;
}

export class SpeechService {
  private static synth: SpeechSynthesis | null = null;
  private static voices: SpeechSynthesisVoice[] = [];
  private static isInitialized = false;
  private static activeUtterance: SpeechSynthesisUtterance | null = null;

  public static init() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      SpeechService.synth = window.speechSynthesis;
      const loadVoices = () => {
        if (SpeechService.synth) {
          SpeechService.voices = SpeechService.synth.getVoices();
        }
      };
      loadVoices();
      if (window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = loadVoices;
      }
      SpeechService.isInitialized = true;
    }
  }

  public static isSupported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  public static getAvailableVoices(): SpeechSynthesisVoice[] {
    if (!SpeechService.isInitialized) {
      SpeechService.init();
    }
    if (SpeechService.synth) {
      const v = SpeechService.synth.getVoices();
      if (v.length > 0) {
        SpeechService.voices = v;
      }
    }
    return SpeechService.voices;
  }

  /**
   * Diagnostic inspector for current language voice compatibility
   */
  public static inspectVoice(lang: SupportedLanguage): VoiceDiagnostic {
    if (!SpeechService.isSupported()) {
      return {
        supported: false,
        selectedVoiceName: null,
        selectedVoiceLang: null,
        isExactMatch: false,
        isRegionalMatch: false,
        isFallback: false,
        statusMessage: 'Web Speech API is not supported in this browser.',
      };
    }

    const voices = SpeechService.getAvailableVoices();
    const langConfig = SUPPORTED_LANGUAGES[lang];
    const targetCode = langConfig.voiceLangCode.toLowerCase();
    const shortCode = lang.toLowerCase();

    // 1. Exact match for target language code (e.g., ha-NG, yo-NG, ig-NG, en-NG)
    const exactVoice = voices.find(
      (v) => v.lang.toLowerCase() === targetCode || v.lang.toLowerCase().replace('_', '-') === targetCode
    );
    if (exactVoice) {
      return {
        supported: true,
        selectedVoiceName: exactVoice.name,
        selectedVoiceLang: exactVoice.lang,
        isExactMatch: true,
        isRegionalMatch: true,
        isFallback: false,
        statusMessage: `Native ${langConfig.name} voice detected (${exactVoice.name}).`,
      };
    }

    // 2. Language prefix match (e.g. any 'ha', 'yo', 'ig' voice)
    const prefixVoice = voices.find((v) => v.lang.toLowerCase().startsWith(shortCode));
    if (prefixVoice) {
      return {
        supported: true,
        selectedVoiceName: prefixVoice.name,
        selectedVoiceLang: prefixVoice.lang,
        isExactMatch: true,
        isRegionalMatch: false,
        isFallback: false,
        statusMessage: `Language voice match found (${prefixVoice.name} - ${prefixVoice.lang}).`,
      };
    }

    // 3. Regional match for Nigerian Pidgin or English (e.g., Nigerian English voice)
    const nigerianVoice = voices.find(
      (v) => v.lang.toLowerCase().includes('ng') || v.name.toLowerCase().includes('nigeria')
    );

    if (lang === 'pcm' && nigerianVoice) {
      return {
        supported: true,
        selectedVoiceName: nigerianVoice.name,
        selectedVoiceLang: nigerianVoice.lang,
        isExactMatch: false,
        isRegionalMatch: true,
        isFallback: false,
        statusMessage: `Nigerian English voice (${nigerianVoice.name}) mapped for Pidgin output.`,
      };
    }

    // 4. Default / system fallback voice
    const defaultVoice = voices.find((v) => v.default) || voices[0];
    if (defaultVoice) {
      const isEnglishTarget = lang === 'en';
      return {
        supported: true,
        selectedVoiceName: defaultVoice.name,
        selectedVoiceLang: defaultVoice.lang,
        isExactMatch: isEnglishTarget,
        isRegionalMatch: false,
        isFallback: !isEnglishTarget,
        statusMessage: isEnglishTarget
          ? `English voice available (${defaultVoice.name}).`
          : `Device lacks native ${langConfig.name} voice. Reading with system voice (${defaultVoice.name}) with captions displayed.`,
      };
    }

    return {
      supported: true,
      selectedVoiceName: null,
      selectedVoiceLang: null,
      isExactMatch: false,
      isRegionalMatch: false,
      isFallback: true,
      statusMessage: `Device speech synthesizer has no installed voices. Captions displayed.`,
    };
  }

  /**
   * Speak speech synthesis with real event hooks
   */
  public static speak(
    text: string,
    lang: SupportedLanguage,
    callbacks?: SpeechCallbacks
  ): boolean {
    if (!SpeechService.isSupported()) {
      if (callbacks?.onError) {
        callbacks.onError('Web Speech API is not supported in this browser.');
      }
      return false;
    }

    if (!SpeechService.synth) {
      SpeechService.init();
    }

    const synth = SpeechService.synth;
    if (!synth) {
      if (callbacks?.onError) callbacks.onError('Speech synthesizer could not be initialized.');
      return false;
    }

    try {
      // Immediately cancel any ongoing speech
      synth.cancel();
      SpeechService.activeUtterance = null;

      const utterance = new SpeechSynthesisUtterance(text);
      const langConfig = SUPPORTED_LANGUAGES[lang];
      utterance.lang = langConfig.voiceLangCode;
      utterance.rate = 0.92; // Slightly paced for clarity and accessibility
      utterance.pitch = 1.0;

      const diagnostic = SpeechService.inspectVoice(lang);
      const voices = SpeechService.getAvailableVoices();

      if (diagnostic.selectedVoiceName) {
        const voiceObj = voices.find((v) => v.name === diagnostic.selectedVoiceName);
        if (voiceObj) {
          utterance.voice = voiceObj;
        }
      }

      utterance.onstart = () => {
        if (callbacks?.onStart) callbacks.onStart();
      };

      utterance.onboundary = (e) => {
        if (callbacks?.onBoundary) {
          callbacks.onBoundary(e.charIndex);
        }
      };

      utterance.onend = () => {
        SpeechService.activeUtterance = null;
        if (callbacks?.onEnd) callbacks.onEnd();
      };

      utterance.onerror = (e) => {
        SpeechService.activeUtterance = null;
        if (callbacks?.onError) {
          callbacks.onError(e.error || 'Speech synthesis error');
        } else if (callbacks?.onEnd) {
          callbacks.onEnd();
        }
      };

      SpeechService.activeUtterance = utterance;
      synth.speak(utterance);
      return true;
    } catch (err: unknown) {
      SpeechService.activeUtterance = null;
      const msg = err instanceof Error ? err.message : 'Speech synthesis failed';
      if (callbacks?.onError) callbacks.onError(msg);
      return false;
    }
  }

  /**
   * Immediately cancel any running speech
   */
  public static stop() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      SpeechService.activeUtterance = null;
    }
  }
}

export function triggerHaptic(
  type: 'light' | 'medium' | 'heavy' = 'light',
  enabled: boolean = true
) {
  if (
    !enabled ||
    typeof window === 'undefined' ||
    !('navigator' in window) ||
    !('vibrate' in navigator)
  ) {
    return;
  }
  try {
    const patterns = {
      light: [25],
      medium: [50],
      heavy: [90, 40, 90],
    };
    navigator.vibrate(patterns[type] || [30]);
  } catch {
    // Graceful fallback if unsupported
  }
}
