import { Platform } from 'react-native';

export type SupportedMobileOS = 'ios' | 'android';

export interface PlatformPolicy {
  keyboardDismissMode: 'interactive' | 'on-drag';
  screenReader: 'VoiceOver' | 'TalkBack';
  handlesHardwareBack: boolean;
}

export function policyFor(os: SupportedMobileOS): PlatformPolicy {
  return os === 'ios'
    ? {
        keyboardDismissMode: 'interactive',
        screenReader: 'VoiceOver',
        handlesHardwareBack: false,
      }
    : {
        keyboardDismissMode: 'on-drag',
        screenReader: 'TalkBack',
        handlesHardwareBack: true,
      };
}

export function currentPlatformPolicy(): PlatformPolicy {
  return policyFor(Platform.OS === 'ios' ? 'ios' : 'android');
}
