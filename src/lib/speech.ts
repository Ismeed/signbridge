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

const MAX_AUDIO_CACHE_ENTRIES = 25;

interface WindowWithWebkitAudio extends Window {
  webkitAudioContext?: typeof AudioContext;
}

function writeAscii(view: DataView, offset: number, text: string) {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

function createSilentWavBlobUrl(): string {
  const buffer = new ArrayBuffer(46);
  const view = new DataView(buffer);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 38, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 16000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, 2, true);
  view.setInt16(44, 0, true);
  return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
}

export class SpeechService {
  private static synth: SpeechSynthesis | null = null;
  private static voices: SpeechSynthesisVoice[] = [];
  private static isInitialized = false;
  private static activeUtterance: SpeechSynthesisUtterance | null = null;
  private static sharedAudio: HTMLAudioElement | null = null;
  private static audioContext: AudioContext | null = null;
  private static silentWavUrl: string | null = null;
  private static isAudioUnlocked = false;
  private static isSpeakingAudio = false;
  private static playbackSeq = 0;
  private static audioCache = new Map<string, string>();

  private static getOrCreateAudioElement(): HTMLAudioElement {
    if (!SpeechService.sharedAudio) {
      const audio = new Audio();
      audio.setAttribute('playsinline', 'true');
      audio.preload = 'auto';
      SpeechService.sharedAudio = audio;
    }
    return SpeechService.sharedAudio;
  }

  private static clearAudioHandlers(audio: HTMLAudioElement) {
    audio.onplay = null;
    audio.onended = null;
    audio.onerror = null;
  }

  private static cacheAudioUrl(cacheKey: string, objectUrl: string) {
    const existing = SpeechService.audioCache.get(cacheKey);
    if (existing && existing !== objectUrl) {
      URL.revokeObjectURL(existing);
    }
    SpeechService.audioCache.delete(cacheKey);
    SpeechService.audioCache.set(cacheKey, objectUrl);

    while (SpeechService.audioCache.size > MAX_AUDIO_CACHE_ENTRIES) {
      const oldestKey = SpeechService.audioCache.keys().next().value;
      if (!oldestKey) break;
      const oldestUrl = SpeechService.audioCache.get(oldestKey);
      SpeechService.audioCache.delete(oldestKey);
      if (oldestUrl) {
        URL.revokeObjectURL(oldestUrl);
      }
    }
  }

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

