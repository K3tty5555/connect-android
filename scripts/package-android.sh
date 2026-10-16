#!/bin/bash
# Android 内测 APK 本地出包（PLAT-ANDROID-01，官网直发，用户 2026-10-15）：
#   载入签名（config/android-release.env，缺省退回 debug 签名并拒绝收包）
#   → expo prebuild（CNG，android/ 为生成物）→ gradlew assembleRelease → 收入 安装包/Android/。
# 内存口径（用户 2026-10-15）：--no-daemon 跑完即退、worker=2 / Kotlin 1GB（插件注入 gradle.properties）、
# 不与其他构建并行。产物名 Connect-<版本>-android.apk，与 contracts/public-beta-releases 的命名一致。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SIGNED=0
if [ -f "$ROOT/config/android-release.env" ]; then
  set -a
  # shellcheck source=/dev/null
  source "$ROOT/config/android-release.env"
  set +a
  SIGNED=1
fi
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export JAVA_HOME="${JAVA_HOME:-$(ls -d "$HOME"/.gradle/jdks/*/Contents/Home 2>/dev/null | head -1)}"
if [ -z "${JAVA_HOME:-}" ]; then
  echo "ANDROID PACKAGE FAILED: no JDK found (need JAVA_HOME or a Gradle JDK under ~/.gradle/jdks)" >&2
  exit 2
fi

cd "$ROOT/apps/mobile"
npx expo prebuild --platform android --no-install
cd android
./gradlew --init-script "$ROOT/scripts/android-gradle-mirror.init.gradle" :app:assembleRelease --no-daemon

VERSION="$(node -p "require('$ROOT/apps/mobile/package.json').version")"
SRC="app/build/outputs/apk/release/app-release.apk"
DEST_DIR="$ROOT/安装包/Android"
DEST="$DEST_DIR/Connect-$VERSION-android.apk"
mkdir -p "$DEST_DIR"
cp "$SRC" "$DEST"
if [ "$SIGNED" != "1" ]; then
  echo "WARNING: debug-signed build (config/android-release.env missing) — do not distribute" >&2
fi
SHA="$(shasum -a 256 "$DEST" | cut -d' ' -f1)"
SIZE="$(du -m "$DEST" | cut -f1)"
echo "ANDROID PACKAGE OK · Connect-$VERSION-android.apk · ${SIZE} MB · sha256 ${SHA:0:12} · $([ "$SIGNED" = 1 ] && echo release-signed || echo DEBUG-SIGNED)"
