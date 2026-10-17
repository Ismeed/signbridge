'use client';

import React from 'react';
import { ArrowRight, Sparkles, Video, Volume2, Shield, Eye } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { Badge } from '@/components/ui/Badge';

export function OnboardingScreen() {
  const { enterAppFromOnboarding, startDemoSession, t } = useApp();

  return (
    <div className="flex flex-col min-h-screen sm:min-h-0 justify-between px-5 py-5 max-w-md mx-auto w-full select-none">
      {/* Top Header Badge */}
      <div className="flex items-center justify-between">
        <Badge variant="cyan" size="sm">
          <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
          <span>{t('onboarding.badge')}</span>
        </Badge>
        <span className="text-[10px] font-mono text-emerald-400 uppercase tracking-widest bg-emerald-950/40 px-2.5 py-0.5 rounded-full border border-emerald-500/20 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          {t('status.systemActive')}
        </span>
      </div>

      {/* Hero Content & Illustration */}
      <div className="py-4 my-auto flex flex-col items-center text-center">
        {/* Brand Hero Graphic: Human Connection + Vision AI + Spoken Bridge */}
        <div className="relative w-40 h-40 sm:w-44 sm:h-44 mb-4 flex items-center justify-center">
          {/* Luminous concentric background circles */}
          <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-cyan-500/15 via-indigo-600/15 to-transparent blur-xl" />
          <div className="absolute inset-2 rounded-full border border-cyan-500/25 animate-radar" />
          <div className="absolute inset-6 rounded-full border border-indigo-400/20" />

          {/* Central Glass Disc */}
          <div className="relative w-28 h-28 sm:w-32 sm:h-32 rounded-3xl bg-[#091228]/85 border border-cyan-400/30 backdrop-blur-xl flex flex-col items-center justify-center shadow-[0_0_25px_rgba(6,182,212,0.3)] p-3">
            {/* SVG Connecting Sign Hand and Audio Wave */}
            <svg
              viewBox="0 0 100 100"
              className="w-16 h-16 sm:w-18 sm:h-18 text-cyan-400 drop-shadow-[0_0_10px_rgba(6,182,212,0.6)]"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M35 65 C35 75 45 80 55 80 C68 80 75 70 75 55 L75 35 C75 32 72 30 69 30 C66 30 64 32 64 35 L64 45" />
              <path d="M64 35 C64 32 61 30 58 30 C55 30 53 32 53 35 L53 45" />
              <path d="M53 35 C53 32 50 30 47 30 C44 30 42 32 42 35 L42 50" />
              <path d="M42 42 C42 39 39 37 36 37 C33 37 31 39 31 43 L31 58 C31 68 40 75 50 75" />
              <path d="M78 40 C84 45 84 55 78 60" stroke="#38bdf8" strokeWidth="2" strokeDasharray="2 2" />
              <path d="M84 32 C93 42 93 58 84 68" stroke="#00f2fe" strokeWidth="2.2" />
            </svg>

            <div className="flex items-center gap-1 mt-0.5 text-[8px] font-mono text-cyan-300">
              <Sparkles className="w-2.5 h-2.5" />
              <span>NSL BRIDGE</span>
            </div>
          </div>

          {/* Floating Feature Satellites */}
          <div className="absolute top-0 right-0 bg-slate-900/95 border border-cyan-500/30 px-2 py-0.5 rounded-full text-[10px] text-cyan-300 shadow-lg flex items-center gap-1">
            <Video className="w-3 h-3 text-cyan-400" />
            <span>Camera Vision</span>
          </div>
          <div className="absolute bottom-0 left-0 bg-slate-900/95 border border-indigo-500/30 px-2 py-0.5 rounded-full text-[10px] text-indigo-300 shadow-lg flex items-center gap-1">
            <Volume2 className="w-3 h-3 text-indigo-400" />
            <span>Spoken Voice</span>
          </div>
        </div>

        {/* Brand Name & Tagline */}
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white mb-1.5">
          SignBridge <span className="text-cyan-400">AI</span>
        </h1>
        <p className="text-xs sm:text-sm text-slate-300 font-medium max-w-xs mb-3">
          {t('onboarding.subtitle')}
        </p>

        {/* Feature explanation card */}
        <div className="p-3.5 rounded-2xl bg-slate-900/70 border border-cyan-500/15 text-left text-xs space-y-2 max-w-sm w-full my-1 backdrop-blur-md">
          <div className="flex items-start gap-2.5">
            <div className="p-1 rounded-lg bg-cyan-500/10 text-cyan-400 shrink-0 mt-0.5">
              <Eye className="w-3.5 h-3.5" />
            </div>
            <div>
              <p className="font-semibold text-slate-200 text-xs">{t('onboarding.feat1Title')}</p>
              <p className="text-slate-400 text-[11px] leading-snug">
                {t('onboarding.feat1Desc')}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2.5">
            <div className="p-1 rounded-lg bg-indigo-500/10 text-indigo-400 shrink-0 mt-0.5">
              <Volume2 className="w-3.5 h-3.5" />
            </div>
            <div>
              <p className="font-semibold text-slate-200 text-xs">{t('onboarding.feat2Title')}</p>
              <p className="text-slate-400 text-[11px] leading-snug">
                {t('onboarding.feat2Desc')}
              </p>
            </div>
          </div>
        </div>

        {/* Privacy & Engine Notice */}
        <div className="flex items-center gap-2 text-[10px] text-slate-400 max-w-xs mt-2 bg-slate-950/50 px-3 py-1.5 rounded-xl border border-white/5">
          <Shield className="w-3 h-3 text-cyan-400 shrink-0" />
          <span>{t('onboarding.feat3Desc')}</span>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-col gap-2.5 pt-2">
        <button
          id="btn-get-started"
          onClick={enterAppFromOnboarding}
          className="w-full h-13 rounded-2xl bg-gradient-to-r from-cyan-500 to-cyan-400 hover:from-cyan-400 hover:to-cyan-300 text-slate-950 font-bold text-sm sm:text-base flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(6,182,212,0.4)] active:scale-[0.98] transition-all cursor-pointer"
        >
          <span>{t('onboarding.startBtn')}</span>
          <ArrowRight className="w-4 h-4 stroke-[2.5]" />
        </button>

        <button
          id="btn-explore-demo"
          onClick={startDemoSession}
          className="w-full h-11 rounded-2xl bg-slate-900/90 border border-cyan-500/30 hover:border-cyan-400 text-cyan-300 font-semibold text-xs sm:text-sm flex items-center justify-center gap-2 hover:bg-slate-800 active:scale-[0.98] transition-all cursor-pointer"
        >
          <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
          <span>{t('onboarding.demoBtn')}</span>
        </button>
      </div>
    </div>
  );
}
