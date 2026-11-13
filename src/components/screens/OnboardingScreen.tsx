'use client';

import React from 'react';
import { ArrowRight, Play, Video, Volume2, ShieldCheck } from 'lucide-react';
import { useApp } from '@/context/AppContext';

export function OnboardingScreen() {
  const { enterAppFromOnboarding, startDemoSession, t } = useApp();

  return (
    <div className="flex flex-col min-h-full justify-between px-5 py-7 max-w-md mx-auto w-full select-none">
      {/* Minimal Brand Mark */}
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-cyan-400 to-cyan-600 flex items-center justify-center">
          <span className="text-slate-950 font-black text-[11px] tracking-tight">SB</span>
        </div>
        <span className="text-sm font-bold tracking-tight text-white">
          SignBridge <span className="text-cyan-400">AI</span>
        </span>
      </div>

      {/* Center Hero */}
      <div className="my-auto py-6 flex flex-col items-center text-center">
        <div className="relative w-28 h-28 mb-6 flex items-center justify-center">
          <div className="absolute inset-0 rounded-full bg-cyan-500/15 blur-xl" />
          <div className="absolute inset-0 rounded-full border border-cyan-500/20 animate-radar" />
          <div className="relative w-22 h-22 rounded-3xl bg-[#0c1322] border border-white/10 flex items-center justify-center shadow-xl">
            <svg
              viewBox="0 0 100 100"
              className="w-12 h-12 text-cyan-400"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M35 65 C35 75 45 80 55 80 C68 80 75 70 75 55 L75 35 C75 32 72 30 69 30 C66 30 64 32 64 35 L64 45" />
              <path d="M64 35 C64 32 61 30 58 30 C55 30 53 32 53 35 L53 45" />
              <path d="M53 35 C53 32 50 30 47 30 C44 30 42 32 42 35 L42 50" />
              <path d="M42 42 C42 39 39 37 36 37 C33 37 31 39 31 43 L31 58 C31 68 40 75 50 75" />
              <path d="M79 41 C84 46 84 54 79 59" stroke="#38bdf8" strokeWidth="2.2" />
              <path d="M86 34 C93 43 93 57 86 66" stroke="#22d3ee" strokeWidth="2.4" />
            </svg>
          </div>
        </div>

        <h1 className="text-2xl font-extrabold tracking-tight text-white mb-2">
          {t('onboarding.title')}
        </h1>
        <p className="text-sm text-slate-400 leading-relaxed max-w-[290px] mb-6">
          {t('onboarding.subtitle')}
        </p>

        {/* Essential 3-Row Capabilities */}
        <div className="w-full rounded-2xl bg-[#0c1322] border border-white/[0.08] divide-y divide-white/[0.06] text-left app-card-surface">
          <div className="flex items-center gap-3 px-4 py-3">
            <Video className="w-4 h-4 text-cyan-400 shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-white">{t('onboarding.feat1Title')}</p>
              <p className="text-[11px] text-slate-400 truncate">{t('onboarding.feat1Desc')}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 px-4 py-3">
            <Volume2 className="w-4 h-4 text-cyan-400 shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-white">{t('onboarding.feat2Title')}</p>
              <p className="text-[11px] text-slate-400 truncate">{t('onboarding.feat2Desc')}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 px-4 py-3">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-white">{t('onboarding.feat3Title')}</p>
              <p className="text-[11px] text-slate-400 truncate">{t('onboarding.feat3Desc')}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Primary & Secondary CTAs */}
      <div className="flex flex-col gap-2.5 pt-2">
        <button
          id="btn-get-started"
          onClick={enterAppFromOnboarding}
          className="w-full h-13 rounded-2xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-sm flex items-center justify-center gap-2 shadow-[0_6px_24px_-6px_rgba(6,182,212,0.55)] active:scale-[0.98] transition-all cursor-pointer"
        >
          <span>{t('onboarding.startBtn')}</span>
          <ArrowRight className="w-4 h-4 stroke-[2.5]" />
        </button>

        <button
          id="btn-explore-demo"
          onClick={startDemoSession}
          className="w-full h-12 rounded-2xl bg-[#0c1322] border border-white/[0.08] hover:border-white/15 text-slate-200 font-semibold text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-all cursor-pointer app-card-surface"
        >
          <Play className="w-4 h-4 text-cyan-400 fill-cyan-400" />
          <span>{t('onboarding.demoBtn')}</span>
        </button>
      </div>
    </div>
  );
}
