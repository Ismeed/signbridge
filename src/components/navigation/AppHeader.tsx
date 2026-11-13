'use client';

import React from 'react';
import { Globe, ChevronDown } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { SUPPORTED_LANGUAGES } from '@/lib/translations';
import { SupportedLanguage } from '@/lib/types';

export function AppHeader() {
  const { selectedLanguage, setLanguage, navigateToTab, activeTab, t } = useApp();

  const headerTitle =
    activeTab === 'home'
      ? 'SignBridge'
      : activeTab === 'interpret'
      ? t('nav.interpret')
      : activeTab === 'activity'
      ? t('nav.activity')
      : t('nav.settings');

  return (
    <header className="shrink-0 z-30 w-full bg-[#060913]/90 backdrop-blur-xl border-b border-white/[0.06] pt-[env(safe-area-inset-top,0px)]">
      <div className="px-4 h-13 flex items-center justify-between">
        {/* Brand Emblem + Current Section */}
        <button
          id="header-brand-home"
          onClick={() => navigateToTab('home')}
          className="flex items-center gap-2.5 cursor-pointer select-none group text-left"
          aria-label="SignBridge AI Home"
        >
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-cyan-400 to-cyan-600 flex items-center justify-center shadow-[0_2px_10px_rgba(6,182,212,0.3)] shrink-0">
            <span className="text-slate-950 font-black text-xs tracking-tight">SB</span>
          </div>
          <span className="font-bold text-[15px] tracking-tight text-white">
            {headerTitle}
            {activeTab === 'home' && <span className="text-cyan-400 font-extrabold ml-1">AI</span>}
          </span>
        </button>

        {/* Compact Output Language Selector */}
        <div className="relative flex items-center bg-slate-900/90 border border-white/[0.08] hover:border-cyan-500/30 rounded-full pl-2.5 pr-2 py-1.5 transition-colors">
          <Globe className="w-3.5 h-3.5 text-cyan-400 mr-1.5 shrink-0 pointer-events-none" />
          <select
            id="select-header-language"
            value={selectedLanguage}
            onChange={(e) => setLanguage(e.target.value as SupportedLanguage)}
            className="appearance-none bg-transparent text-slate-100 text-xs font-semibold focus:outline-none cursor-pointer pr-4"
            aria-label="Output Language"
          >
            {Object.values(SUPPORTED_LANGUAGES).map((lang) => (
              <option key={lang.code} value={lang.code} className="bg-slate-950 text-white">
                {lang.name}
              </option>
            ))}
          </select>
          <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2 pointer-events-none" />
        </div>
      </div>
    </header>
  );
}
