'use client';

import React, { useState, useEffect } from 'react';
import clsx from 'clsx';
import { Clock, ArrowRight, Volume2, VolumeX, Trash2 } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { SUPPORTED_LANGUAGES } from '@/lib/translations';
import { SpeechService, triggerHaptic } from '@/lib/speech';
import { ActivityItem } from '@/lib/types';

function formatRelativeTime(timestamp: number, justNowLabel: string): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diffSec < 60) return justNowLabel;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

export function ActivityScreen() {
  const {
    activityHistory,
    removeActivityItem,
    clearActivity,
    startLiveSession,
    preferences,
    t,
  } = useApp();

  const [speakingItemId, setSpeakingItemId] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      SpeechService.stop();
    };
  }, []);

  const handleTogglePlay = (item: ActivityItem) => {
    if (speakingItemId === item.id) {
      SpeechService.stop();
      setSpeakingItemId(null);
      return;
    }

    SpeechService.unlockAudio();
    setSpeakingItemId(item.id);
    triggerHaptic('light', preferences.hapticsEnabled);

    SpeechService.speak(item.translatedText, item.language, {
      onStart: () => setSpeakingItemId(item.id),
      onEnd: () => setSpeakingItemId((prev) => (prev === item.id ? null : prev)),
      onError: () => setSpeakingItemId((prev) => (prev === item.id ? null : prev)),
    });
  };

  return (
    <div className="flex flex-col flex-1 px-4 py-5 space-y-4 max-w-md mx-auto w-full">
      {/* Minimal Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-extrabold text-white tracking-tight">
            {t('activity.title')}
          </h1>
          <p className="text-xs text-slate-400">{t('activity.subtitle')}</p>
        </div>

        {activityHistory.length > 0 && (
          <button
            id="btn-clear-activity"
            onClick={() => {
              SpeechService.stop();
              setSpeakingItemId(null);
              clearActivity();
            }}
            className="px-3 py-1.5 rounded-full bg-slate-900 border border-white/[0.08] hover:border-white/20 text-xs font-semibold text-slate-300 hover:text-white transition-colors cursor-pointer"
          >
            {t('activity.clear')}
          </button>
        )}
      </div>

      {/* Empty State or Activity Feed */}
      {activityHistory.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-4 py-12 space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-[#0c1322] border border-white/[0.08] flex items-center justify-center app-card-surface">
            <Clock className="w-7 h-7 text-slate-400 stroke-[1.6]" />
          </div>

          <div className="space-y-1 max-w-[240px]">
            <h2 className="text-base font-bold text-white">
              {t('activity.noSessionsTitle')}
            </h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              {t('activity.noSessionsDesc')}
            </p>
          </div>

          <button
            id="btn-activity-launch"
            onClick={startLiveSession}
            className="mt-1 px-5 h-11 rounded-2xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs flex items-center gap-2 shadow-[0_4px_18px_-4px_rgba(6,182,212,0.45)] active:scale-95 transition-all cursor-pointer"
          >
            <span>{t('activity.launchBtn')}</span>
            <ArrowRight className="w-4 h-4 stroke-[2.4]" />
          </button>
        </div>
      ) : (
        <div className="space-y-2.5 pb-2">
          {activityHistory.map((item) => {
            const isSpeaking = speakingItemId === item.id;
            const langInfo = SUPPORTED_LANGUAGES[item.language];

            return (
              <div
                key={item.id}
                className="p-3.5 rounded-2xl bg-[#0c1322] border border-white/[0.08] space-y-2.5 app-card-surface"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-semibold text-white truncate">
                      {item.signConcept}
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-[10px] font-semibold text-cyan-300 shrink-0">
                      {langInfo?.name || item.language}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-500 shrink-0">
                    {formatRelativeTime(item.timestamp, t('activity.justNow'))}
                  </span>
                </div>

                <p className="text-sm font-medium text-slate-100 leading-snug">
                  {item.translatedText}
                </p>

                <div className="flex items-center justify-between pt-1">
                  <button
                    onClick={() => handleTogglePlay(item)}
                    className={clsx(
                      'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all active:scale-95 cursor-pointer',
                      isSpeaking
                        ? 'bg-rose-500/20 border border-rose-500/40 text-rose-300'
                        : 'bg-cyan-500/15 border border-cyan-400/30 text-cyan-300 hover:bg-cyan-500/25'
                    )}
                  >
                    {isSpeaking ? (
                      <>
                        <VolumeX className="w-3.5 h-3.5" />
                        <span>{t('interpret.stopVoice')}</span>
                      </>
                    ) : (
                      <>
                        <Volume2 className="w-3.5 h-3.5" />
                        <span>{t('interpret.playVoice')}</span>
                      </>
                    )}
                  </button>

                  <button
                    onClick={() => {
                      if (isSpeaking) {
                        SpeechService.stop();
                        setSpeakingItemId(null);
                      }
                      removeActivityItem(item.id);
                    }}
                    className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-white/[0.04] transition-colors cursor-pointer"
                    aria-label="Remove item"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
