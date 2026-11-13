'use client';

import React from 'react';
import clsx from 'clsx';
import {
  Camera,
  Play,
  Check,
  ChevronRight,
  Clock,
} from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { SUPPORTED_LANGUAGES } from '@/lib/translations';
import { SupportedLanguage } from '@/lib/types';

export function HomeScreen() {
  const {
    selectedLanguage,
    setLanguage,
    startLiveSession,
    startDemoSession,
    navigateToTab,
    activityHistory,
    t,
  } = useApp();

  const currentLangInfo = SUPPORTED_LANGUAGES[selectedLanguage];
  const latestActivity = activityHistory[0];

  return (
    <div className="flex flex-col flex-1 px-4 py-5 space-y-5 max-w-md mx-auto w-full">
      {/* Concise Greeting */}
      <div className="space-y-1">
        <h1 className="text-2xl font-extrabold text-white tracking-tight leading-tight">
          {currentLangInfo.greeting}
        </h1>
        <p className="text-sm text-slate-400">{t('home.subtitle')}</p>
      </div>

      {/* Primary Action: Live Interpretation */}
      <button
        id="card-start-live-session"
        onClick={startLiveSession}
        className="w-full text-left relative overflow-hidden p-5 rounded-3xl bg-gradient-to-br from-[#0e2646] via-[#0b1b34] to-[#081224] border border-cyan-400/30 shadow-[0_14px_34px_-14px_rgba(6,182,212,0.45)] active:scale-[0.98] transition-all cursor-pointer group"
      >
        <div className="flex items-start justify-between mb-5">
          <div className="w-12 h-12 rounded-2xl bg-cyan-500 text-slate-950 flex items-center justify-center shadow-[0_4px_16px_rgba(6,182,212,0.4)]">
            <Camera className="w-6 h-6 stroke-[2.2]" />
          </div>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-cyan-500/15 border border-cyan-400/25 text-[11px] font-semibold text-cyan-300">
            {currentLangInfo.name}
          </span>
        </div>

        <div className="space-y-1 mb-4">
          <h2 className="text-lg font-bold text-white tracking-tight">
            {t('home.startLiveTitle')}
          </h2>
          <p className="text-xs text-slate-300 leading-relaxed">
            {t('home.startLiveDesc')}
          </p>
        </div>

        <div className="flex items-center justify-between pt-3 border-t border-white/10">
          <span className="text-xs font-bold text-cyan-400">
            {t('home.startLiveBtn')}
          </span>
          <ChevronRight className="w-4 h-4 text-cyan-400 group-hover:translate-x-0.5 transition-transform" />
        </div>
      </button>

      {/* Secondary Action: Guided Demo */}
      <button
        id="card-try-demo"
        onClick={startDemoSession}
        className="w-full p-4 rounded-2xl bg-[#0c1322] border border-white/[0.08] hover:border-white/15 active:scale-[0.98] transition-all cursor-pointer flex items-center justify-between text-left group app-card-surface"
      >
        <div className="flex items-center gap-3.5 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-slate-800/90 text-cyan-400 flex items-center justify-center shrink-0">
            <Play className="w-4 h-4 fill-cyan-400" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-white truncate">
              {t('home.practiceTitle')}
            </h3>
            <p className="text-xs text-slate-400 truncate">
              {t('home.practiceDesc')}
            </p>
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-slate-300 shrink-0 ml-2" />
      </button>

      {/* Compact Output Language Switcher */}
      <div className="space-y-2.5">
        <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 px-0.5">
          {t('home.languagesTitle')}
        </span>

        <div className="flex flex-wrap gap-2">
          {Object.values(SUPPORTED_LANGUAGES).map((lang) => {
            const isSelected = selectedLanguage === lang.code;
            return (
              <button
                key={lang.code}
                id={`btn-lang-${lang.code}`}
                onClick={() => setLanguage(lang.code as SupportedLanguage)}
                className={clsx(
                  'inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-2xl border text-xs font-semibold transition-all active:scale-[0.97] cursor-pointer',
                  isSelected
                    ? 'bg-cyan-500/15 border-cyan-400/60 text-cyan-300'
                    : 'bg-[#0c1322] border-white/[0.08] text-slate-300 hover:border-white/20 app-card-surface'
                )}
                aria-pressed={isSelected}
              >
                <span>{lang.name}</span>
                {isSelected && <Check className="w-3.5 h-3.5 text-cyan-400 stroke-[2.5]" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* Latest Activity Shortcut (Shown only when history exists) */}
      {latestActivity && (
        <button
          onClick={() => navigateToTab('activity')}
          className="w-full px-4 py-3 rounded-2xl bg-[#0c1322] border border-white/[0.08] hover:border-white/15 active:scale-[0.98] transition-all cursor-pointer flex items-center justify-between text-left app-card-surface"
        >
          <div className="flex items-center gap-3 min-w-0">
            <Clock className="w-4 h-4 text-slate-400 shrink-0" />
            <div className="min-w-0">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 block">
                {t('home.recentLabel')} • {SUPPORTED_LANGUAGES[latestActivity.language].name}
              </span>
              <p className="text-xs font-medium text-slate-200 truncate">
                {latestActivity.translatedText}
              </p>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-slate-500 shrink-0 ml-2" />
        </button>
      )}
    </div>
  );
}
