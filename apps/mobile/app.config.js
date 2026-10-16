const storeBuild = process.env.CONNECT_APP_STORE_BUILD === '1';
// 正式 Bundle ID 的唯一来源（用户 2026-10-03 拍板）；上架版默认取它，传入的值必须与它一致。
const appIdentity = require('../../config/app-identity.json');
const requestedBundleIdentifier = process.env.CONNECT_APP_STORE_IOS_BUNDLE_ID;
const bundleIdentifier = storeBuild
  ? requestedBundleIdentifier || appIdentity.ios.appStoreBundleId
  : requestedBundleIdentifier;
const appleTeamId = storeBuild
  ? process.env.CONNECT_APP_STORE_IOS_TEAM_ID || appIdentity.appleTeamId
  : process.env.CONNECT_APP_STORE_IOS_TEAM_ID;
const version = process.env.CONNECT_APP_STORE_VERSION;
const buildNumber = process.env.CONNECT_APP_STORE_IOS_BUILD_NUMBER;
const appJson = require('./app.json').expo;
const publicLinkDefaults = require('../../config/public-links.json');
const publicLinks = {
  hosts: process.env.CONNECT_PUBLIC_LINK_HOSTS || publicLinkDefaults.allowedHosts.join(','),
  macDownload: process.env.CONNECT_PUBLIC_MAC_DOWNLOAD_URL,
  androidDownload: process.env.CONNECT_PUBLIC_ANDROID_DOWNLOAD_URL || publicLinkDefaults.androidDownloadUrl,
  iosAppStore: process.env.CONNECT_PUBLIC_IOS_APP_STORE_URL,
  privacy: process.env.CONNECT_PUBLIC_PRIVACY_URL || publicLinkDefaults.privacyUrl,
  support: process.env.CONNECT_PUBLIC_SUPPORT_URL || publicLinkDefaults.supportUrl,
  compatibility: process.env.CONNECT_PUBLIC_COMPATIBILITY_URL || publicLinkDefaults.compatibilityUrl,
};

process.env.EXPO_PUBLIC_CONNECT_VERSION = version || appJson.version;
process.env.EXPO_PUBLIC_CONNECT_LINK_HOSTS = publicLinks.hosts || '';
process.env.EXPO_PUBLIC_CONNECT_ANDROID_DOWNLOAD_URL = publicLinks.androidDownload || '';
process.env.EXPO_PUBLIC_CONNECT_MAC_DOWNLOAD_URL = publicLinks.macDownload || '';
process.env.EXPO_PUBLIC_CONNECT_IOS_APP_STORE_URL = publicLinks.iosAppStore || '';
process.env.EXPO_PUBLIC_CONNECT_PRIVACY_URL = publicLinks.privacy || '';
process.env.EXPO_PUBLIC_CONNECT_SUPPORT_URL = publicLinks.support || '';
process.env.EXPO_PUBLIC_CONNECT_COMPATIBILITY_URL = publicLinks.compatibility || '';

if (storeBuild) {
  const missing = [
    ['CONNECT_APP_STORE_IOS_BUNDLE_ID', bundleIdentifier],
    ['CONNECT_APP_STORE_IOS_TEAM_ID', appleTeamId],
    ['CONNECT_APP_STORE_VERSION', version],
    ['CONNECT_APP_STORE_IOS_BUILD_NUMBER', buildNumber],
    ['CONNECT_PUBLIC_LINK_HOSTS', publicLinks.hosts],
    ['CONNECT_PUBLIC_MAC_DOWNLOAD_URL', publicLinks.macDownload],
    ['CONNECT_PUBLIC_IOS_APP_STORE_URL', publicLinks.iosAppStore],
    ['CONNECT_PUBLIC_PRIVACY_URL', publicLinks.privacy],
    ['CONNECT_PUBLIC_SUPPORT_URL', publicLinks.support],
    ['CONNECT_PUBLIC_COMPATIBILITY_URL', publicLinks.compatibility],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length > 0) throw new Error(`Missing App Store build settings: ${missing.join(', ')}`);
  if (/\.team[0-9a-z]+$/iu.test(bundleIdentifier)) throw new Error('Temporary Team-suffixed Bundle ID is forbidden for App Store builds.');
  if (bundleIdentifier !== appIdentity.ios.appStoreBundleId) {
    throw new Error(`App Store Bundle ID must match config/app-identity.json (${appIdentity.ios.appStoreBundleId}).`);
  }
  if (!/^\d+\.\d+\.\d+$/u.test(version)) throw new Error('CONNECT_APP_STORE_VERSION must be semantic version x.y.z.');
  if (!/^[1-9]\d*$/u.test(buildNumber)) throw new Error('CONNECT_APP_STORE_IOS_BUILD_NUMBER must be a positive integer.');
}

// 「Connect」已被其他开发者的 App 占用，上架包的名称/显示名会被 App Store Connect 拒收（ITMS-90129）。
// 上架版统一改用 config/app-identity.json 的显示名（含各语言 InfoPlist），本地自用版仍叫 Connect。
function storeLocales(locales) {
  if (!locales) return locales;
  const path = require('node:path');
  const fs = require('node:fs');
  return Object.fromEntries(Object.entries(locales).map(([locale, value]) => {
    const strings = typeof value === 'string'
      ? JSON.parse(fs.readFileSync(path.resolve(__dirname, value), 'utf8'))
      : value;
    return [locale, { ...strings, CFBundleDisplayName: appIdentity.ios.appStoreDisplayName }];
  }));
}

module.exports = ({ config }) => ({
  ...config,
  // Expo 用 `name` 命名 Xcode 工程（ios/Connect.xcodeproj、scheme Connect），这里不能改，只改 Info.plist 里的名称字段。
  ...(storeBuild ? { locales: storeLocales(config.locales) } : {}),
  ...(version ? { version } : {}),
  ios: {
    ...config.ios,
    ...(storeBuild ? {
      infoPlist: {
        ...config.ios?.infoPlist,
        CFBundleDisplayName: appIdentity.ios.appStoreDisplayName,
        CFBundleName: appIdentity.ios.appStoreDisplayName,
      },
    } : {}),
    ...(bundleIdentifier ? { bundleIdentifier } : {}),
    ...(appleTeamId ? { appleTeamId } : {}),
    ...(buildNumber ? { buildNumber } : {}),
  },
});
