const fs = require('fs');
const path = require('path');
const { withAppBuildGradle, withDangerousMod, withGradleProperties, withSettingsGradle } = require('@expo/config-plugins');

/**
 * Android 本地出包（PLAT-ANDROID-01，官网 APK 直发，用户 2026-10-15）：
 *
 * 1. 签名：环境变量给了 CONNECT_ANDROID_KEYSTORE_*（scripts/package-android.sh 从
 *    config/android-release.env 载入，keystore 与 env 都不入 git）时，把
 *    android/keystore.properties 写进 prebuild 产物，并让 release 构建读它；
 *    没给时保持模板的 debug 签名（仅供本机联调，不得分发）。
 * 2. 内存：出包机就是用户的日常机（16GB，多会话并行），把 Gradle 并发压到 2、
 *    Kotlin 守护进程压到 1GB；JVM 堆沿用模板的 -Xmx2048m。出包脚本另用
 *    --no-daemon，跑完即退出不驻留。
 */
const withAndroidReleaseBuild = (config) => {
  const env = process.env;
  const signing = ['CONNECT_ANDROID_KEYSTORE_PATH', 'CONNECT_ANDROID_KEYSTORE_PASSWORD', 'CONNECT_ANDROID_KEY_ALIAS', 'CONNECT_ANDROID_KEY_PASSWORD']
    .every((name) => env[name] && env[name].trim() !== '');

  config = withGradleProperties(config, (props) => {
    props.modResults = props.modResults
      .filter((item) => item.type !== 'property' || !['org.gradle.workers.max', 'kotlin.daemon.jvmargs'].includes(item.key))
      .concat([
        { type: 'property', key: 'org.gradle.workers.max', value: '2' },
        { type: 'property', key: 'kotlin.daemon.jvmargs', value: '-Xmx1024m' },
      ]);
    return props;
  });

  // Termux 内嵌库（android-vendor/，GPLv3）：prebuild 每次重生成 settings.gradle，
  // 这里重新挂上两个库模块（rootDir 即 android/，库在它旁边）。
  config = withSettingsGradle(config, (gradle) => {
    const root = gradle.modResults.contents;
    const append = [
      "include ':terminal-emulator'",
      "project(':terminal-emulator').projectDir = new File(rootDir, '../android-vendor/terminal-emulator')",
      "include ':terminal-view'",
      "project(':terminal-view').projectDir = new File(rootDir, '../android-vendor/terminal-view')",
      '',
    ].join('\n');
    if (!root.includes("include ':terminal-view'")) {
      gradle.modResults.contents = `${root.endsWith('\n') ? root : `${root}\n`}${append}`;
    }
    return gradle;
  });

  // app.json 的 locales 是给 iOS storefront 用的（InfoPlist 键）；Expo 会原样写进 Android
  // values-b+*/strings.xml，默认 locale 又没有这些键 → lintVitalRelease 的 ExtraTranslation
  // 直接判 fatal。Android 运行时用不到它们，生成后剥掉。
  config = withDangerousMod(config, [
    'android',
    (props) => {
      const resDir = path.join(props.modRequest.platformProjectRoot ?? path.join(props.modRequest.projectRoot, 'android'), 'app/src/main/res');
      if (fs.existsSync(resDir)) {
        for (const entry of fs.readdirSync(resDir)) {
          if (!entry.startsWith('values-b+')) continue;
          const file = path.join(resDir, entry, 'strings.xml');
          if (!fs.existsSync(file)) continue;
          const stripped = fs.readFileSync(file, 'utf8').replace(/^\s*<string name="(?:NS[^"]*|CFBundleDisplayName)">.*<\/string>$/gmu, '');
          fs.writeFileSync(file, stripped);
        }
      }
      return props;
    },
  ]);

  if (signing) {
    config = withDangerousMod(config, [
      'android',
      (props) => {
        // modRequest.projectRoot 是 apps/mobile（不是 android/）；gradle 侧读的是 rootProject.file("keystore.properties")，
        // 即 android/keystore.properties。2026-10-15 首跑写错一层，release 落成 debug 签名。
        const file = path.join(props.modRequest.platformProjectRoot ?? path.join(props.modRequest.projectRoot, 'android'), 'keystore.properties');
        const keystore = path.resolve(props.modRequest.projectRoot, '..', '..', env.CONNECT_ANDROID_KEYSTORE_PATH);
        if (!fs.existsSync(keystore)) throw new Error(`CONNECT_ANDROID_KEYSTORE_PATH does not exist: ${keystore}`);
        fs.writeFileSync(
          file,
          [
            `storeFile=${keystore}`,
            `storePassword=${env.CONNECT_ANDROID_KEYSTORE_PASSWORD}`,
            `keyAlias=${env.CONNECT_ANDROID_KEY_ALIAS}`,
            `keyPassword=${env.CONNECT_ANDROID_KEY_PASSWORD}`,
            '',
          ].join('\n'),
        );
        return props;
      },
    ]);
    config = withAppBuildGradle(config, (props) => {
      // 模板 release 块里是 signingConfig signingConfigs.debug（expo/template.tgz app/build.gradle）；
      // 同串在 debug 块出现一次，只替换 release 块内那次。
      const releaseSigning = [
        'def connectKeystore = rootProject.file("keystore.properties")',
        'if (connectKeystore.exists()) {',
        '  def connectProps = new Properties()',
        '  connectProps.load(new FileInputStream(connectKeystore))',
        '  signingConfigs {',
        '    connectRelease {',
        '      storeFile rootProject.file(connectProps[\'storeFile\'])',
        '      storePassword connectProps[\'storePassword\']',
        '      keyAlias connectProps[\'keyAlias\']',
        '      keyPassword connectProps[\'keyPassword\']',
        '    }',
        '  }',
        '  signingConfig signingConfigs.connectRelease',
        '} else {',
        '  signingConfig signingConfigs.debug',
        '}',
      ].join('\n            ');
      const marker = 'signingConfig signingConfigs.debug';
      const first = props.modResults.contents.indexOf(marker);
      const second = props.modResults.contents.indexOf(marker, first + 1);
      if (first === -1 || second === -1) throw new Error('unexpected Expo template app/build.gradle: expected two signingConfig assignments');
      props.modResults.contents = props.modResults.contents.slice(0, second) + releaseSigning + props.modResults.contents.slice(second + marker.length);
      return props;
    });
  }

  return config;
};

module.exports = withAndroidReleaseBuild;
