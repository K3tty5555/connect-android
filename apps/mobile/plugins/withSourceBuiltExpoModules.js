const { withPodfileProperties } = require('@expo/config-plugins');

/**
 * Expo ships precompiled `.xcframework` artifacts for its own modules. Those
 * binaries dynamically link `@rpath/React.framework/React` and
 * `@rpath/ReactNativeDependencies.framework/ReactNativeDependencies`, which
 * only exist when React Native itself is consumed as prebuilt frameworks. This
 * project links React Native statically, so neither framework is ever emitted
 * and `ExpoModulesWorklets.framework` aborts the app under dyld on a physical
 * device (`signal 6`) before any JavaScript runs. Simulator builds did not
 * surface it.
 *
 * `expo-modules-autolinking/scripts/ios/precompiled_modules.rb` is supposed to
 * fall back to source builds when `RCT_USE_PREBUILT_RNCORE` is not `1`, but the
 * fallback did not take effect here, so pin the property explicitly. Podfile
 * line 21 force-disables precompiled modules when this is the string `'false'`,
 * and that branch wins even when the env var is already set.
 *
 * `ios/Podfile.properties.json` is a gitignored prebuild artifact, so the value
 * has to be re-applied by a plugin rather than edited in place.
 */
const withSourceBuiltExpoModules = (config) => withPodfileProperties(
  config,
  (podfileConfig) => {
    podfileConfig.modResults.EXPO_USE_PRECOMPILED_MODULES = 'false';
    return podfileConfig;
  },
);

module.exports = withSourceBuiltExpoModules;
