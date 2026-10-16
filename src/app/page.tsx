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

function MainAppContent() {
  const { activeScreen, activeTab } = useApp();

  return (
    <div className="flex flex-col min-h-screen relative w-full overflow-x-hidden">
      {activeScreen === 'onboarding' ? (
        <OnboardingScreen />
      ) : (
        <>
          <AppHeader />
          <main className="flex-1 flex flex-col w-full">
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

export default function Page() {
  return (
    <AppProvider>
      <DeviceShell>
        <MainAppContent />
      </DeviceShell>
    </AppProvider>
  );
}
