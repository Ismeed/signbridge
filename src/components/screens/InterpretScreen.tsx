'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Volume2,
  VolumeX,
  Play,
  RotateCcw,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Hand,
  ChevronDown,
  Maximize2,
  Minimize2,
  Info,
  Tv,
  ArrowRight,
  ShieldCheck,
  UserCheck,
  UserX,
} from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { CameraViewport } from '@/components/ui/CameraViewport';
import { WaveformVisualizer } from '@/components/ui/WaveformVisualizer';
import { Badge } from '@/components/ui/Badge';
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
  VoiceDiagnostic,
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
    setLanguage,
    preferences,
    demoModeAutoStart,
    consumeDemoAutoStart,
  } = useApp();

  // Guided demo sequence states
  const [demoStep, setDemoStep] = useState<GuidedDemoStep>('ready');
  const [activePhraseIndex, setActivePhraseIndex] = useState<number>(0);
  const [playbackState, setPlaybackState] = useState<PlaybackState>('ready');
  const [voiceDiagnostic, setVoiceDiagnostic] = useState<VoiceDiagnostic | null>(null);

  // Progressive caption reveal state
  const [revealedWordCount, setRevealedWordCount] = useState<number>(0);

  // UI modes
  const [showcaseMode, setShowcaseMode] = useState<boolean>(false);
  const [showPhrasePicker, setShowPhrasePicker] = useState<boolean>(false);

  // Real camera & person detection tracking states
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [isPersonDetected, setIsPersonDetected] = useState<boolean>(false);

  // Timers ref for clean teardown
  const sequenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const captionTimerRef = useRef<NodeJS.Timeout | null>(null);

  const activePhrase: DemoPhrase = DEMO_PHRASES[activePhraseIndex] || DEMO_PHRASES[0];
  const translatedCaption = activePhrase.translations[selectedLanguage];
  const phoneticGuide = activePhrase.phoneticGuide?.[selectedLanguage];
  const currentLang = SUPPORTED_LANGUAGES[selectedLanguage];

  const words = translatedCaption.split(' ');

  // Clean up any ongoing timers and audio on unmount
  useEffect(() => {
    return () => {
      SpeechService.stop();
      if (sequenceTimerRef.current) clearTimeout(sequenceTimerRef.current);
      if (captionTimerRef.current) clearInterval(captionTimerRef.current);
    };
  }, []);

  // Inspect available voices whenever selected language changes or speech service updates
  useEffect(() => {
    SpeechService.init();
    const diag = SpeechService.inspectVoice(selectedLanguage);
    setVoiceDiagnostic(diag);
  }, [selectedLanguage]);

  // Stop speech and clear caption animation when language or active phrase changes
  const resetPlaybackAndSpeech = useCallback(() => {
    SpeechService.stop();
    setPlaybackState('ready');
    if (captionTimerRef.current) clearInterval(captionTimerRef.current);
    setRevealedWordCount(words.length);
  }, [words.length]);

  // Handle external auto-start from Home "Explore Demo"
  useEffect(() => {
    if (demoModeAutoStart) {
      consumeDemoAutoStart();
      startGuidedDemo(0);
    }
  }, [demoModeAutoStart, consumeDemoAutoStart]);

  /**
   * Execute real Web Speech API output with strict event driving
   */
  const playVoiceOutput = useCallback(
    (textToSpeak: string, langToSpeak: SupportedLanguage) => {
      setPlaybackState('speaking');
      setDemoStep('speaking');
      triggerHaptic('light', preferences.hapticsEnabled);

      const success = SpeechService.speak(textToSpeak, langToSpeak, {
        onStart: () => {
          setPlaybackState('speaking');
          setDemoStep('speaking');
        },
        onBoundary: () => {
          // Word boundary tick
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

      if (!success) {
        setPlaybackState('unavailable');
        setDemoStep('complete');
      }
    },
    [preferences.hapticsEnabled]
  );

  /**
   * Progressive word-by-word caption reveal respecting reduced motion
   */
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
      }, 140);
    },
    [preferences.reducedMotion]
  );

  /**
   * Step-by-Step Guided Demonstration Flow:
   * 1. Ready -> 2. Tracking -> 3. Demonstrating -> 4. Captioning -> 5. Voice output -> 6. Complete
   */
  const startGuidedDemo = useCallback(
    (phraseIndex: number = activePhraseIndex) => {
      SpeechService.stop();
      if (sequenceTimerRef.current) clearTimeout(sequenceTimerRef.current);
      if (captionTimerRef.current) clearInterval(captionTimerRef.current);

      setActivePhraseIndex(phraseIndex);
      const targetPhrase = DEMO_PHRASES[phraseIndex];
      const targetText = targetPhrase.translations[selectedLanguage];
      const targetWordsList = targetText.split(' ');

      // Step 1: Establish tracking / subject check
      setDemoStep('tracking');
      triggerHaptic('medium', preferences.hapticsEnabled);

      sequenceTimerRef.current = setTimeout(() => {
        // Step 2: Demonstrating NSL motion
        setDemoStep('demonstrating');
        triggerHaptic('light', preferences.hapticsEnabled);

        sequenceTimerRef.current = setTimeout(() => {
          // Step 3: Progressive Caption Reveal
          setDemoStep('captioning');

          animateCaptionReveal(targetWordsList, () => {
            // Step 4: Spoken Voice Output
            sequenceTimerRef.current = setTimeout(() => {
              playVoiceOutput(targetText, selectedLanguage);
            }, 300);
          });
        }, 1200);
      }, 900);
    },
    [
      activePhraseIndex,
      selectedLanguage,
      preferences.hapticsEnabled,
      animateCaptionReveal,
      playVoiceOutput,
    ]
  );

  const stopActiveSpeech = () => {
    SpeechService.stop();
    setPlaybackState('ready');
    setDemoStep('complete');
    triggerHaptic('light', preferences.hapticsEnabled);
  };

  const replayVoice = () => {
    playVoiceOutput(translatedCaption, selectedLanguage);
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

  const handleLanguageChange = (lang: SupportedLanguage) => {
    setLanguage(lang);
    resetPlaybackAndSpeech();
    const newText = activePhrase.translations[lang];
    setRevealedWordCount(newText.split(' ').length);

    // If currently completed, replay in the newly selected language
    if (demoStep === 'complete' || demoStep === 'speaking') {
      setTimeout(() => {
        playVoiceOutput(newText, lang);
      }, 250);
    }
  };

  // Map guided step to camera viewport state
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

  return (
    <div
      className={`flex flex-col flex-1 px-4 py-4 pb-safe space-y-4 max-w-md mx-auto w-full transition-all ${
        showcaseMode ? 'bg-[#040814] min-h-screen py-2' : ''
      }`}
    >
      {/* Platform Mode & Presentation View Switcher */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Badge variant="cyan" size="sm">
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
            <span className="font-semibold text-[11px] truncate">AI Vision & Speech</span>
          </Badge>
          <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/40 px-2 py-0.5 rounded-full border border-emerald-500/20 shrink-0 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Live Engine
          </span>
        </div>

        {/* Focused Showcase Mode Toggle */}
        <button
          id="btn-toggle-showcase-mode"
          onClick={() => {
            setShowcaseMode(!showcaseMode);
            triggerHaptic('medium', preferences.hapticsEnabled);
          }}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
            showcaseMode
              ? 'bg-cyan-500 text-slate-950 border-cyan-400 shadow-[0_0_12px_rgba(6,182,212,0.5)]'
              : 'bg-slate-900/80 text-cyan-300 border-cyan-500/30 hover:bg-cyan-500/10'
          }`}
          title="Toggle High-Visibility Showcase Presentation Mode"
          aria-label="Toggle High-Visibility Showcase Presentation Mode"
        >
          {showcaseMode ? (
            <>
              <Minimize2 className="w-3.5 h-3.5" />
              <span>Standard View</span>
            </>
          ) : (
            <>
              <Maximize2 className="w-3.5 h-3.5" />
              <span>Showcase Mode</span>
            </>
          )}
        </button>
      </div>

      {/* Real-Time Processing Status Bar */}
      <div className="flex items-center justify-between px-3.5 py-2 rounded-xl bg-slate-900/80 border border-cyan-500/20 text-slate-200 text-xs shadow-sm">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse shrink-0" />
          <span className="font-medium text-[11px] leading-tight text-slate-300 truncate">
            {isCameraActive
              ? (isPersonDetected ? 'Subject detected • Ready for gesture recognition' : 'Align body in camera frame')
              : 'Ready • Launch camera or select sign phrase'}
          </span>
        </div>
        <Badge variant={isCameraActive ? (isPersonDetected ? 'emerald' : 'cyan') : 'slate'} size="sm">
          {isCameraActive ? (isPersonDetected ? 'Target Locked' : 'Scanning') : 'Camera Standby'}
        </Badge>
      </div>

      {/* Live Camera Viewport with Genuine Person Tracking */}
      <CameraViewport
        state={getCameraViewportState()}
        isSimulatedDemo={demoStep !== 'ready'}
        onCameraToggle={(active) => setIsCameraActive(active)}
        onPersonDetect={(detected) => setIsPersonDetected(detected)}
      />

      {/* Step Progress Tracker Bar */}
      <div className="px-3.5 py-2 rounded-2xl bg-slate-950/70 border border-white/5 flex items-center justify-between text-[11px] font-mono">
        <div className="flex items-center gap-1.5">
          <span className="text-slate-400">Step:</span>
          <span className="font-bold text-cyan-300 uppercase tracking-wider">
            {demoStep === 'ready' && '1. Ready'}
            {demoStep === 'tracking' && '2. Detecting Subject'}
            {demoStep === 'demonstrating' && '3. Tracking Gesture'}
            {demoStep === 'captioning' && '4. Generating Caption'}
            {demoStep === 'speaking' && '5. Synthesizing Speech'}
            {demoStep === 'complete' && '6. Complete'}
          </span>
        </div>

        {/* Real Person Tracking Status Pill */}
        <div className="flex items-center gap-1">
          {isCameraActive ? (
            isPersonDetected ? (
              <span className="flex items-center gap-1 text-emerald-400 text-[10px]">
                <UserCheck className="w-3 h-3" />
                <span>Subject Tracked</span>
              </span>
            ) : (
              <span className="flex items-center gap-1 text-cyan-300 text-[10px]">
                <UserX className="w-3 h-3 animate-pulse" />
                <span>Searching Subject</span>
              </span>
            )
          ) : (
            <span className="text-slate-500 text-[10px]">Camera Standby</span>
          )}
        </div>
      </div>

      {/* Primary Interpretation Controls Toolbar */}
      <div className="grid grid-cols-2 gap-2.5">
        <button
          id="btn-start-guided-demo"
          onClick={() => startGuidedDemo(activePhraseIndex)}
          disabled={demoStep === 'demonstrating' || demoStep === 'captioning'}
          className={`h-12 rounded-2xl font-bold text-xs flex items-center justify-center gap-2 transition-all active:scale-95 cursor-pointer disabled:opacity-50 ${
            demoStep === 'demonstrating' || demoStep === 'speaking'
              ? 'bg-amber-500 text-slate-950 animate-pulse shadow-[0_0_15px_rgba(245,158,11,0.5)]'
              : 'bg-cyan-500 hover:bg-cyan-400 text-slate-950 shadow-[0_0_15px_rgba(6,182,212,0.4)]'
          }`}
          aria-label="Translate Selected Sign Gesture"
        >
          <Play className="w-4 h-4 fill-current" />
          <span>
            {demoStep === 'complete'
              ? 'Replay Translation'
              : demoStep === 'speaking'
              ? 'Speaking Output...'
              : 'Translate Sign'}
          </span>
        </button>

        <button
          id="btn-reset-guided-experience"
          onClick={resetGuidedExperience}
          className="h-12 rounded-2xl bg-slate-900 border border-white/10 hover:border-cyan-500/30 text-slate-300 hover:text-white font-medium text-xs flex items-center justify-center gap-2 transition-all active:scale-95 cursor-pointer"
          aria-label="Reset Interpreter View"
        >
          <RotateCcw className="w-4 h-4 text-slate-400" />
          <span>Reset View</span>
        </button>
      </div>

      {/* Focused Interpretation Presentation Card */}
      <div
        className={`p-4 rounded-3xl bg-slate-900/85 border border-cyan-500/25 backdrop-blur-xl space-y-3.5 shadow-xl transition-all ${
          showcaseMode ? 'ring-2 ring-cyan-400/40' : ''
        }`}
      >
        {/* Caption Header & Language Selector */}
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-2 min-w-0 pr-2">
            <span className="p-1.5 rounded-lg bg-cyan-500/20 text-cyan-400 shrink-0">
              <Hand className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-bold text-white truncate">
                Scenario: {activePhrase.signConcept}
              </p>
              <p className="text-[10px] text-cyan-400 font-mono truncate">
                Target Category: {activePhrase.category}
              </p>
            </div>
          </div>

          {/* 5 Spoken Output Languages Dropdown */}
          <div className="relative shrink-0">
            <select
              id="select-interpret-language"
              value={selectedLanguage}
              onChange={(e) => handleLanguageChange(e.target.value as SupportedLanguage)}
              className="bg-slate-950 border border-cyan-500/40 text-cyan-300 text-xs font-bold px-3 py-1.5 rounded-xl focus:outline-none focus:ring-2 focus:ring-cyan-400 cursor-pointer shadow-sm"
              aria-label="Select Spoken Output Language"
            >
              {Object.values(SUPPORTED_LANGUAGES).map((l) => (
                <option key={l.code} value={l.code} className="bg-slate-950 text-white">
                  {l.name} ({l.nativeName})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Dynamic Caption Box with Smooth Progressive Reveal */}
        <div
          className={`relative rounded-2xl bg-[#060b17] border border-cyan-500/20 flex flex-col justify-center transition-all ${
            showcaseMode ? 'p-5 min-h-[120px]' : 'p-3.5 min-h-[90px]'
          }`}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-mono uppercase tracking-wider text-cyan-400/80">
              Spoken Interpretation Output [{currentLang.name}]
            </span>
            <span className="text-[9px] font-mono text-slate-400 bg-slate-900 px-1.5 py-0.5 rounded">
              {currentLang.region}
            </span>
          </div>

          {/* Progressive Animated Caption Text */}
          <p
            className={`font-extrabold text-white tracking-tight leading-snug transition-all ${
              showcaseMode ? 'text-xl sm:text-2xl text-cyan-100' : 'text-base sm:text-lg'
            }`}
          >
            "
            {words.map((word, idx) => {
              const isVisible = idx < revealedWordCount;
              return (
                <span
                  key={idx}
                  className={`inline-block mr-1.5 transition-opacity duration-200 ${
                    isVisible
                      ? 'opacity-100 translate-y-0 text-white'
                      : 'opacity-20 text-slate-500'
                  }`}
                >
                  {word}
                </span>
              );
            })}
            "
          </p>

          {/* Phonetic Pronunciation Guide */}
          {phoneticGuide && (
            <p className="text-[11px] font-mono text-cyan-300/80 mt-1 italic">
              Pronunciation: {phoneticGuide}
            </p>
          )}

          {/* Physical NSL Sign Motion Instruction Guide */}
          <div className="mt-2.5 pt-2 border-t border-white/5 flex items-start gap-1.5 text-[11px] text-slate-300 leading-snug">
            <span className="text-cyan-400 font-semibold shrink-0">NSL Sign Motion:</span>
            <span className="italic text-slate-400">{activePhrase.signDescription}</span>
          </div>
        </div>

        {/* Audio Synthesis Diagnostic & Voice Notification */}
        {voiceDiagnostic && (
          <div className="flex items-start gap-2 px-3 py-1.5 rounded-xl bg-slate-950/60 border border-white/5 text-[10px] text-slate-400">
            <Info className="w-3.5 h-3.5 text-cyan-400 shrink-0 mt-0.5" />
            <span className="leading-tight">{voiceDiagnostic.statusMessage}</span>
          </div>
        )}

        {/* Speech Synthesis Event-Driven Audio Controls & Waveform */}
        <div className="flex items-center justify-between gap-3 pt-1">
          {/* Waveform Visualizer Driven Directly by Speech Events */}
          <div className="flex-1 min-w-0">
            <WaveformVisualizer
              playbackState={playbackState}
              reducedMotion={preferences.reducedMotion}
            />
          </div>

          {/* Audio Play / Stop / Replay Controls */}
          <div className="flex items-center gap-2 shrink-0">
            {playbackState === 'speaking' ? (
              <button
                id="btn-stop-speech"
                onClick={stopActiveSpeech}
                className="h-11 px-4 rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-300 font-semibold text-xs flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer shadow-sm"
                aria-label="Stop ongoing speech synthesis"
              >
                <VolumeX className="w-4 h-4" />
                <span>Stop</span>
              </button>
            ) : (
              <button
                id="btn-replay-speech"
                onClick={replayVoice}
                className="h-11 px-4 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-cyan-300 font-bold text-xs flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer shadow-sm"
                aria-label="Play or replay spoken interpretation aloud"
              >
                <Volume2 className="w-4 h-4 text-cyan-400" />
                <span>{playbackState === 'finished' ? 'Replay' : 'Play Voice'}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Phrase Library Accordion Selector */}
      <div className="p-3.5 rounded-2xl bg-slate-900/60 border border-white/10 space-y-2">
        <button
          id="btn-toggle-scenario-picker"
          onClick={() => setShowPhrasePicker(!showPhrasePicker)}
          className="w-full flex items-center justify-between text-xs font-semibold text-slate-200 cursor-pointer"
          aria-expanded={showPhrasePicker}
        >
          <div className="flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
            <span>Select Sign Phrase ({DEMO_PHRASES.length} Available)</span>
          </div>
          <ChevronDown
            className={`w-4 h-4 text-slate-400 transition-transform ${
              showPhrasePicker ? 'rotate-180' : ''
            }`}
          />
        </button>

        {showPhrasePicker && (
          <div className="grid grid-cols-1 gap-2 pt-2">
            {DEMO_PHRASES.map((phrase, idx) => {
              const isSelected = idx === activePhraseIndex;
              return (
                <button
                  key={phrase.id}
                  id={`btn-scenario-${phrase.id}`}
                  onClick={() => handleSelectScenario(idx)}
                  className={`p-3 rounded-xl border text-left flex items-start justify-between text-xs transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-cyan-500/15 border-cyan-400 text-white shadow-md'
                      : 'bg-slate-950/70 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                  }`}
                  aria-pressed={isSelected}
                >
                  <div className="space-y-0.5 min-w-0 pr-2">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-white text-xs">{phrase.signConcept}</span>
                      <span className="text-[9px] font-mono text-cyan-400 bg-cyan-950/80 px-1.5 py-0.2 rounded border border-cyan-500/20">
                        {phrase.category}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-300 line-clamp-1 italic">
                      "{phrase.translations[selectedLanguage]}"
                    </p>
                  </div>
                  {isSelected ? (
                    <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                  ) : (
                    <ArrowRight className="w-3.5 h-3.5 text-slate-600 shrink-0 mt-0.5" />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Next Scenario Shortcut Button */}
      <div className="flex items-center justify-between px-2 pt-1">
        <span className="text-[11px] text-slate-400">
          Current: <strong className="text-white">{activePhrase.signConcept}</strong>
        </span>
        <button
          id="btn-next-scenario"
          onClick={nextScenario}
          className="text-xs font-bold text-cyan-300 hover:text-cyan-200 flex items-center gap-1 cursor-pointer"
        >
          <span>Next Phrase</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Privacy & Hardware Standards Footer */}
      <div className="p-3 rounded-2xl bg-slate-950/40 border border-white/5 text-[11px] text-slate-400 flex items-center justify-between select-none">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-cyan-400 shrink-0" />
          <span className="text-slate-300 font-medium">On-Device Neural Vision • Zero Cloud Upload</span>
        </div>
        <span className="text-[10px] font-mono text-cyan-400/80">Active</span>
      </div>
    </div>
  );
}
