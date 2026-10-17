import AjvModule from 'ajv/dist/2020';
import type { MobilePreferences } from '../../../../src/shared/types';

const Ajv = (AjvModule as unknown as { default?: typeof AjvModule }).default ?? AjvModule;

// Runtime mirror of contracts/mobile-preferences.schema.json. A root contract test
// keeps this bundled copy byte-for-byte aligned with the source-of-truth schema.
export const MOBILE_PREFERENCES_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'urn:connect:contracts:mobile-preferences:v2',
  title: 'MobilePreferences',
  type: 'object',
  additionalProperties: false,
  required: ['v', 'theme', 'language', 'terminalView', 'notifications'],
  properties: {
    v: { const: 2 },
    theme: {
      type: 'string',
      enum: ['system', 'dark', 'light'],
    },
    language: {
      type: 'string',
      enum: ['system', 'zh-Hans', 'zh-Hant', 'en'],
    },
    terminalView: {
      type: 'string',
      enum: ['reflow-view', 'exact-grid-view', 'webview', 'swiftterm-view'],
    },
    terminalFont: {
      type: 'string',
      enum: ['menlo', 'jetbrains-mono'],
    },
    takeoverFollowsPhone: {
      type: 'boolean',
    },
    autoTakeover: {
      type: 'boolean',
    },
    keyboardMode: {
      type: 'string',
      enum: ['simple', 'full'],
    },
    terminalShortcuts: {
      type: 'object',
      additionalProperties: false,
      required: ['interrupt', 'eof', 'cancel'],
      properties: {
        interrupt: { type: 'string', enum: ['c', 'd', 'z'] },
        eof: { type: 'string', enum: ['c', 'd', 'z'] },
        cancel: { type: 'string', enum: ['c', 'd', 'z'] },
      },
    },
    notifications: {
      type: 'object',
      additionalProperties: false,
      required: ['enabled', 'pending', 'completed', 'failed'],
      properties: {
        enabled: { type: 'boolean' },
        pending: { type: 'boolean' },
        completed: { type: 'boolean' },
        failed: { type: 'boolean' },
      },
    },
  },
} as const;

export const DEFAULT_MOBILE_PREFERENCES: MobilePreferences = Object.freeze({
  v: 2,
  theme: 'system',
  language: 'system',
  // Rendering ignores this field (native only, 2026-10-17); kept for stored-data compatibility.
  terminalView: 'swiftterm-view',
  keyboardMode: 'simple',
  terminalFont: 'menlo',
  takeoverFollowsPhone: true,
  autoTakeover: true,
  terminalShortcuts: { interrupt: 'c', eof: 'd', cancel: 'z' } as const,
  notifications: Object.freeze({
    enabled: true,
    pending: true,
    completed: false,
    failed: true,
  }),
});

const ajv = new Ajv({ strict: false, allErrors: true });
const validate = ajv.compile(MOBILE_PREFERENCES_SCHEMA);

const validateLegacyV1 = ajv.compile({
  type: 'object',
  additionalProperties: false,
  required: ['v', 'theme', 'notifications'],
  properties: {
    v: { const: 1 },
    theme: { enum: ['system', 'dark', 'light'] },
    language: { enum: ['system', 'zh-Hans', 'zh-Hant', 'en'] },
    terminalRenderer: { enum: ['native-grid', 'legacy-webview'] },
    notifications: {
      type: 'object',
      additionalProperties: false,
      required: ['enabled', 'pending', 'completed', 'failed'],
      properties: {
        enabled: { type: 'boolean' },
        pending: { type: 'boolean' },
        completed: { type: 'boolean' },
        failed: { type: 'boolean' },
      },
    },
  },
} as const);

export function parseMobilePreferences(value: unknown): MobilePreferences | null {
  return validate(value) ? value as MobilePreferences : null;
}

export function migrateMobilePreferencesV1(value: unknown): MobilePreferences | null {
  if (!validateLegacyV1(value)) return null;
  const legacy = value as {
    theme: MobilePreferences['theme'];
    language?: MobilePreferences['language'];
    terminalRenderer?: 'native-grid' | 'legacy-webview';
    notifications: MobilePreferences['notifications'];
  };
  return {
    v: 2,
    theme: legacy.theme,
    language: legacy.language ?? 'system',
    terminalView: 'swiftterm-view',
    notifications: { ...legacy.notifications },
  };
}
