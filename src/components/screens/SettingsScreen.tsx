'use client';

import React from 'react';
import {
  Globe,
  Vibrate,
  Shield,
  Eye,
  Award,
  Type,
  RotateCcw,
  CheckCircle2,
  Sparkles,
} from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { SUPPORTED_LANGUAGES } from '@/lib/translations';
import { SupportedLanguage } from '@/lib/types';
import { triggerHaptic } from '@/lib/speech';
import { Badge } from '@/components/ui/Badge';

export function SettingsScreen() {
  const {
    selectedLanguage,
    setLanguage,
    preferences,
    updatePreferences,
    goToOnboarding,
  } = useApp();

  const handleToggleHaptics = () => {
    const next = !preferences.hapticsEnabled;
    updatePreferences({ hapticsEnabled: next });
    if (next) {
      triggerHaptic('heavy', true);
    }
  };

  const handleToggleMotion = () => {
    updatePreferences({ reducedMotion: !preferences.reducedMotion });
  };

  const handleToggleContrast = () => {
    updatePreferences({ highContrast: !preferences.highContrast });
  };

  const handleFontSize = (size: 'normal' | 'large' | 'extra-large') => {
    updatePreferences({ fontSize: size });
  };

  return (
    <div className="flex flex-col flex-1 px-4 py-4 pb-safe space-y-4 max-w-md mx-auto w-full">
      {/* Title */}
      <div>
        <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">App Settings</h2>
        <p className="text-xs text-slate-400">Accessibility, language & privacy preferences</p>
      </div>

      {/* 1. SPOKEN OUTPUT LANGUAGE */}
      <div className="p-3.5 sm:p-4 rounded-3xl bg-slate-900/70 border border-cyan-500/20 space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-cyan-400" />
            <span className="text-xs font-bold text-white uppercase tracking-wider">
              Default Spoken Language
            </span>
          </div>
          <Badge variant="cyan" size="sm">
            {SUPPORTED_LANGUAGES[selectedLanguage].name}
          </Badge>
        </div>

        <div className="space-y-1.5">
          {Object.values(SUPPORTED_LANGUAGES).map((lang) => {
            const isSelected = selectedLanguage === lang.code;
            return (
              <button
                key={lang.code}
                id={`settings-lang-${lang.code}`}
                onClick={() => setLanguage(lang.code as SupportedLanguage)}
                className={`w-full p-2.5 rounded-xl border text-left flex items-center justify-between transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-cyan-500/15 border-cyan-400 text-white font-medium shadow-[0_0_10px_rgba(6,182,212,0.15)]'
                    : 'bg-slate-950/50 border-slate-800 text-slate-300 hover:text-white'
                }`}
                aria-pressed={isSelected}
              >
                <div>
                  <div className="text-xs font-bold">
                    {lang.name} <span className="font-normal text-slate-400">({lang.nativeName})</span>
                  </div>
                  <div className="text-[10px] text-slate-400">{lang.region}</div>
                </div>
                {isSelected && <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. ACCESSIBILITY CONTROLS */}
      <div className="p-3.5 sm:p-4 rounded-3xl bg-slate-900/70 border border-white/10 space-y-3">
        <div className="flex items-center gap-2">
          <Eye className="w-4 h-4 text-indigo-400" />
          <span className="text-xs font-bold text-white uppercase tracking-wider">
            Accessibility & Feedback
          </span>
        </div>

        {/* Haptic Feedback Toggle */}
        <div className="flex items-center justify-between py-1">
          <div>
            <p className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
              <Vibrate className="w-3.5 h-3.5 text-cyan-400" />
              <span>Tactile Haptics</span>
            </p>
            <p className="text-[10px] text-slate-400">
              Vibrate phone on state transitions & signing cues
            </p>
          </div>
          <button
            id="toggle-haptics"
            onClick={handleToggleHaptics}
            role="switch"
            aria-checked={preferences.hapticsEnabled}
            className={`w-11 h-6 rounded-full p-0.5 transition-colors relative cursor-pointer ${
              preferences.hapticsEnabled ? 'bg-cyan-500' : 'bg-slate-800'
            }`}
          >
            <div
              className={`w-5 h-5 rounded-full bg-white transition-transform ${
                preferences.hapticsEnabled ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {/* Reduced Motion Toggle */}
        <div className="flex items-center justify-between py-1 border-t border-white/5">
          <div>
            <p className="text-xs font-semibold text-slate-200">Reduced Motion</p>
            <p className="text-[10px] text-slate-400">
              Minimize camera scan lines & waveform animation
            </p>
          </div>
          <button
            id="toggle-reduced-motion"
            onClick={handleToggleMotion}
            role="switch"
            aria-checked={preferences.reducedMotion}
            className={`w-11 h-6 rounded-full p-0.5 transition-colors relative cursor-pointer ${
              preferences.reducedMotion ? 'bg-cyan-500' : 'bg-slate-800'
            }`}
          >
            <div
              className={`w-5 h-5 rounded-full bg-white transition-transform ${
                preferences.reducedMotion ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {/* High Contrast Toggle */}
        <div className="flex items-center justify-between py-1 border-t border-white/5">
          <div>
            <p className="text-xs font-semibold text-slate-200">High Contrast Palette</p>
            <p className="text-[10px] text-slate-400">
              Sharpen text & edge borders for enhanced visibility
            </p>
          </div>
          <button
            id="toggle-high-contrast"
            onClick={handleToggleContrast}
            role="switch"
            aria-checked={preferences.highContrast}
            className={`w-11 h-6 rounded-full p-0.5 transition-colors relative cursor-pointer ${
              preferences.highContrast ? 'bg-cyan-500' : 'bg-slate-800'
            }`}
          >
            <div
              className={`w-5 h-5 rounded-full bg-white transition-transform ${
                preferences.highContrast ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {/* Font Scaling */}
        <div className="pt-2 border-t border-white/5">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
              <Type className="w-3.5 h-3.5 text-cyan-400" />
              <span>Text Scale</span>
            </span>
            <span className="text-[10px] text-cyan-300 font-mono capitalize">
              {preferences.fontSize}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {(['normal', 'large', 'extra-large'] as const).map((size) => (
              <button
                key={size}
                id={`font-size-${size}`}
                onClick={() => handleFontSize(size)}
                className={`py-1 rounded-xl text-xs font-medium border transition-all cursor-pointer ${
                  preferences.fontSize === size
                    ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300'
                    : 'bg-slate-950/40 border-slate-800 text-slate-400'
                }`}
              >
                {size === 'normal' ? 'Normal' : size === 'large' ? 'Large' : 'XL'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 3. PRIVACY & CAMERA CONSENT */}
      <div className="p-3.5 sm:p-4 rounded-3xl bg-slate-900/70 border border-white/10 space-y-1.5 text-xs">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-emerald-400" />
          <span className="text-xs font-bold text-white uppercase tracking-wider">
            Camera Privacy & Consent
          </span>
        </div>
        <p className="text-[11px] text-slate-300 leading-relaxed">
          SignBridge AI is designed with strict on-device privacy principles. Video frames captured by your camera are analyzed locally in volatile memory to calculate hand/body landmark coordinates.
        </p>
        <p className="text-[10px] text-slate-400 leading-relaxed">
          No raw facial video is uploaded to cloud servers or saved without your explicit knowledge. Camera permissions are never requested upon page load—only when you deliberately start a camera session.
        </p>
      </div>

      {/* 4. ABOUT & PLATFORM CONTEXT */}
      <div className="p-3.5 sm:p-4 rounded-3xl bg-slate-900/50 border border-white/5 space-y-2.5 text-xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-cyan-400" />
            <span className="text-xs font-bold text-white">About SignBridge AI</span>
          </div>
          <Badge variant="cyan" size="sm">
            v1.0.0
          </Badge>
        </div>

        <p className="text-[11px] text-slate-300 leading-relaxed">
          SignBridge AI is an accessible communication platform bridging the gap between Nigerian Sign Language (NSL) and spoken conversation. Built with lightweight on-device computer vision and native multilingual speech synthesis.
        </p>

        <div className="pt-2 border-t border-white/5 flex items-center justify-between">
          <button
            id="btn-revisit-welcome"
            onClick={goToOnboarding}
            className="flex items-center gap-1.5 text-xs text-cyan-400 hover:text-cyan-300 transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Revisit Welcome Tour</span>
          </button>
          <span className="text-[10px] text-slate-500">SignBridge AI • Nigeria</span>
        </div>
      </div>
    </div>
  );
}
