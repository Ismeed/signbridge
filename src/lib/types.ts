export type SupportedLanguage = 'en' | 'ha' | 'yo' | 'ig' | 'pcm';

export interface LanguageInfo {
  code: SupportedLanguage;
  name: string;
  nativeName: string;
  region: string;
  voiceLangCode: string;
  greeting: string;
}

export type ActiveScreen = 'onboarding' | 'app';

export type AppTab = 'home' | 'interpret' | 'activity' | 'settings';

export type InterpretationState =
  | 'idle'
  | 'ready'
  | 'tracking'
  | 'simulating'
  | 'demonstrating'
  | 'captioning'
  | 'audio_playback'
  | 'complete';

export interface DemoPhrase {
  id: string;
  signConcept: string;
  category: string;
  signDescription: string;
  translations: Record<SupportedLanguage, string>;
  phoneticGuide?: Record<SupportedLanguage, string>;
}

export interface UserPreferences {
  language: SupportedLanguage;
  hapticsEnabled: boolean;
  reducedMotion: boolean;
  highContrast: boolean;
  fontSize: 'normal' | 'large' | 'extra-large';
  cameraPermissionConsent: boolean;
}
