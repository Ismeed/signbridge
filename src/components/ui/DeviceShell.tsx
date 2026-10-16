'use client';

import React, { useState } from 'react';
import { Smartphone, Monitor, Wifi, Battery, Volume2 } from 'lucide-react';

interface DeviceShellProps {
  children: React.ReactNode;
}

export function DeviceShell({ children }: DeviceShellProps) {
  const [deviceMode, setDeviceMode] = useState<'mobile' | 'responsive'>('mobile');

  return (
    <div className="min-h-screen bg-[#040711] text-slate-100 flex flex-col items-center justify-start relative overflow-x-hidden selection:bg-cyan-500/30 selection:text-cyan-200">
      {/* Ambient Backdrop Gradients */}
      <div className="fixed top-[-20%] left-[-10%] w-[600px] h-[600px] rounded-full bg-cyan-600/10 blur-[130px] pointer-events-none" />
      <div className="fixed bottom-[-15%] right-[-10%] w-[600px] h-[600px] rounded-full bg-indigo-600/10 blur-[140px] pointer-events-none" />

      {/* Desktop Innovation Showcase Banner & Viewport Switcher */}
      <aside aria-label="Showcase Controls" className="hidden lg:flex w-full max-w-4xl items-center justify-between py-2.5 px-6 my-2 rounded-2xl bg-slate-900/60 border border-white/5 backdrop-blur-md text-xs text-slate-300 z-50">
        <div className="flex items-center gap-2.5">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
          <span className="font-semibold text-slate-200">
            SignBridge AI
          </span>
          <span className="text-slate-500">•</span>
          <span className="text-cyan-400 font-medium">Assistive Sign Communication Platform</span>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-400 mr-1">Preview:</span>
          <button
            id="btn-preview-mobile"
            onClick={() => setDeviceMode('mobile')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-xl font-medium transition-all cursor-pointer ${
              deviceMode === 'mobile'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                : 'text-slate-400 hover:text-white bg-slate-800/40'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5" />
            <span>Mobile Device (390px)</span>
          </button>
          <button
            id="btn-preview-responsive"
            onClick={() => setDeviceMode('responsive')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-xl font-medium transition-all cursor-pointer ${
              deviceMode === 'responsive'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                : 'text-slate-400 hover:text-white bg-slate-800/40'
            }`}
          >
            <Monitor className="w-3.5 h-3.5" />
            <span>Fluid Responsive</span>
          </button>
        </div>
      </aside>

      {/* Main Container */}
      <div
        className={`w-full transition-all duration-300 relative ${
          deviceMode === 'mobile'
            ? 'max-w-[430px] my-0 lg:my-3 lg:rounded-[42px] lg:border-[8px] lg:border-slate-800/80 lg:shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9),0_0_35px_rgba(6,182,212,0.15)] bg-[#060a14]'
            : 'max-w-2xl bg-[#060a14]'
        }`}
      >
        {/* Mobile Device Simulated Status Bar (Visible on desktop mobile preview) */}
        <div className="hidden lg:flex items-center justify-between px-6 pt-3 pb-1 text-[11px] font-semibold text-slate-400 select-none bg-[#060a14]">
          <span>9:41</span>
          <div className="w-24 h-4 bg-slate-900 rounded-full border border-white/5 mx-auto" />
          <div className="flex items-center gap-1.5">
            <Wifi className="w-3 h-3" />
            <Volume2 className="w-3 h-3" />
            <Battery className="w-3.5 h-3.5" />
          </div>
        </div>

        {/* Child Screen Content */}
        <div className="w-full min-h-[92vh] flex flex-col relative">{children}</div>
      </div>
    </div>
  );
}