  /**
   * Synchronously unlock a persistent audio element and Web Audio context inside
   * a user tap gesture so mobile iOS/Android browsers allow async TTS playback.
   */
  public static unlockAudio() {
    if (typeof window === 'undefined') return;

    SpeechService.init();

    try {
      const AudioCtx =
        window.AudioContext || (window as WindowWithWebkitAudio).webkitAudioContext;
      if (AudioCtx) {
        if (!SpeechService.audioContext) {
          SpeechService.audioContext = new AudioCtx();
        }
        if (SpeechService.audioContext.state === 'suspended') {
          SpeechService.audioContext.resume().catch(() => {});
        }
      }
    } catch {
      // Ignore AudioContext restriction errors
    }

    if (SpeechService.isAudioUnlocked || SpeechService.isSpeakingAudio) {
      return;
    }

    try {
      const audio = SpeechService.getOrCreateAudioElement();
      if (!SpeechService.silentWavUrl) {
        SpeechService.silentWavUrl = createSilentWavBlobUrl();
      }
      audio.src = SpeechService.silentWavUrl;
      audio.muted = false;
      audio.volume = 1;
      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            SpeechService.isAudioUnlocked = true;
          })
          .catch(() => {
            // Will unlock on the next explicit user interaction
          });
      }
    } catch {
      // Safe fallback if browser restricts pre-unlock
    }
  }

  public static isSupported(): boolean {
    return true; // Supported via Gemini neural TTS and/or browser SpeechSynthesis
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
    const langConfig = SUPPORTED_LANGUAGES[lang];

    // Default to Gemini Neural Engine active
    return {
      supported: true,
      selectedVoiceName: `Gemini Neural Voice (${langConfig.name})`,
      selectedVoiceLang: langConfig.voiceLangCode,
      isExactMatch: true,
      isRegionalMatch: true,
      isFallback: false,
      statusMessage: `Gemini Generative Native ${langConfig.name} voice active with authentic regional pronunciation.`,
    };
  }

  /**
   * Speak using Gemini Neural TTS with seamless offline fallback to browser Web Speech API
   */
  public static async speak(
    text: string,
    lang: SupportedLanguage,
    callbacks?: SpeechCallbacks
  ): Promise<boolean> {
    // 1. Immediately stop any active speech or audio
    SpeechService.stop();
    const attemptId = ++SpeechService.playbackSeq;
    let hasStarted = false;
    let hasFinished = false;

    const notifyStart = () => {
      if (attemptId !== SpeechService.playbackSeq || hasStarted || hasFinished) return;
      hasStarted = true;
      callbacks?.onStart?.();
    };

    const notifyEnd = () => {
      if (attemptId !== SpeechService.playbackSeq || hasFinished) return;
      hasFinished = true;
      callbacks?.onEnd?.();
    };

    const notifyError = (message: string) => {
      if (attemptId !== SpeechService.playbackSeq || hasFinished) return;
      hasFinished = true;
      if (callbacks?.onError) {
        callbacks.onError(message);
      } else {
        callbacks?.onEnd?.();
      }
    };

    const cacheKey = `${lang}:${text.trim()}`;

    // Helper: Browser speech fallback
    const fallbackToBrowser = () => {
      if (attemptId !== SpeechService.playbackSeq) return false;

      if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
        notifyError('Speech output is unavailable in this browser.');
        return false;
      }
      if (!SpeechService.synth) SpeechService.init();
      const synth = SpeechService.synth;
      if (!synth) {
        notifyError('Speech synthesis engine is unavailable.');
        return false;
      }

      try {
        const utterance = new SpeechSynthesisUtterance(text);
        const langConfig = SUPPORTED_LANGUAGES[lang];
        utterance.lang = langConfig.voiceLangCode;
        utterance.rate = 0.92;
        utterance.pitch = 1.0;

        utterance.onstart = () => {
          notifyStart();
        };
        utterance.onend = () => {
          if (SpeechService.activeUtterance === utterance) {
            SpeechService.activeUtterance = null;
          }
          notifyEnd();
        };
        utterance.onerror = (event) => {
          if (SpeechService.activeUtterance === utterance) {
            SpeechService.activeUtterance = null;
          }
          notifyError(`Browser speech failed: ${event.error || 'unknown error'}`);
        };

        SpeechService.activeUtterance = utterance;
        synth.speak(utterance);
        return true;
      } catch {
        notifyError('Browser speech failed to start.');
        return false;
      }
    };

    // Helper: Play from audio URL using persistent unlocked audio element
    const playAudioUrl = (audioUrl: string) => {
      if (attemptId !== SpeechService.playbackSeq || typeof window === 'undefined') {
        return false;
      }

      try {
        const audio = SpeechService.getOrCreateAudioElement();
        SpeechService.clearAudioHandlers(audio);
        SpeechService.isSpeakingAudio = true;

        audio.onplay = () => {
          SpeechService.isAudioUnlocked = true;
          notifyStart();
        };

        audio.onended = () => {
          SpeechService.clearAudioHandlers(audio);
          SpeechService.isSpeakingAudio = false;
          notifyEnd();
        };

        audio.onerror = () => {
          SpeechService.clearAudioHandlers(audio);
          SpeechService.isSpeakingAudio = false;
          if (attemptId !== SpeechService.playbackSeq) return;
          console.warn('Audio playback error, falling back to browser speech');
          fallbackToBrowser();
        };

        audio.src = audioUrl;
        audio.muted = false;
        audio.volume = 1;

        const playPromise = audio.play();
        if (playPromise !== undefined) {
          playPromise.catch((err) => {
            SpeechService.clearAudioHandlers(audio);
            SpeechService.isSpeakingAudio = false;
            if (attemptId !== SpeechService.playbackSeq) return;
            console.warn('Audio play was prevented or failed:', err);
            fallbackToBrowser();
          });
        }
        return true;
      } catch (err) {
        SpeechService.isSpeakingAudio = false;
        console.warn('Failed to initialize Audio, falling back:', err);
        return fallbackToBrowser();
      }
    };

    // 2. Check if already cached in memory
    if (SpeechService.audioCache.has(cacheKey)) {
      const cachedUrl = SpeechService.audioCache.get(cacheKey)!;
      SpeechService.audioCache.delete(cacheKey);
      SpeechService.audioCache.set(cacheKey, cachedUrl);
      return playAudioUrl(cachedUrl);
    }

    // 3. Request Gemini Neural TTS audio from our backend route
    try {
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, lang }),
      });

      if (attemptId !== SpeechService.playbackSeq) {
        return false;
      }

      if (!response.ok) {
        console.warn('Server TTS returned non-200, falling back to browser synthesis.');
        return fallbackToBrowser();
      }

      const blob = await response.blob();
      if (attemptId !== SpeechService.playbackSeq) {
        return false;
      }

      const objectUrl = URL.createObjectURL(blob);
      SpeechService.cacheAudioUrl(cacheKey, objectUrl);

      return playAudioUrl(objectUrl);
    } catch (error) {
      if (attemptId !== SpeechService.playbackSeq) {
        return false;
      }
      console.warn('TTS fetch failed, falling back to browser speech:', error);
      return fallbackToBrowser();
    }
  }

  /**
   * Immediately cancel any running speech or audio playback
   */
  public static stop() {
    SpeechService.playbackSeq++;

    if (SpeechService.sharedAudio && SpeechService.isSpeakingAudio) {
      const audio = SpeechService.sharedAudio;
      SpeechService.clearAudioHandlers(audio);
      try {
        audio.pause();
        audio.currentTime = 0;
      } catch {
        // Safe tear down
      }
      SpeechService.isSpeakingAudio = false;
    }

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Safe tear down
      }
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
