'use client';

import React, { useState } from 'react';
import clsx from 'clsx';
import { Smartphone, Monitor } from 'lucide-react';

interface DeviceShellProps {
  children: React.ReactNode;
}

export function DeviceShell({ children }: DeviceShellProps) {
  const [deviceMode, setDeviceMode] = useState<'mobile' | 'responsive'>('mobile');

  return (
    <div className="min-h-[100dvh] w-full bg-[#060913] lg:bg-[#03050b] text-slate-100 flex flex-col items-center justify-center relative overflow-hidden">
      {/* Subtle Ambient Backdrop on Desktop */}
      <div className="hidden lg:block fixed top-[-20%] left-[-10%] w-[520px] h-[520px] rounded-full bg-cyan-500/[0.06] blur-[140px] pointer-events-none" />
      <div className="hidden lg:block fixed bottom-[-20%] right-[-10%] w-[520px] h-[520px] rounded-full bg-indigo-500/[0.06] blur-[140px] pointer-events-none" />

      {/* Unobtrusive Desktop Frame Switcher */}
      <div className="hidden lg:flex fixed top-4 right-4 z-50 items-center gap-1 p-1 rounded-full bg-slate-900/80 border border-white/[0.08] backdrop-blur-md">
        <button
          id="btn-preview-mobile"
          onClick={() => setDeviceMode('mobile')}
          className={clsx(
            'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors cursor-pointer',
            deviceMode === 'mobile'
              ? 'bg-white/10 text-white'
              : 'text-slate-400 hover:text-slate-200'
          )}
          aria-label="Mobile view"
        >
          <Smartphone className="w-3.5 h-3.5" />
          <span>Mobile</span>
        </button>
        <button
          id="btn-preview-responsive"
          onClick={() => setDeviceMode('responsive')}
          className={clsx(
            'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors cursor-pointer',
            deviceMode === 'responsive'
              ? 'bg-white/10 text-white'
              : 'text-slate-400 hover:text-slate-200'
          )}
          aria-label="Wide view"
        >
          <Monitor className="w-3.5 h-3.5" />
          <span>Wide</span>
        </button>
      </div>

      {/* App Shell Viewport */}
      <div
        className={clsx(
          'w-full h-[100dvh] flex flex-col relative overflow-hidden bg-[#060913] app-shell-surface transition-all duration-300',
          deviceMode === 'mobile'
            ? 'lg:max-w-[408px] lg:h-[min(860px,calc(100dvh-2.5rem))] lg:rounded-[40px] lg:border-[6px] lg:border-slate-800/85 lg:shadow-[0_30px_80px_-20px_rgba(0,0,0,0.95)]'
            : 'lg:max-w-2xl lg:h-[min(860px,calc(100dvh-2.5rem))] lg:rounded-[28px] lg:border lg:border-white/10 lg:shadow-2xl'
        )}
      >
        {children}
      </div>
    </div>
  );
}
