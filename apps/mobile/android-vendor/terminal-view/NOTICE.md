# terminal-view（内嵌自 Termux）

- 上游：https://github.com/termux/termux-app，标签 `v0.118.3`，仅取 `src/main`。
- 协议：GPLv3（仓库级 LICENSE 见 ../COPYING-GPLv3.md；含 jackpal/Android-Terminal-Emulator 的 Apache-2.0 血统文件）。
- 本目录源码改动一律逐条登记在本文件「改动」一节。

## 改动（Connect，2026-10-15）

- `TerminalView.java`：
  - 新增 `setFixedGeometry(cols, rows)`：`updateSize()` 优先用宿主指定的列行（桌面 PTY 的形状），0 时退回上游按视图尺寸自适应；
    新增只读 `getFontWidth()` / `getFontLineSpacing()` / `getFontLineSpacingAndAscent()` 供宿主算缩放与高度。
  - 新增 `ConnectScrollHook` 与 `setConnectScrollHook(...)`：设置后 `doScroll` 先问宿主是否接管（全屏应用转成桌面端滚轮），
    否则只做本地回看并回报 `mTopRow`；未设置时保持上游行为。
  - 新增 `setKeepScrollOnOutput(boolean)`：为 true 时 `onScreenUpdated` 在读者回看期间随新输出同步上移、不拽回底部。
- `src/main/res/`（2026-10-15 补入）：上游同版本的 `values/strings.xml` 与两枚选择手柄 drawable，原样未改（首次内嵌时漏取，编译缺 `R.string` / `R.drawable`）。
- `TerminalView.java` / `TerminalRenderer.java`：新增 `setFillRows(rows)` / `getMinTopRow()`，`render` 增加 `rowCount` 重载：桌面 PTY 行数
  不够填满视图时，在屏幕上方多画回看历史、整体贴底（不留半屏空白）；触摸/选字坐标与本地回看上界同步偏移。
- `TerminalRenderer.java`：比格子窄的字形（中文等宽字符）不再横向拉伸，按原比例居中；新增 `mBoldTypeface`（`TerminalView.setBoldTypeface`）
  用真粗体字形代替描粗（2026-10-15，真机上中文被拉宽 1.2 倍、粗体发糊）。
