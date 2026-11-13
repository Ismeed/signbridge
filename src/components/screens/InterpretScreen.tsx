'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import clsx from 'clsx';
import {
  Volume2,
  VolumeX,
  Play,
  RotateCcw,
  Check,
  Hand,
  ChevronDown,
  Info,
  ArrowRight,
} from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { CameraViewport } from '@/components/ui/CameraViewport';
import { WaveformVisualizer } from '@/components/ui/WaveformVisualizer';
import { DEMO_PHRASES, SUPPORTED_LANGUAGES } from '@/lib/translations';
import {
  InterpretationState,
  DemoPhrase,
  SupportedLanguage,
} from '@/lib/types';
import {
  SpeechService,
  triggerHaptic,
  PlaybackState,
} from '@/lib/speech';

export type GuidedDemoStep =
  | 'ready'
  | 'tracking'
  | 'demonstrating'
  | 'captioning'
  | 'speaking'
  | 'complete';

export function InterpretScreen() {
  const {
    selectedLanguage,
    preferences,
    demoModeAutoStart,
    consumeDemoAutoStart,
    addActivityItem,
    t,
  } = useApp();

  const [demoStep, setDemoStep] = useState<GuidedDemoStep>('ready');
  const [activePhraseIndex, setActivePhraseIndex] = useState<number>(0);
  const [playbackState, setPlaybackState] = useState<PlaybackState>('ready');
  const [revealedWordCount, setRevealedWordCount] = useState<number>(
    DEMO_PHRASES[0].translations[selectedLanguage].split(' ').length
  );

  const [showPhrasePicker, setShowPhrasePicker] = useState<boolean>(false);
  const [showSignGuide, setShowSignGuide] = useState<boolean>(false);
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);

  const isCameraActiveRef = useRef<boolean>(false);
  useEffect(() => {
    isCameraActiveRef.current = isCameraActive;
  }, [isCameraActive]);

  const handleCameraToggle = useCallback((active: boolean) => {
    setIsCameraActive(active);
  }, []);

  const sequenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const captionTimerRef = useRef<NodeJS.Timeout | null>(null);

  const activePhrase: DemoPhrase = DEMO_PHRASES[activePhraseIndex] || DEMO_PHRASES[0];
  const translatedCaption = activePhrase.translations[selectedLanguage];
  const phoneticGuide = activePhrase.phoneticGuide?.[selectedLanguage];
  const currentLang = SUPPORTED_LANGUAGES[selectedLanguage];
  const words = translatedCaption.split(' ');

  // Clean up timers and audio on unmount
  useEffect(() => {
    return () => {
      SpeechService.stop();
      if (sequenceTimerRef.current) clearTimeout(sequenceTimerRef.current);
      if (captionTimerRef.current) clearInterval(captionTimerRef.current);
    };
  }, []);

  // Initialize speech synthesis voices on language change
  useEffect(() => {
    SpeechService.init();
  }, [selectedLanguage]);

  const resetPlaybackAndSpeech = useCallback(() => {
    SpeechService.stop();
    setPlaybackState('ready');
    if (captionTimerRef.current) clearInterval(captionTimerRef.current);
  }, []);

  const playVoiceOutput = useCallback(
    (textToSpeak: string, langToSpeak: SupportedLanguage, phraseMeta: DemoPhrase) => {
      setPlaybackState('speaking');
      setDemoStep('speaking');
      triggerHaptic('light', preferences.hapticsEnabled);

      addActivityItem({
        phraseId: phraseMeta.id,
        signConcept: phraseMeta.signConcept,
        translatedText: textToSpeak,
        language: langToSpeak,
        source: isCameraActiveRef.current ? 'live' : 'demo',
      });

      SpeechService.speak(textToSpeak, langToSpeak, {
        onStart: () => {
          setPlaybackState('speaking');
          setDemoStep('speaking');
        },
        onEnd: () => {
          setPlaybackState('finished');
          setDemoStep('complete');
          triggerHaptic('light', preferences.hapticsEnabled);
        },
        onError: () => {
          setPlaybackState('unavailable');
          setDemoStep('complete');
        },
      });
    },
    [preferences.hapticsEnabled, addActivityItem]
  );

  const animateCaptionReveal = useCallback(
    (targetWords: string[], onRevealComplete: () => void) => {
      if (preferences.reducedMotion) {
        setRevealedWordCount(targetWords.length);
        onRevealComplete();
        return;
      }

      setRevealedWordCount(1);
      let currentWord = 1;

      if (captionTimerRef.current) clearInterval(captionTimerRef.current);

      captionTimerRef.current = setInterval(() => {
        currentWord++;
        setRevealedWordCount(currentWord);

        if (currentWord >= targetWords.length) {
          if (captionTimerRef.current) clearInterval(captionTimerRef.current);
          onRevealComplete();
        }
      }, 130);
    },
    [preferences.reducedMotion]
  );

  const startGuidedDemo = useCallback(
    (phraseIndex: number = activePhraseIndex) => {
      SpeechService.stop();
      if (sequenceTimerRef.current) clearTimeout(sequenceTimerRef.current);
      if (captionTimerRef.current) clearInterval(captionTimerRef.current);

      setActivePhraseIndex(phraseIndex);
      const targetPhrase = DEMO_PHRASES[phraseIndex];
      const targetText = targetPhrase.translations[selectedLanguage];
      const targetWordsList = targetText.split(' ');

      setDemoStep('tracking');
      triggerHaptic('medium', preferences.hapticsEnabled);

      sequenceTimerRef.current = setTimeout(() => {
        setDemoStep('demonstrating');
        triggerHaptic('light', preferences.hapticsEnabled);

        sequenceTimerRef.current = setTimeout(() => {
          setDemoStep('captioning');

          animateCaptionReveal(targetWordsList, () => {
            sequenceTimerRef.current = setTimeout(() => {
              playVoiceOutput(targetText, selectedLanguage, targetPhrase);
            }, 250);
          });
        }, 1000);
      }, 800);
    },
    [
      activePhraseIndex,
      selectedLanguage,
      preferences.hapticsEnabled,
      animateCaptionReveal,
      playVoiceOutput,
    ]
  );

  // Auto-start demo when launched from Home / Onboarding
  useEffect(() => {
    if (!demoModeAutoStart) return;
    const timer = setTimeout(() => {
      consumeDemoAutoStart();
      startGuidedDemo(0);
    }, 0);
    return () => clearTimeout(timer);
  }, [demoModeAutoStart, consumeDemoAutoStart, startGuidedDemo]);

  const stopActiveSpeech = () => {
    SpeechService.stop();
    setPlaybackState('ready');
    setDemoStep('complete');
    triggerHaptic('light', preferences.hapticsEnabled);
  };

  const replayVoice = () => {
    playVoiceOutput(translatedCaption, selectedLanguage, activePhrase);
  };

  const resetGuidedExperience = () => {
    SpeechService.stop();
    if (sequenceTimerRef.current) clearTimeout(sequenceTimerRef.current);
    if (captionTimerRef.current) clearInterval(captionTimerRef.current);
    setDemoStep('ready');
    setPlaybackState('ready');
    setRevealedWordCount(words.length);
    triggerHaptic('medium', preferences.hapticsEnabled);
  };

  const handleSelectScenario = (index: number) => {
    resetPlaybackAndSpeech();
    setActivePhraseIndex(index);
    setShowPhrasePicker(false);
    startGuidedDemo(index);
  };

  const nextScenario = () => {
    const nextIdx = (activePhraseIndex + 1) % DEMO_PHRASES.length;
    handleSelectScenario(nextIdx);
  };

  const getCameraViewportState = (): InterpretationState => {
    switch (demoStep) {
      case 'tracking':
        return 'tracking';
      case 'demonstrating':
        return 'simulating';
      case 'captioning':
        return 'captioning';
      case 'speaking':
        return 'audio_playback';
      case 'complete':
        return 'complete';
      case 'ready':
      default:
        return 'ready';
    }
  };

  const isRunningDemo =
    demoStep === 'tracking' ||
    demoStep === 'demonstrating' ||
    demoStep === 'captioning';

  const stepStatusLabel =
    demoStep === 'tracking'
      ? t('interpret.statusTracking')
      : demoStep === 'demonstrating'
        ? t('interpret.statusDemonstrating')
        : demoStep === 'captioning'
          ? t('interpret.statusCaptioning')
          : demoStep === 'speaking'
            ? t('interpret.statusSpeaking')
            : null;

  return (
    <div className="flex flex-col flex-1 px-4 py-3.5 space-y-3.5 max-w-md mx-auto w-full">
      {/* 1. Live Camera Viewfinder */}
      <CameraViewport
        state={getCameraViewportState()}
        isSimulatedDemo={demoStep !== 'ready'}
        onCameraToggle={handleCameraToggle}
      />

      {/* 2. Live Translation Output Card */}
      <div className="p-4 rounded-3xl bg-[#0c1322] border border-white/[0.08] space-y-3 app-card-surface">
        {/* Card Header: Sign Concept Picker + Quick Controls */}
        <div className="flex items-center justify-between gap-2">
          <button
            id="btn-toggle-scenario-picker"
            onClick={() => setShowPhrasePicker(!showPhrasePicker)}
            className="flex items-center gap-2 min-w-0 px-2.5 py-1.5 -ml-1.5 rounded-xl hover:bg-white/[0.05] transition-colors cursor-pointer"
            aria-expanded={showPhrasePicker}
          >
            <Hand className="w-4 h-4 text-cyan-400 shrink-0" />
            <span className="text-xs font-bold text-white truncate">
              {activePhrase.signConcept}
            </span>
            <ChevronDown
              className={clsx(
                'w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform',
                showPhrasePicker && 'rotate-180'
              )}
            />
          </button>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => setShowSignGuide(!showSignGuide)}
              className={clsx(
                'p-1.5 rounded-lg border transition-colors cursor-pointer',
                showSignGuide
                  ? 'bg-cyan-500/15 border-cyan-400/40 text-cyan-300'
                  : 'bg-slate-900 border-white/[0.06] text-slate-400 hover:text-slate-200'
              )}
              aria-label={t('interpret.movementLabel')}
              aria-pressed={showSignGuide}
            >
              <Info className="w-3.5 h-3.5" />
            </button>

            <button
              id="btn-next-scenario"
              onClick={nextScenario}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 border border-white/[0.08] hover:border-cyan-500/30 text-[11px] font-semibold text-cyan-300 cursor-pointer transition-colors"
            >
              <span>{t('interpret.nextSign')}</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Inline Phrase Selector (Expanded on Demand) */}
        {showPhrasePicker ? (
          <div className="space-y-1.5 pt-1 max-h-52 overflow-y-auto no-scrollbar">
            {DEMO_PHRASES.map((phrase, idx) => {
              const isSelected = idx === activePhraseIndex;
              return (
                <button
                  key={phrase.id}
                  id={`btn-scenario-${phrase.id}`}
                  onClick={() => handleSelectScenario(idx)}
                  className={clsx(
                    'w-full px-3 py-2.5 rounded-xl border text-left flex items-center justify-between gap-2 transition-colors cursor-pointer',
                    isSelected
                      ? 'bg-cyan-500/15 border-cyan-400/50 text-white'
                      : 'bg-slate-950/60 border-white/[0.06] text-slate-300 hover:border-white/15'
                  )}
                  aria-pressed={isSelected}
                >
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-white truncate">
                      {phrase.signConcept}
                    </p>
                    <p className="text-[11px] text-slate-400 truncate">
                      {phrase.translations[selectedLanguage]}
                    </p>
                  </div>
                  {isSelected && <Check className="w-4 h-4 text-cyan-400 shrink-0" />}
                </button>
              );
            })}
          </div>
        ) : (
          <>
            {/* Translation Caption Box */}
            <div className="rounded-2xl bg-[#070b15] border border-white/[0.06] p-3.5 space-y-1.5">
              <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider">
                <span className="text-slate-400">{currentLang.name}</span>
                {stepStatusLabel && (
                  <span className="text-cyan-400">{stepStatusLabel}</span>
                )}
              </div>

              <p className="text-lg font-bold text-white leading-snug tracking-tight">
                {words.map((word, idx) => {
                  const isVisible =
                    demoStep !== 'captioning' || idx < revealedWordCount;
                  return (
                    <span
                      key={idx}
                      className={clsx(
                        'inline-block mr-1.5 transition-opacity duration-150',
                        isVisible ? 'opacity-100 text-white' : 'opacity-20 text-slate-500'
                      )}
                    >
                      {word}
                    </span>
                  );
                })}
              </p>

              {phoneticGuide && (
                <p className="text-xs text-slate-400 italic leading-snug">
                  {phoneticGuide}
                </p>
              )}

              {showSignGuide && (
                <div className="pt-2 mt-2 border-t border-white/[0.06] text-[11px] text-slate-300 leading-relaxed">
                  <span className="text-cyan-400 font-semibold mr-1">
                    {t('interpret.movementLabel')}:
                  </span>
                  <span>{activePhrase.signDescription}</span>
                </div>
              )}
            </div>

            {/* Waveform & Speak Button */}
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <WaveformVisualizer
                  playbackState={playbackState}
                  reducedMotion={preferences.reducedMotion}
                />
              </div>

              {playbackState === 'speaking' ? (
                <button
                  id="btn-stop-speech"
                  onClick={stopActiveSpeech}
                  className="h-10 px-3.5 rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-300 font-semibold text-xs flex items-center gap-1.5 active:scale-95 transition-all cursor-pointer shrink-0"
                  aria-label={t('interpret.stopVoice')}
                >
                  <VolumeX className="w-4 h-4" />
                  <span>{t('interpret.stopVoice')}</span>
                </button>
              ) : (
                <button
                  id="btn-replay-speech"
                  onClick={replayVoice}
                  className="h-10 px-3.5 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-400/35 text-cyan-300 font-semibold text-xs flex items-center gap-1.5 active:scale-95 transition-all cursor-pointer shrink-0"
                  aria-label={t('interpret.playVoice')}
                >
                  <Volume2 className="w-4 h-4 text-cyan-400" />
                  <span>
                    {playbackState === 'finished'
                      ? t('interpret.repeatAudio')
                      : t('interpret.playVoice')}
                  </span>
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {/* 3. Primary Controls Row */}
      <div className="flex items-center gap-2.5 pb-1">
        <button
          id="btn-start-guided-demo"
          onClick={() => startGuidedDemo(activePhraseIndex)}
          disabled={isRunningDemo}
          className={clsx(
            'flex-1 h-12 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98] cursor-pointer disabled:opacity-60',
            demoStep === 'speaking'
              ? 'bg-amber-400 text-slate-950'
              : 'bg-cyan-500 hover:bg-cyan-400 text-slate-950 shadow-[0_4px_18px_-4px_rgba(6,182,212,0.45)]'
          )}
        >
          <Play className="w-4 h-4 fill-current" />
          <span>
            {demoStep === 'complete'
              ? t('interpret.repeatAudio')
              : demoStep === 'speaking'
                ? t('interpret.statusSpeaking')
                : isRunningDemo
                  ? stepStatusLabel
                  : t('interpret.startPractice')}
          </span>
        </button>

        <button
          id="btn-reset-guided-experience"
          onClick={resetGuidedExperience}
          className="h-12 px-4 rounded-2xl bg-[#0c1322] border border-white/[0.08] hover:border-white/20 text-slate-300 hover:text-white font-semibold text-xs flex items-center justify-center gap-1.5 active:scale-95 transition-all cursor-pointer app-card-surface"
          aria-label={t('interpret.reset')}
        >
          <RotateCcw className="w-4 h-4 text-slate-400" />
          <span>{t('interpret.reset')}</span>
        </button>
      </div>
    </div>
  );
}
