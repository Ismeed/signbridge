'use client';

import React from 'react';
import { Globe, SlidersHorizontal } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { SUPPORTED_LANGUAGES } from '@/lib/translations';
import { SupportedLanguage } from '@/lib/types';

export function AppHeader() {
  const { selectedLanguage, setLanguage, navigateToTab, activeTab } = useApp();

  return (
    <header className="sticky top-0 z-40 w-full backdrop-blur-xl bg-[#060a14]/90 border-b border-cyan-500/15 transition-all">
      <div className="max-w-md mx-auto px-4 h-14 flex items-center justify-between">
        {/* Brand Icon & Name */}
        <div
          id="header-brand-home"
          onClick={() => navigateToTab('home')}
          className="flex items-center gap-2.5 cursor-pointer select-none group"
          role="button"
          tabIndex={0}
          aria-label="SignBridge AI Home"
        >
          <div className="relative w-8 h-8 rounded-xl bg-gradient-to-tr from-cyan-500 to-indigo-600 p-[1.5px] shadow-[0_0_12px_rgba(6,182,212,0.4)] group-hover:shadow-[0_0_18px_rgba(6,182,212,0.6)] transition-all">
            <div className="w-full h-full bg-[#070e1f] rounded-[10px] flex items-center justify-center">
              <span className="text-cyan-400 font-extrabold text-sm leading-none">SB</span>
            </div>
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-cyan-400 rounded-full ring-2 ring-[#060a14] animate-pulse" />
          </div>

          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-sm tracking-tight text-white group-hover:text-cyan-300 transition-colors">
                SignBridge<span className="text-cyan-400 font-extrabold ml-0.5">AI</span>
              </span>
              <span className="text-[9px] uppercase font-semibold tracking-wider px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Live
              </span>
            </div>
            <p className="text-[9px] text-slate-400 font-medium leading-none mt-0.5">
              Nigerian Sign Language AI
            </p>
          </div>
        </div>

        {/* Quick Language Dropdown & Quick Settings */}
        <div className="flex items-center gap-2">
          {/* Language Selector Pill */}
          <div className="relative flex items-center bg-slate-900/90 border border-cyan-500/20 rounded-full px-2 py-1 text-xs text-slate-300 shadow-inner">
            <Globe className="w-3 h-3 text-cyan-400 mr-1.5" />
            <select
              id="select-header-language"
              value={selectedLanguage}
              onChange={(e) => setLanguage(e.target.value as SupportedLanguage)}
              className="bg-transparent text-slate-200 text-xs font-medium focus:outline-none cursor-pointer pr-1"
              aria-label="Output Language"
            >
              {Object.values(SUPPORTED_LANGUAGES).map((lang) => (
                <option key={lang.code} value={lang.code} className="bg-slate-900 text-white">
                  {lang.name} ({lang.code.toUpperCase()})
                </option>
              ))}
            </select>
          </div>

          {/* Quick Settings Shortcut */}
          <button
            id="btn-header-settings"
            onClick={() => navigateToTab('settings')}
            className={`p-1.5 rounded-xl transition-all cursor-pointer ${
              activeTab === 'settings'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                : 'text-slate-400 hover:text-cyan-300 bg-slate-900/60 border border-white/5 hover:border-cyan-500/20'
            }`}
            aria-label="Open Settings"
          >
            <SlidersHorizontal className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
}
