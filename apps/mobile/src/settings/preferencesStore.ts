import * as SecureStore from 'expo-secure-store';
import type {
  LanguagePreference,
  MobilePreferences,
  TerminalKeyboardMode,
  TerminalShortcutBindings,
  MobileThemePreference,
} from '../../../../src/shared/types';
import type { SecureStorePort } from '../net/deviceIdentity';
import {
  DEFAULT_MOBILE_PREFERENCES,
  migrateMobilePreferencesV1,
  parseMobilePreferences,
} from './preferencesContract';

const PREFERENCES_KEY = 'connect.mobile.preferences.v2';
const LEGACY_PREFERENCES_KEY = 'connect.mobile.preferences.v1';

export interface MobilePreferencesPatch {
  theme?: MobileThemePreference;
  language?: LanguagePreference;
  notifications?: Partial<MobilePreferences['notifications']>;
  terminalView?: MobilePreferences['terminalView'];
  keyboardMode?: TerminalKeyboardMode;
  terminalShortcuts?: Partial<TerminalShortcutBindings>;
  terminalFont?: NonNullable<MobilePreferences['terminalFont']>;
  takeoverFollowsPhone?: boolean;
  autoTakeover?: boolean;
}

function clonePreferences(value: MobilePreferences): MobilePreferences {
  return {
    ...value,
    language: value.language,
    terminalView: value.terminalView,
    keyboardMode: value.keyboardMode ?? 'simple',
    terminalFont: value.terminalFont ?? 'menlo',
    takeoverFollowsPhone: value.takeoverFollowsPhone ?? true,
    autoTakeover: value.autoTakeover ?? true,
    terminalShortcuts: {
      interrupt: value.terminalShortcuts?.interrupt ?? 'c',
      eof: value.terminalShortcuts?.eof ?? 'd',
      cancel: value.terminalShortcuts?.cancel ?? 'z',
    },
    notifications: { ...value.notifications },
  };
}

export class MobilePreferencesStore {
  private current: MobilePreferences | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly secureStore: SecureStorePort = SecureStore) {}

  async load(): Promise<MobilePreferences> {
    const loaded = await this.loadStored();
    this.current = loaded;
    return clonePreferences(loaded);
  }

  update(patch: MobilePreferencesPatch): Promise<MobilePreferences> {
    const result = this.queue.then(async () => {
      const current = this.current ?? await this.loadStored();
      const next: MobilePreferences = {
        ...current,
        theme: patch.theme ?? current.theme,
        language: patch.language ?? current.language,
        terminalView: patch.terminalView ?? current.terminalView,
        keyboardMode: patch.keyboardMode ?? current.keyboardMode ?? 'simple',
        terminalFont: patch.terminalFont ?? current.terminalFont ?? 'menlo',
        takeoverFollowsPhone: patch.takeoverFollowsPhone ?? current.takeoverFollowsPhone ?? true,
        autoTakeover: patch.autoTakeover ?? current.autoTakeover ?? true,
        terminalShortcuts: {
          interrupt: patch.terminalShortcuts?.interrupt
            ?? current.terminalShortcuts?.interrupt ?? 'c',
          eof: patch.terminalShortcuts?.eof ?? current.terminalShortcuts?.eof ?? 'd',
          cancel: patch.terminalShortcuts?.cancel ?? current.terminalShortcuts?.cancel ?? 'z',
        },
        notifications: {
          ...current.notifications,
          ...patch.notifications,
        },
      };
      if (parseMobilePreferences(next) === null) {
        throw new Error('invalid mobile preferences');
      }
      await this.secureStore.setItemAsync(PREFERENCES_KEY, JSON.stringify(next));
      this.current = next;
      return clonePreferences(next);
    });
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  private async loadStored(): Promise<MobilePreferences> {
    const raw = await this.secureStore.getItemAsync(PREFERENCES_KEY);
    if (raw !== null) {
      try {
        const parsed = parseMobilePreferences(JSON.parse(raw) as unknown);
        if (parsed !== null) return clonePreferences(parsed);
      } catch {
        // Invalid persisted data is removed below and never reaches the UI.
      }
      await this.secureStore.deleteItemAsync(PREFERENCES_KEY).catch(() => {});
    }

    const legacyRaw = await this.secureStore.getItemAsync(LEGACY_PREFERENCES_KEY);
    if (legacyRaw !== null) {
      try {
        const migrated = migrateMobilePreferencesV1(JSON.parse(legacyRaw) as unknown);
        if (migrated !== null) {
          try {
            await this.secureStore.setItemAsync(PREFERENCES_KEY, JSON.stringify(migrated));
            await this.secureStore.deleteItemAsync(LEGACY_PREFERENCES_KEY);
          } catch {
            // The valid migration remains usable and will be retried on the next load.
          }
          return clonePreferences(migrated);
        }
      } catch {
        // Invalid legacy data is removed below and never reaches the UI.
      }
      await this.secureStore.deleteItemAsync(LEGACY_PREFERENCES_KEY).catch(() => {});
    }
    return clonePreferences(DEFAULT_MOBILE_PREFERENCES);
  }
}
