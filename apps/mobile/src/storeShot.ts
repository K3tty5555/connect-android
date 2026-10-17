import { Settings as NativeSettings } from 'react-native';

/**
 * App Store screenshot mode (主计划 STORE-SCREENSHOTS-01).
 *
 * Only a build made with `EXPO_PUBLIC_CONNECT_STORE_SHOT=1` has it; the scene
 * and the demo data language come from launch arguments
 * (`-ConnectStoreShot <scene> -ConnectStoreShotLocale <locale>`), so one build
 * serves every screenshot. The app never pairs or connects in this mode: every
 * screen is fed from `storeShotFixtures`, and nothing reaches a Mac.
 */
export type StoreShotScene = 'terminal' | 'sessions' | 'create' | 'room' | 'pair' | 'files';
export type StoreShotLocale = 'zh-Hans' | 'zh-Hant' | 'en';

export interface StoreShot {
  scene: StoreShotScene;
  locale: StoreShotLocale;
}

const SCENES: readonly StoreShotScene[] = ['terminal', 'sessions', 'create', 'room', 'pair', 'files'];
const LOCALES: readonly StoreShotLocale[] = ['zh-Hans', 'zh-Hant', 'en'];

function readStoreShot(): StoreShot {
  const scene = NativeSettings.get('ConnectStoreShot') as unknown;
  const locale = NativeSettings.get('ConnectStoreShotLocale') as unknown;
  return {
    scene: SCENES.includes(scene as StoreShotScene) ? scene as StoreShotScene : 'terminal',
    locale: LOCALES.includes(locale as StoreShotLocale) ? locale as StoreShotLocale : 'zh-Hans',
  };
}

export const STORE_SHOT: StoreShot | null = process.env.EXPO_PUBLIC_CONNECT_STORE_SHOT === '1'
  ? readStoreShot()
  : null;
