'use client';

import React from 'react';
import clsx from 'clsx';
import { Home, ScanFace, Clock, Settings2 } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { AppTab } from '@/lib/types';

export function BottomNav() {
  const { activeTab, navigateToTab, t } = useApp();

  const tabs: { id: AppTab; label: string; icon: React.ElementType }[] = [
    { id: 'home', label: t('nav.home'), icon: Home },
    { id: 'interpret', label: t('nav.interpret'), icon: ScanFace },
    { id: 'activity', label: t('nav.activity'), icon: Clock },
    { id: 'settings', label: t('nav.settings'), icon: Settings2 },
  ];

  return (
    <nav
      className="shrink-0 z-30 bg-[#080d1a]/95 backdrop-blur-xl border-t border-white/[0.07] pb-[env(safe-area-inset-bottom,0px)]"
      role="navigation"
      aria-label="Main Navigation"
    >
      <div className="px-3 h-16 flex items-center justify-around">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          return (
              <button
                key={tab.id}
                id={`nav-tab-${tab.id}`}
                onClick={() => navigateToTab(tab.id)}
                className={clsx(
                  'relative flex flex-col items-center justify-center flex-1 max-w-[78px] h-12 rounded-2xl transition-colors duration-150 select-none cursor-pointer',
                  isActive
                    ? 'text-cyan-400 bg-cyan-500/10'
                    : 'text-slate-500 hover:text-slate-300'
                )}
                aria-label={tab.label}
                aria-current={isActive ? 'page' : undefined}
              >
                <Icon
                  className={clsx(
                    'w-5 h-5 transition-transform duration-150',
                    isActive ? 'stroke-[2.3] scale-105' : 'stroke-[1.75]'
                  )}
                />
                <span
                  className={clsx(
                    'text-[11px] mt-1 leading-none tracking-tight',
                    isActive ? 'font-semibold' : 'font-medium'
                  )}
                >
                  {tab.label}
                </span>
              </button>
          );
        })}
      </div>
    </nav>
  );
}
