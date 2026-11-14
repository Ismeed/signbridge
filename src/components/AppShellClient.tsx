'use client';

import React from 'react';
import { AppProvider, useApp } from '@/context/AppContext';
import { DeviceShell } from '@/components/ui/DeviceShell';
import { AppHeader } from '@/components/navigation/AppHeader';
import { BottomNav } from '@/components/navigation/BottomNav';
import { OnboardingScreen } from '@/components/screens/OnboardingScreen';
import { HomeScreen } from '@/components/screens/HomeScreen';
import { InterpretScreen } from '@/components/screens/InterpretScreen';
import { ActivityScreen } from '@/components/screens/ActivityScreen';
import { SettingsScreen } from '@/components/screens/SettingsScreen';
import { NslCollectStudio } from '@/components/collect/NslCollectStudio';

function MainAppContent() {
  const { activeScreen, activeTab } = useApp();

  return (
    <div className="flex flex-col h-full w-full overflow-hidden relative">
      {activeScreen === 'onboarding' ? (
        <div className="flex-1 overflow-y-auto no-scrollbar overscroll-contain">
          <OnboardingScreen />
        </div>
      ) : (
        <>
          <AppHeader />
          <main
            id="app-main-scroll"
            className="flex-1 overflow-y-auto no-scrollbar overscroll-contain flex flex-col"
          >
            {activeTab === 'home' && <HomeScreen />}
            {activeTab === 'interpret' && <InterpretScreen />}
            {activeTab === 'activity' && <ActivityScreen />}
            {activeTab === 'settings' && <SettingsScreen />}
          </main>
          <BottomNav />
        </>
      )}
    </div>
  );
}

export function MainAppClient() {
  return (
    <AppProvider>
      <DeviceShell>
        <MainAppContent />
      </DeviceShell>
    </AppProvider>
  );
}

export function CollectStudioClient({ standalone = false }: { standalone?: boolean }) {
  return (
    <AppProvider>
      <NslCollectStudio standalone={standalone} />
    </AppProvider>
  );
}
