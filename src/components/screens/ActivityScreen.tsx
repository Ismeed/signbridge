'use client';

import React from 'react';
import { History, ArrowRight, ShieldCheck, HardDrive, Clock, Lock } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { Badge } from '@/components/ui/Badge';

export function ActivityScreen() {
  const { startLiveSession, t } = useApp();

  return (
    <div className="flex flex-col flex-1 px-4 py-4 pb-safe space-y-4 max-w-md mx-auto w-full">
      {/* Screen Title & Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">{t('activity.title')}</h2>
          <p className="text-xs text-slate-400">{t('activity.subtitle')}</p>
        </div>
        <Badge variant="slate" size="sm">
          <Clock className="w-3 h-3 text-slate-400" />
          <span>{t('status.localOnly')}</span>
        </Badge>
      </div>

      {/* Polished Empty State Card */}
      <div className="p-6 sm:p-8 rounded-3xl bg-slate-900/60 border border-white/10 flex flex-col items-center text-center space-y-3.5 my-auto backdrop-blur-md shadow-xl">
        {/* Empty state illustration container */}
        <div className="relative w-20 h-20 rounded-3xl bg-slate-950/80 border border-cyan-500/20 flex items-center justify-center shadow-inner">
          <History className="w-9 h-9 text-cyan-400/60 stroke-[1.5]" />
          <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-cyan-400/40 animate-ping" />
        </div>

        <div className="space-y-1 max-w-[280px]">
          <h3 className="text-sm sm:text-base font-bold text-white">{t('activity.noSessionsTitle')}</h3>
          <p className="text-xs text-slate-400 leading-relaxed">
            {t('activity.noSessionsDesc')}
          </p>
        </div>

        {/* Start Session CTA */}
        <button
          id="btn-activity-launch"
          onClick={startLiveSession}
          className="mt-1 px-5 py-2.5 rounded-2xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs flex items-center gap-2 shadow-[0_0_20px_rgba(6,182,212,0.35)] active:scale-95 transition-all cursor-pointer"
        >
          <span>{t('activity.launchBtn')}</span>
          <ArrowRight className="w-4 h-4 stroke-[2.5]" />
        </button>
      </div>

      {/* Storage & Privacy Architecture */}
      <div className="p-3.5 rounded-2xl bg-slate-900/40 border border-white/5 space-y-2.5 text-xs text-slate-400">
        <p className="font-semibold text-slate-200 flex items-center gap-1.5">
          <HardDrive className="w-4 h-4 text-cyan-400" />
          <span>{t('activity.storageTitle')}</span>
        </p>

        <div className="space-y-2 text-[11px] leading-relaxed">
          <div className="flex items-start gap-2">
            <Lock className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
            <span>
              {t('activity.storagePoint2')}
            </span>
          </div>

          <div className="flex items-start gap-2">
            <ShieldCheck className="w-3.5 h-3.5 text-cyan-400 shrink-0 mt-0.5" />
            <span>
              {t('activity.storagePoint1')}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
