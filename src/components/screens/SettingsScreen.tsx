'use client';

import React, { useState, useSyncExternalStore } from 'react';
import clsx from 'clsx';
import {
  Check,
  ShieldCheck,
  ChevronRight,
  RotateCcw,
  Database,
} from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { SUPPORTED_LANGUAGES } from '@/lib/translations';
import { SupportedLanguage } from '@/lib/types';
import { triggerHaptic } from '@/lib/speech';
import { getNslSampleCountSnapshot, subscribeNslDataset } from '@/lib/nslDataset';
import { getNslModelSnapshot, subscribeNslModel } from '@/lib/nslModel';
import { NslRecorderModal } from '@/components/ui/NslRecorderModal';

export function SettingsScreen() {
  const {
    selectedLanguage,
    setLanguage,
    preferences,
    updatePreferences,
    goToOnboarding,
    t,
  } = useApp();

  const [recorderOpen, setRecorderOpen] = useState<boolean>(false);
  const nslSampleCount = useSyncExternalStore(
    subscribeNslDataset,
    getNslSampleCountSnapshot,
    () => 0
  );
  const trainedNslModel = useSyncExternalStore(
    subscribeNslModel,
    getNslModelSnapshot,
    () => null
  );

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
    <div className="flex flex-col flex-1 px-4 py-5 space-y-5 max-w-md mx-auto w-full">
      {/* Screen Header */}
      <div>
        <h1 className="text-xl font-extrabold text-white tracking-tight">
          {t('settings.title')}
        </h1>
        <p className="text-xs text-slate-400">{t('settings.subtitle')}</p>
      </div>

      {/* 1. Output Language */}
      <section className="space-y-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 px-1">
          {t('settings.spokenLangTitle')}
        </h2>

        <div className="rounded-2xl bg-[#0c1322] border border-white/[0.08] divide-y divide-white/[0.06] overflow-hidden app-card-surface">
          {Object.values(SUPPORTED_LANGUAGES).map((lang) => {
            const isSelected = selectedLanguage === lang.code;
            return (
              <button
                key={lang.code}
                id={`settings-lang-${lang.code}`}
                onClick={() => setLanguage(lang.code as SupportedLanguage)}
                className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-white/[0.03] active:bg-white/[0.05] transition-colors cursor-pointer"
                aria-pressed={isSelected}
              >
                <div className="flex items-baseline gap-2 min-w-0">
                  <span
                    className={clsx(
                      'text-sm font-semibold',
                      isSelected ? 'text-cyan-400' : 'text-white'
                    )}
                  >
                    {lang.name}
                  </span>
                  <span className="text-xs text-slate-400 truncate">
                    {lang.nativeName}
                  </span>
                </div>
                {isSelected && <Check className="w-4 h-4 text-cyan-400 stroke-[2.5] shrink-0" />}
              </button>
            );
          })}
        </div>
      </section>

      {/* 2. Accessibility */}
      <section className="space-y-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 px-1">
          {t('settings.accessTitle')}
        </h2>

        <div className="rounded-2xl bg-[#0c1322] border border-white/[0.08] divide-y divide-white/[0.06] overflow-hidden app-card-surface">
          {/* Haptic Feedback */}
          <div className="px-4 py-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-white">{t('settings.haptics')}</p>
              <p className="text-[11px] text-slate-400 truncate">{t('settings.hapticsDesc')}</p>
            </div>
            <button
              id="toggle-haptics"
              onClick={handleToggleHaptics}
              role="switch"
              aria-checked={preferences.hapticsEnabled}
              className={clsx(
                'w-11 h-6 rounded-full p-0.5 transition-colors shrink-0 cursor-pointer',
                preferences.hapticsEnabled ? 'bg-cyan-500' : 'bg-slate-700'
              )}
            >
              <div
                className={clsx(
                  'w-5 h-5 rounded-full bg-white shadow-sm transition-transform',
                  preferences.hapticsEnabled ? 'translate-x-5' : 'translate-x-0'
                )}
              />
            </button>
          </div>

          {/* Reduced Motion */}
          <div className="px-4 py-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-white">{t('settings.motion')}</p>
              <p className="text-[11px] text-slate-400 truncate">{t('settings.motionDesc')}</p>
            </div>
            <button
              id="toggle-reduced-motion"
              onClick={handleToggleMotion}
              role="switch"
              aria-checked={preferences.reducedMotion}
              className={clsx(
                'w-11 h-6 rounded-full p-0.5 transition-colors shrink-0 cursor-pointer',
                preferences.reducedMotion ? 'bg-cyan-500' : 'bg-slate-700'
              )}
            >
              <div
                className={clsx(
                  'w-5 h-5 rounded-full bg-white shadow-sm transition-transform',
                  preferences.reducedMotion ? 'translate-x-5' : 'translate-x-0'
                )}
              />
            </button>
          </div>

          {/* High Contrast */}
          <div className="px-4 py-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-white">{t('settings.contrast')}</p>
              <p className="text-[11px] text-slate-400 truncate">{t('settings.contrastDesc')}</p>
            </div>
            <button
              id="toggle-high-contrast"
              onClick={handleToggleContrast}
              role="switch"
              aria-checked={preferences.highContrast}
              className={clsx(
                'w-11 h-6 rounded-full p-0.5 transition-colors shrink-0 cursor-pointer',
                preferences.highContrast ? 'bg-cyan-500' : 'bg-slate-700'
              )}
            >
              <div
                className={clsx(
                  'w-5 h-5 rounded-full bg-white shadow-sm transition-transform',
                  preferences.highContrast ? 'translate-x-5' : 'translate-x-0'
                )}
              />
            </button>
          </div>

          {/* Text Size Segmented Control */}
          <div className="px-4 py-3 space-y-2.5">
            <p className="text-sm font-medium text-white">{t('settings.fontSize')}</p>
            <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-slate-950/80 border border-white/[0.06]">
              {(['normal', 'large', 'extra-large'] as const).map((size) => {
                const isActive = preferences.fontSize === size;
                return (
                  <button
                    key={size}
                    id={`font-size-${size}`}
                    onClick={() => handleFontSize(size)}
                    className={clsx(
                      'py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer',
                      isActive
                        ? 'bg-cyan-500 text-slate-950 shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    )}
                  >
                    {size === 'normal'
                      ? t('settings.fontNormal')
                      : size === 'large'
                      ? t('settings.fontLarge')
                      : t('settings.fontExtra')}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* 3. Privacy & App */}
      <section className="space-y-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 px-1">
          {t('settings.privacySection')}
        </h2>

        <div className="rounded-2xl bg-[#0c1322] border border-white/[0.08] divide-y divide-white/[0.06] overflow-hidden app-card-surface">
          <div className="px-4 py-3 flex items-center gap-3">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="text-xs text-slate-300">{t('settings.privacyNote')}</span>
          </div>

          <button
            id="btn-nsl-recorder"
            onClick={() => setRecorderOpen(true)}
            className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-white/[0.03] active:bg-white/[0.05] transition-colors cursor-pointer"
          >
            <span className="flex items-center gap-2.5 text-sm font-medium text-white">
              <Database className="w-4 h-4 text-cyan-400" />
              <span>NSL Training Dataset</span>
            </span>
            <span className="flex items-center gap-2 text-xs text-slate-400">
              <span>{nslSampleCount} clips</span>
              {trainedNslModel && (
                <span className="px-1.5 py-0.5 rounded-md bg-emerald-500/15 text-emerald-300 text-[10px] font-semibold">
                  Model Ready
                </span>
              )}
              <ChevronRight className="w-4 h-4 text-slate-500" />
            </span>
          </button>

          <button
            id="btn-revisit-welcome"
            onClick={goToOnboarding}
            className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-white/[0.03] active:bg-white/[0.05] transition-colors cursor-pointer"
          >
            <span className="flex items-center gap-2.5 text-sm font-medium text-white">
              <RotateCcw className="w-4 h-4 text-cyan-400" />
              <span>{t('settings.replayOnboarding')}</span>
            </span>
            <ChevronRight className="w-4 h-4 text-slate-500" />
          </button>
        </div>
      </section>

      <p className="text-center text-[11px] text-slate-500 pt-1 pb-2">
        SignBridge AI • v1.0
      </p>

      {recorderOpen && (
        <NslRecorderModal
          isOpen={recorderOpen}
          onClose={() => setRecorderOpen(false)}
        />
      )}
    </div>
  );
}
