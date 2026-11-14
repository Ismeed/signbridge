'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  ActiveScreen,
  ActivityItem,
  AppTab,
  SupportedLanguage,
  UserPreferences,
} from '@/lib/types';
import { SpeechService, triggerHaptic } from '@/lib/speech';
import { LOCALES } from '@/lib/locales';

interface AppContextType {
  activeScreen: ActiveScreen;
  activeTab: AppTab;
  selectedLanguage: SupportedLanguage;
  preferences: UserPreferences;
  demoModeAutoStart: boolean;
  activityHistory: ActivityItem[];
  t: (key: string) => string;
  navigateToTab: (tab: AppTab) => void;
  startLiveSession: () => void;
  startDemoSession: () => void;
  enterAppFromOnboarding: () => void;
  goToOnboarding: () => void;
  setLanguage: (lang: SupportedLanguage) => void;
  updatePreferences: (updates: Partial<UserPreferences>) => void;
  consumeDemoAutoStart: () => void;
  addActivityItem: (item: Omit<ActivityItem, 'id' | 'timestamp'>) => void;
  removeActivityItem: (id: string) => void;
  clearActivity: () => void;
}

const defaultPreferences: UserPreferences = {
  language: 'ha',
  hapticsEnabled: true,
  reducedMotion: false,
  highContrast: false,
  fontSize: 'normal',
  cameraPermissionConsent: false,
};

const AppContext = createContext<AppContextType | undefined>(undefined);

const MAX_ACTIVITY_ITEMS = 50;

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [activeScreen, setActiveScreen] = useState<ActiveScreen>('onboarding');
  const [activeTab, setActiveTab] = useState<AppTab>('home');
  const [selectedLanguage, setSelectedLanguageState] = useState<SupportedLanguage>('ha');
  const [preferences, setPreferences] = useState<UserPreferences>(defaultPreferences);
  const [demoModeAutoStart, setDemoModeAutoStart] = useState<boolean>(false);
  const [activityHistory, setActivityHistory] = useState<ActivityItem[]>([]);

  // Hydrate persisted state on client mount
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const hasOnboarded = localStorage.getItem('signbridge_onboarded');
        if (hasOnboarded === 'true') {
          setActiveScreen('app');
        }

        const savedLang = localStorage.getItem('signbridge_lang') as SupportedLanguage;
        if (savedLang && ['en', 'ha', 'yo', 'ig', 'pcm'].includes(savedLang)) {
          setSelectedLanguageState(savedLang);
        }

        const savedPrefs = localStorage.getItem('signbridge_prefs');
        if (savedPrefs) {
          const parsed = JSON.parse(savedPrefs);
          setPreferences((prev) => ({ ...prev, ...parsed }));
        }

        const savedActivity = localStorage.getItem('signbridge_activity');
        if (savedActivity) {
          const parsedActivity = JSON.parse(savedActivity);
          if (Array.isArray(parsedActivity)) {
            setActivityHistory(parsedActivity.slice(0, MAX_ACTIVITY_ITEMS));
          }
        }

        const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (prefersReduced) {
          setPreferences((prev) => ({ ...prev, reducedMotion: true }));
        }
      } catch {
        // Ignore storage errors in restrictive environments
      }
    }, 0);

    return () => clearTimeout(timer);
  }, []);

  // Sync accessibility classes & font scale on document root
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

  const persistActivity = useCallback((items: ActivityItem[]) => {
    try {
      localStorage.setItem('signbridge_activity', JSON.stringify(items));
    } catch {
      // Storage safe
    }
  }, []);

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

  const scrollMainToTop = useCallback(() => {
    if (typeof document !== 'undefined') {
      const mainEl = document.getElementById('app-main-scroll');
      if (mainEl) {
        mainEl.scrollTo({
          top: 0,
          behavior: preferences.reducedMotion ? 'auto' : 'smooth',
        });
      }
    }
  }, [preferences.reducedMotion]);

  const navigateToTab = (tab: AppTab) => {
    setActiveTab(tab);
    triggerHaptic('light', preferences.hapticsEnabled);
    scrollMainToTop();
  };

  const markOnboarded = () => {
    try {
      localStorage.setItem('signbridge_onboarded', 'true');
    } catch {
      // Storage safe
    }
  };

  const enterAppFromOnboarding = () => {
    SpeechService.unlockAudio();
    markOnboarded();
    setActiveScreen('app');
    setActiveTab('home');
    triggerHaptic('medium', preferences.hapticsEnabled);
  };

  const startLiveSession = () => {
    SpeechService.unlockAudio();
    markOnboarded();
    setActiveScreen('app');
    setActiveTab('interpret');
    setDemoModeAutoStart(false);
    triggerHaptic('medium', preferences.hapticsEnabled);
    scrollMainToTop();
  };

  const startDemoSession = () => {
    SpeechService.unlockAudio();
    markOnboarded();
    setActiveScreen('app');
    setActiveTab('interpret');
    setDemoModeAutoStart(true);
    triggerHaptic('medium', preferences.hapticsEnabled);
    scrollMainToTop();
  };

  const goToOnboarding = () => {
    setActiveScreen('onboarding');
    triggerHaptic('light', preferences.hapticsEnabled);
  };

  const consumeDemoAutoStart = useCallback(() => {
    setDemoModeAutoStart(false);
  }, []);

  const addActivityItem = useCallback(
    (item: Omit<ActivityItem, 'id' | 'timestamp'>) => {
      const now = Date.now();
      setActivityHistory((prev) => {
        // Deduplicate immediate replays of the same phrase & language within 10s
        const latest = prev[0];
        if (
          latest &&
          latest.phraseId === item.phraseId &&
          latest.language === item.language &&
          now - latest.timestamp < 10000
        ) {
          const updated = [{ ...latest, timestamp: now }, ...prev.slice(1)];
          persistActivity(updated);
          return updated;
        }

        const newItem: ActivityItem = {
          ...item,
          id: `${now}-${Math.random().toString(36).slice(2, 7)}`,
          timestamp: now,
        };
        const next = [newItem, ...prev].slice(0, MAX_ACTIVITY_ITEMS);
        persistActivity(next);
        return next;
      });
    },
    [persistActivity]
  );

  const removeActivityItem = useCallback(
    (id: string) => {
      setActivityHistory((prev) => {
        const next = prev.filter((item) => item.id !== id);
        persistActivity(next);
        return next;
      });
      triggerHaptic('light', preferences.hapticsEnabled);
    },
    [persistActivity, preferences.hapticsEnabled]
  );

  const clearActivity = useCallback(() => {
    setActivityHistory([]);
    persistActivity([]);
    triggerHaptic('medium', preferences.hapticsEnabled);
  }, [persistActivity, preferences.hapticsEnabled]);

  const t = useCallback(
    (key: string): string => {
      const dict = LOCALES[selectedLanguage] || LOCALES.en;
      return dict[key] || LOCALES.en[key] || key;
    },
    [selectedLanguage]
  );

  return (
    <AppContext.Provider
      value={{
        activeScreen,
        activeTab,
        selectedLanguage,
        preferences,
        demoModeAutoStart,
        activityHistory,
        t,
        navigateToTab,
        startLiveSession,
        startDemoSession,
        enterAppFromOnboarding,
        goToOnboarding,
        setLanguage,
        updatePreferences,
        consumeDemoAutoStart,
        addActivityItem,
        removeActivityItem,
        clearActivity,
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
