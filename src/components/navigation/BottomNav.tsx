'use client';

import React from 'react';
import { Home, ScanFace, History, Settings2 } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { AppTab } from '@/lib/types';

export function BottomNav() {
  const { activeTab, navigateToTab } = useApp();

  const tabs: { id: AppTab; label: string; icon: React.ElementType }[] = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'interpret', label: 'Interpret', icon: ScanFace },
    { id: 'activity', label: 'Activity', icon: History },
    { id: 'settings', label: 'Settings', icon: Settings2 },
  ];

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-40 bg-[#070d1e]/95 backdrop-blur-2xl border-t border-cyan-500/20 shadow-[0_-10px_25px_-5px_rgba(0,0,0,0.7)]"
      role="navigation"
      aria-label="Main Navigation"
    >
      <div className="max-w-md mx-auto px-4 h-16 flex items-center justify-around">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              id={`nav-tab-${tab.id}`}
              onClick={() => navigateToTab(tab.id)}
              className={`relative flex flex-col items-center justify-center w-16 h-13 rounded-2xl transition-all duration-200 select-none cursor-pointer ${
                isActive
                  ? 'text-cyan-400 font-semibold'
                  : 'text-slate-400 hover:text-slate-200 font-normal'
              }`}
              aria-label={tab.label}
              aria-current={isActive ? 'page' : undefined}
            >
              {/* Highlight background pill for active tab */}
              {isActive && (
                <div className="absolute inset-0 bg-cyan-500/10 rounded-2xl border border-cyan-500/30 shadow-[0_0_12px_rgba(6,182,212,0.25)] transition-all" />
              )}

              <div className="relative z-10 flex flex-col items-center">
                <Icon
                  className={`w-5 h-5 transition-transform duration-200 ${
                    isActive ? 'scale-110 stroke-[2.4]' : 'scale-100 stroke-[1.8]'
                  }`}
                />
                <span className="text-[11px] mt-0.5 tracking-tight">{tab.label}</span>
              </div>

              {/* Glowing active indicator dot */}
              {isActive && (
                <span className="absolute -bottom-1 w-1.5 h-1.5 rounded-full bg-cyan-400 shadow-[0_0_6px_#00f2fe]" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
