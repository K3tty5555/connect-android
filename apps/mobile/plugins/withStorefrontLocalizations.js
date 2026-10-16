const { withXcodeProject } = require('@expo/config-plugins');

/**
 * iOS chooses native editing-menu language from the bundle localization graph.
 * Expo's `locales` config creates the `.lproj` resources; this plugin makes
 * Simplified Chinese the CNG-generated project's development language and
 * keeps every supported storefront language in the native project graph.
 *
 * zh-Hant is required because iOS does NOT fall back from zh-Hant to zh-Hans:
 * without it, Traditional Chinese devices in the HK/MO/TW storefronts
 * (STORE-STOREFRONT-SCOPE-01) render the app in English.
 */
const SUPPORTED_LOCALES = ['zh-Hans', 'zh-Hant', 'en'];

const withStorefrontLocalizations = (config) => withXcodeProject(config, (projectConfig) => {
  const project = projectConfig.modResults;
  project.getFirstProject().firstProject.developmentRegion = 'zh-Hans';
  for (const locale of SUPPORTED_LOCALES) project.addKnownRegion(locale);
  projectConfig.modResults = project;
  return projectConfig;
});

module.exports = withStorefrontLocalizations;
module.exports.SUPPORTED_LOCALES = SUPPORTED_LOCALES;
