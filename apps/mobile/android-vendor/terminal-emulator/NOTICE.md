# terminal-emulator（内嵌自 Termux）

- 上游：https://github.com/termux/termux-app，标签 `v0.118.3`，仅取 `src/main`。
- 协议：GPLv3（仓库级 LICENSE 见 ../COPYING-GPLv3.md；含 jackpal/Android-Terminal-Emulator 的 Apache-2.0 血统文件）。
- 本目录源码改动一律逐条登记在本文件「改动」一节。

## 改动（Connect，2026-10-15）

- `TerminalSession.java`：新增「桥接模式」构造器 `(transcriptRows, client)`——宿主（Connect 手机端）从桌面端
  经移动桥收到终端输出后直接 `getTerminalEmulator().append()` 注入，不创建本地进程；
  `initializeEmulator`/`updateSize`/`cleanupResources` 相应跳过 JNI 调用；`write(byte[])` 维持上游
  `mShellPid > 0` 守卫，桥接模式下为 no-op（输入不经此会话）。
- 构建文件为本仓库重写（上游用根工程属性；模块源码其余未动）。
- `TerminalEmulator.java`：新增公开方法 `applyConnectColors(...)`，供宿主注入主题色（默认前景/背景/光标与前 16 色 ANSI）。
