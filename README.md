# Connect for Android — source

This repository is the complete corresponding source of **Connect for Android 1.0.16**, published under the
GNU General Public License v3 (see `LICENSE`). Each Android release is a snapshot tagged `v<version>`.

Connect is the phone companion of the Connect desktop app: it pairs with your own computer over Tailscale or a
trusted local network and shows the Claude / Codex / shell sessions running there. It does not run models on the phone.

The Android build embeds the [Termux](https://github.com/termux/termux-app) terminal view and emulator (GPLv3,
`apps/mobile/android-vendor/`, changes listed in each `NOTICE.md`), which is why this app is GPLv3.
The desktop app is not part of this repository.

## Build

Requirements: Node.js 22+, JDK 17, Android SDK (set `ANDROID_HOME`).

```sh
npm ci                      # build tools for the bundled web assets
(cd apps/mobile && npm ci)
npm run mobile:assets       # optional: rebuild the bundled terminal/room pages and file icons
npm run package:android     # APK lands in 安装包/Android/
```

Without `config/android-release.env` the APK is debug-signed; official builds are signed with the publisher's key,
so a self-built APK cannot update an installed official one (uninstall it first).

## Third-party components

- Termux terminal-emulator / terminal-view — GPLv3 (with Apache-2.0 code from Android-Terminal-Emulator)
- DejaVu Sans Mono — Bitstream Vera license + public-domain changes (`apps/mobile/assets/fonts/DejaVuSansMono/`)
- JetBrains Mono, Noto Sans Symbols / Symbols 2 subsets — SIL OFL 1.1
- npm dependencies — see `apps/mobile/package.json` and `package.json`

---

# Connect Android 版源码

本仓库是 **Connect Android 1.0.16** 的完整对应源码，按 GNU GPL 第 3 版发布（见 `LICENSE`），不提供任何担保。
每个 Android 版本一个快照，标签 `v<版本号>`。Android 版内嵌 Termux 终端组件（GPLv3），因此整个 Android 版以 GPLv3 开源；
电脑端不在本仓库内。构建方法见上文 Build 一节。

© 2026 武凯迪 (Ketty Wu)
