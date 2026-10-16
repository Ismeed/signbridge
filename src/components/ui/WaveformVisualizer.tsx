'use client';

import React from 'react';
import { PlaybackState } from '@/lib/speech';
import { Volume2, VolumeX, Check, AlertCircle } from 'lucide-react';

interface WaveformVisualizerProps {
  playbackState?: PlaybackState;
  isPlaying?: boolean; // backwards compatibility
  reducedMotion?: boolean;
  className?: string;
  barsCount?: number;
}

export function WaveformVisualizer({
  playbackState,
  isPlaying,
  reducedMotion = false,
  className = '',
  barsCount = 12,
}: WaveformVisualizerProps) {
  // Determine canonical playback state
  const state: PlaybackState =
    playbackState || (isPlaying ? 'speaking' : 'ready');

  const isSpeaking = state === 'speaking';

  // Base bar pattern for an organic sound curve
  const staticHeights = [25, 45, 75, 35, 95, 60, 40, 85, 55, 90, 30, 70];

  const getStatusBadge = () => {
    switch (state) {
      case 'speaking':
        return (
          <div className="flex items-center gap-1.5 text-cyan-300 font-mono text-[10px]">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
            <Volume2 className="w-3 h-3 text-cyan-400" />
            <span>Speaking</span>
          </div>
        );
      case 'finished':
        return (
          <div className="flex items-center gap-1.5 text-emerald-400 font-mono text-[10px]">
            <Check className="w-3 h-3" />
            <span>Finished</span>
          </div>
        );
      case 'unavailable':
        return (
          <div className="flex items-center gap-1.5 text-amber-400 font-mono text-[10px]">
            <VolumeX className="w-3 h-3" />
            <span>Audio Unavailable</span>
          </div>
        );
      case 'error':
        return (
          <div className="flex items-center gap-1.5 text-rose-400 font-mono text-[10px]">
            <AlertCircle className="w-3 h-3" />
            <span>Synthesis Error</span>
          </div>
        );
      case 'ready':
      default:
        return (
          <div className="flex items-center gap-1.5 text-slate-400 font-mono text-[10px]">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
            <span>Audio Ready</span>
          </div>
        );
    }
  };

  return (
    <div
      className={`flex items-center justify-between gap-3 h-11 px-3 py-1.5 rounded-2xl bg-slate-950/70 border border-cyan-500/20 backdrop-blur-md select-none ${className}`}
      aria-label={`Audio waveform status: ${state}`}
      role="region"
    >
      {/* Real-time Status Indicator */}
      <div className="shrink-0">{getStatusBadge()}</div>

      {/* Dynamic Soundwave Bars */}
      <div
        className="flex items-center gap-1 h-full flex-1 justify-end max-w-[140px]"
        aria-hidden="true"
      >
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
                    ? `${heightPercent * 0.8}%`
                    : undefined
                  : `${Math.max(15, heightPercent * 0.3)}%`,
                backgroundColor: isSpeaking
                  ? '#00f2fe'
                  : state === 'finished'
                  ? '#10b981'
                  : '#334155',
                boxShadow:
                  isSpeaking && !reducedMotion
                    ? '0 0 8px rgba(0, 242, 254, 0.7)'
                    : 'none',
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
