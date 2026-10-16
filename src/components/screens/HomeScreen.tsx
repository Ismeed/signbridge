'use client';

import React from 'react';
import {
  Sparkles,
  Camera,
  Play,
  Languages,
  CheckCircle2,
  Info,
  ShieldCheck,
  ChevronRight,
  Zap,
  Ear,
  MessageSquare,
} from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { SUPPORTED_LANGUAGES } from '@/lib/translations';
import { SupportedLanguage } from '@/lib/types';
import { Badge } from '@/components/ui/Badge';

export function HomeScreen() {
  const {
    selectedLanguage,
    setLanguage,
    startLiveSession,
    startDemoSession,
  } = useApp();

  const currentLangInfo = SUPPORTED_LANGUAGES[selectedLanguage];

  return (
    <div className="flex flex-col flex-1 px-4 py-4 pb-safe space-y-4 max-w-md mx-auto w-full">
      {/* Personalized Greeting Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-1.5 text-xs font-medium text-cyan-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-emerald-400 font-semibold">Live Translation Active</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight mt-0.5">
            {currentLangInfo.greeting}!
          </h2>
          <p className="text-xs text-slate-400">
            Ready to bridge sign language and spoken conversation.
          </p>
        </div>

        {/* Quick Language Badge */}
        <Badge variant="cyan" size="sm">
          <span>{currentLangInfo.name}</span>
        </Badge>
      </div>

      {/* Neural Engine Status Banner */}
      <div className="p-3 rounded-2xl bg-gradient-to-r from-cyan-950/40 via-slate-900/80 to-slate-900/80 border border-cyan-500/20 text-xs text-slate-300 flex items-center justify-between shadow-md">
        <div className="flex items-center gap-2.5">
          <div className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />
          <div className="text-[11px]">
            <span className="font-semibold text-white">Neural Vision Engine: </span>
            <span className="text-slate-400">Ready for high-speed local gesture capture</span>
          </div>
        </div>
        <Badge variant="cyan" size="sm">
          <span>Online</span>
        </Badge>
      </div>

      {/* PROMINENT MAIN CARD: Start Live Session */}
      <div
        id="card-start-live-session"
        onClick={startLiveSession}
        role="button"
        tabIndex={0}
        aria-label="Start Live Session"
        className="relative overflow-hidden p-5 sm:p-6 rounded-3xl bg-gradient-to-br from-[#0c2247] via-[#091b38] to-[#071329] border-2 border-cyan-400/40 shadow-[0_15px_35px_-10px_rgba(6,182,212,0.35)] cursor-pointer group active:scale-[0.98] transition-all"
      >
        {/* Glow corner accent */}
        <div className="absolute top-0 right-0 w-36 h-36 bg-cyan-500/20 rounded-full blur-2xl pointer-events-none group-hover:bg-cyan-400/30 transition-all" />

        <div className="relative z-10 flex flex-col justify-between h-full space-y-3.5">
          <div className="flex items-center justify-between">
            <div className="p-2.5 sm:p-3 rounded-2xl bg-cyan-500 text-slate-950 shadow-[0_0_15px_rgba(6,182,212,0.6)]">
              <Camera className="w-5 h-5 sm:w-6 sm:h-6 stroke-[2.3]" />
            </div>
            <Badge variant="emerald" size="sm">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
              <span>Camera Ready</span>
            </Badge>
          </div>

          <div>
            <h3 className="text-lg sm:text-xl font-black text-white tracking-tight flex items-center gap-1.5">
              <span>Start Live Session</span>
              <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5 text-cyan-400 group-hover:translate-x-1 transition-transform" />
            </h3>
            <p className="text-xs text-slate-300 mt-0.5 max-w-[280px] leading-relaxed">
              Launch the real-time camera interpreter viewport with gesture tracking overlays.
            </p>
          </div>

          <div className="pt-2 flex items-center justify-between text-xs border-t border-white/10">
            <span className="text-cyan-300 font-semibold flex items-center gap-1 text-[11px]">
              <Zap className="w-3.5 h-3.5" />
              Instant Output in {currentLangInfo.name}
            </span>
            <span className="px-3 py-1 rounded-xl bg-cyan-400 text-slate-950 font-bold text-xs shadow-md">
              Launch
            </span>
          </div>
        </div>
      </div>

      {/* SECONDARY CARD: Phrase Translation Studio */}
      <div
        id="card-try-demo"
        onClick={startDemoSession}
        role="button"
        tabIndex={0}
        aria-label="Phrase Translation Studio"
        className="p-3.5 sm:p-4 rounded-2xl bg-slate-900/80 border border-cyan-500/20 hover:border-cyan-500/40 cursor-pointer active:scale-[0.98] transition-all group flex items-center justify-between shadow-lg"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 sm:p-2.5 rounded-xl bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
            <Play className="w-4 h-4 sm:w-5 sm:h-5 fill-indigo-400" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-white group-hover:text-cyan-300 transition-colors flex items-center gap-1">
              <span>Phrase Translation Studio</span>
              <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
            </h4>
            <p className="text-[11px] text-slate-400">
              Select standard Nigerian Sign Language phrases with audio playback
            </p>
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-cyan-400 group-hover:translate-x-0.5 transition-all" />
      </div>

      {/* LANGUAGE OUTPUT SELECTOR */}
      <div className="p-3.5 rounded-2xl bg-slate-900/70 border border-white/10 space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Languages className="w-4 h-4 text-cyan-400" />
            <span className="text-xs font-bold text-white uppercase tracking-wider">
              Spoken Output Language
            </span>
          </div>
          <span className="text-[10px] text-slate-400">5 Nigerian Options</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {Object.values(SUPPORTED_LANGUAGES).map((lang) => {
            const isSelected = selectedLanguage === lang.code;
            return (
              <button
                key={lang.code}
                id={`btn-lang-${lang.code}`}
                onClick={() => setLanguage(lang.code as SupportedLanguage)}
                className={`p-2.5 rounded-xl border text-left flex items-center justify-between transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-cyan-500/15 border-cyan-400 text-white shadow-[0_0_12px_rgba(6,182,212,0.2)]'
                    : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                }`}
                aria-pressed={isSelected}
              >
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold text-white">{lang.name}</span>
                    <span className="text-[9px] font-mono text-cyan-300/80 uppercase">
                      [{lang.code}]
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-400 block truncate">
                    {lang.region}
                  </span>
                </div>
                {isSelected && (
                  <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0 ml-1.5" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Quick Core Capabilities Grid */}
      <div className="grid grid-cols-2 gap-2.5 pt-0.5">
        <div className="p-3 rounded-2xl bg-slate-900/60 border border-white/5 space-y-1">
          <Ear className="w-3.5 h-3.5 text-indigo-400" />
          <p className="text-xs font-semibold text-slate-200">Deaf-to-Hearing</p>
          <p className="text-[10px] text-slate-400 leading-tight">
            Interprets signing hands into audible Nigerian speech.
          </p>
        </div>

        <div className="p-3 rounded-2xl bg-slate-900/60 border border-white/5 space-y-1">
          <MessageSquare className="w-3.5 h-3.5 text-cyan-400" />
          <p className="text-xs font-semibold text-slate-200">Regional Dialect Support</p>
          <p className="text-[10px] text-slate-400 leading-tight">
            Tailored Hausa, Yoruba, Igbo, and Pidgin speech for Nigerian communities.
          </p>
        </div>
      </div>

      {/* Privacy guarantee snippet */}
      <div className="flex items-center justify-center gap-1.5 text-[10px] text-slate-400 pb-1">
        <ShieldCheck className="w-3 h-3 text-cyan-400" />
        <span>Privacy first: Designed for on-device edge processing</span>
      </div>
    </div>
  );
}
