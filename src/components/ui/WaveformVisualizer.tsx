'use client';

import React from 'react';
import clsx from 'clsx';
import { PlaybackState } from '@/lib/speech';
import { Volume2, VolumeX, Check, AlertCircle } from 'lucide-react';

interface WaveformVisualizerProps {
  playbackState?: PlaybackState;
  isPlaying?: boolean;
  reducedMotion?: boolean;
  className?: string;
  barsCount?: number;
}

export function WaveformVisualizer({
  playbackState,
  isPlaying,
  reducedMotion = false,
  className,
  barsCount = 10,
}: WaveformVisualizerProps) {
  const state: PlaybackState = playbackState || (isPlaying ? 'speaking' : 'ready');
  const isSpeaking = state === 'speaking';
  const staticHeights = [30, 55, 80, 45, 95, 65, 40, 85, 50, 75];

  const getStatusIndicator = () => {
    switch (state) {
      case 'speaking':
        return (
          <div className="flex items-center gap-1.5 text-cyan-300 text-[11px] font-medium">
            <Volume2 className="w-3.5 h-3.5 text-cyan-400" />
            <span>Speaking</span>
          </div>
        );
      case 'finished':
        return (
          <div className="flex items-center gap-1.5 text-emerald-400 text-[11px] font-medium">
            <Check className="w-3.5 h-3.5" />
            <span>Played</span>
          </div>
        );
      case 'unavailable':
        return (
          <div className="flex items-center gap-1.5 text-amber-400 text-[11px] font-medium">
            <VolumeX className="w-3.5 h-3.5" />
            <span>Unavailable</span>
          </div>
        );
      case 'error':
        return (
          <div className="flex items-center gap-1.5 text-rose-400 text-[11px] font-medium">
            <AlertCircle className="w-3.5 h-3.5" />
            <span>Error</span>
          </div>
        );
      case 'ready':
      default:
        return (
          <div className="flex items-center gap-1.5 text-slate-400 text-[11px] font-medium">
            <Volume2 className="w-3.5 h-3.5 text-slate-500" />
            <span>Audio</span>
          </div>
        );
    }
  };

  return (
    <div
      className={clsx(
        'flex items-center justify-between gap-2 h-10 px-3 rounded-xl bg-slate-950/60 border border-white/[0.06] select-none',
        className
      )}
      aria-label={`Audio waveform status: ${state}`}
      role="region"
    >
      <div className="shrink-0">{getStatusIndicator()}</div>

      <div className="flex items-center gap-1 h-full flex-1 justify-end max-w-[110px]" aria-hidden="true">
        {Array.from({ length: barsCount }).map((_, i) => {
          const heightPercent = staticHeights[i % staticHeights.length];
          const delay = (i * 0.07).toFixed(2);
          const duration = (0.65 + (i % 3) * 0.15).toFixed(2);

          return (
            <div
              key={i}
              className="w-1 rounded-full transition-all duration-200"
              style={{
                height: isSpeaking
                  ? reducedMotion
                    ? `${heightPercent * 0.7}%`
                    : undefined
                  : `${Math.max(18, heightPercent * 0.28)}%`,
                backgroundColor: isSpeaking
                  ? '#22d3ee'
                  : state === 'finished'
                  ? '#10b981'
                  : '#334155',
                animation:
                  isSpeaking && !reducedMotion
                    ? `wave-bar ${duration}s ease-in-out infinite ${delay}s`
                    : 'none',
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
