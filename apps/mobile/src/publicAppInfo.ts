import { Linking } from 'react-native';
import mobilePackage from '../package.json';
import type { PublicLinkKind } from '../../../src/shared/types';
import { buildPublicAppInfo } from '../../../src/shared/publicAppInfo';

export const MOBILE_PUBLIC_APP_INFO = buildPublicAppInfo(
  process.env.EXPO_PUBLIC_CONNECT_VERSION ?? mobilePackage.version,
  {
    allowedHosts: process.env.EXPO_PUBLIC_CONNECT_LINK_HOSTS,
    macDownloadUrl: process.env.EXPO_PUBLIC_CONNECT_MAC_DOWNLOAD_URL,
    androidDownloadUrl: process.env.EXPO_PUBLIC_CONNECT_ANDROID_DOWNLOAD_URL,
    iosAppStoreUrl: process.env.EXPO_PUBLIC_CONNECT_IOS_APP_STORE_URL,
    privacyUrl: process.env.EXPO_PUBLIC_CONNECT_PRIVACY_URL,
    supportUrl: process.env.EXPO_PUBLIC_CONNECT_SUPPORT_URL,
    compatibilityUrl: process.env.EXPO_PUBLIC_CONNECT_COMPATIBILITY_URL,
    downloadsUrl: process.env.EXPO_PUBLIC_CONNECT_DOWNLOADS_URL,
  },
);

export async function openMobilePublicLink(kind: PublicLinkKind): Promise<void> {
  const url = MOBILE_PUBLIC_APP_INFO.links[kind];
  if (url === null) throw new Error('public link unavailable');
  await Linking.openURL(url);
}
