'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { ActiveScreen, AppTab, SupportedLanguage, UserPreferences } from '@/lib/types';
import { triggerHaptic } from '@/lib/speech';

interface AppContextType {
  activeScreen: ActiveScreen;
  activeTab: AppTab;
  selectedLanguage: SupportedLanguage;
  preferences: UserPreferences;
  demoModeAutoStart: boolean;
  navigateToTab: (tab: AppTab) => void;
  startLiveSession: () => void;
  startDemoSession: () => void;
  enterAppFromOnboarding: () => void;
  goToOnboarding: () => void;
  setLanguage: (lang: SupportedLanguage) => void;
  updatePreferences: (updates: Partial<UserPreferences>) => void;
  consumeDemoAutoStart: () => void;
}

const defaultPreferences: UserPreferences = {
  language: 'ha', // Default to Hausa
  hapticsEnabled: true,
  reducedMotion: false,
  highContrast: false,
  fontSize: 'normal',
  cameraPermissionConsent: false,
};

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [activeScreen, setActiveScreen] = useState<ActiveScreen>('onboarding');
  const [activeTab, setActiveTab] = useState<AppTab>('home');
  const [selectedLanguage, setSelectedLanguageState] = useState<SupportedLanguage>('ha');
  const [preferences, setPreferences] = useState<UserPreferences>(defaultPreferences);
  const [demoModeAutoStart, setDemoModeAutoStart] = useState<boolean>(false);

  // Hydrate preferences and language from localStorage on client load
  useEffect(() => {
    try {
      const savedLang = localStorage.getItem('signbridge_lang') as SupportedLanguage;
      if (savedLang && ['en', 'ha', 'yo', 'ig', 'pcm'].includes(savedLang)) {
        setSelectedLanguageState(savedLang);
      }
      const savedPrefs = localStorage.getItem('signbridge_prefs');
      if (savedPrefs) {
        const parsed = JSON.parse(savedPrefs);
        setPreferences((prev) => ({ ...prev, ...parsed }));
      }
      // Check system reduced motion
      const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (prefersReduced) {
        setPreferences((prev) => ({ ...prev, reducedMotion: true }));
      }
    } catch {
      // Ignore storage errors in restrictive environments
    }
  }, []);

  // Update HTML class for reduced motion and high contrast
  useEffect(() => {
    if (typeof document !== 'undefined') {
      const root = document.documentElement;
      if (preferences.reducedMotion) {
        root.classList.add('reduced-motion');
      } else {
        root.classList.remove('reduced-motion');
      }

      if (preferences.highContrast) {
        root.classList.add('high-contrast');
      } else {
        root.classList.remove('high-contrast');
      }

      root.dataset.fontSize = preferences.fontSize;
    }
  }, [preferences.reducedMotion, preferences.highContrast, preferences.fontSize]);

  const setLanguage = (lang: SupportedLanguage) => {
    setSelectedLanguageState(lang);
    setPreferences((prev) => ({ ...prev, language: lang }));
    try {
      localStorage.setItem('signbridge_lang', lang);
    } catch {
      // Storage safe
    }
    triggerHaptic('light', preferences.hapticsEnabled);
  };

  const updatePreferences = (updates: Partial<UserPreferences>) => {
    setPreferences((prev) => {
      const next = { ...prev, ...updates };
      try {
        localStorage.setItem('signbridge_prefs', JSON.stringify(next));
      } catch {
        // Storage safe
      }
      return next;
    });
    triggerHaptic('light', preferences.hapticsEnabled);
  };

  const navigateToTab = (tab: AppTab) => {
    setActiveTab(tab);
    triggerHaptic('light', preferences.hapticsEnabled);
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: preferences.reducedMotion ? 'auto' : 'smooth' });
    }
  };

  const enterAppFromOnboarding = () => {
    setActiveScreen('app');
    setActiveTab('home');
    triggerHaptic('medium', preferences.hapticsEnabled);
  };

  const startLiveSession = () => {
    setActiveScreen('app');
    setActiveTab('interpret');
    setDemoModeAutoStart(false);
    triggerHaptic('medium', preferences.hapticsEnabled);
  };

  const startDemoSession = () => {
    setActiveScreen('app');
    setActiveTab('interpret');
    setDemoModeAutoStart(true);
    triggerHaptic('medium', preferences.hapticsEnabled);
  };

  const goToOnboarding = () => {
    setActiveScreen('onboarding');
    triggerHaptic('light', preferences.hapticsEnabled);
  };

  const consumeDemoAutoStart = () => {
    setDemoModeAutoStart(false);
  };

  return (
    <AppContext.Provider
      value={{
        activeScreen,
        activeTab,
        selectedLanguage,
        preferences,
        demoModeAutoStart,
        navigateToTab,
        startLiveSession,
        startDemoSession,
        enterAppFromOnboarding,
        goToOnboarding,
        setLanguage,
        updatePreferences,
        consumeDemoAutoStart,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}
