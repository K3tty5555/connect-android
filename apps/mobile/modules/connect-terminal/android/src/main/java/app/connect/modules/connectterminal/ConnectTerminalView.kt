package app.connect.modules.connectterminal

import android.content.Context
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.fonts.Font
import android.graphics.fonts.FontFamily
import android.graphics.fonts.FontStyle
import android.os.Build
import android.os.Bundle
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import com.termux.terminal.TerminalEmulator
import com.termux.terminal.TerminalSession
import com.termux.terminal.TerminalSessionClient
import com.termux.view.TerminalView
import com.termux.view.TerminalViewClient
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.nio.charset.StandardCharsets
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

/**
 * Android 端的 Connect 终端视图：Termux terminal-view（Canvas 自绘）+ 桥接模式会话。
 * 与 iOS 的 SwiftTerm 视图同一契约（见 ../../index.ts）：输出由 JS 经 ptyData 推进来
 * feed/apply；输入不经此视图（手机端输入由 React 组合键盘走桥的 write 命令）。
 *
 * 排版对齐 iOS（ConnectTerminalView.swift 的 layoutTerminal）：模拟器始终按桌面 PTY 的
 * 列行排版；比容器宽就缩字号，但不低于可读下限 11sp（用户 2026-10-23 拍板），再放不下就让
 * 画布比容器宽、横向拖动查看；比容器高就底部对齐（最新行可见）。容器在首选字号下
 * 能放下的列行另经 onFit 报给 JS（接管时把 PTY 交给手机的形状）。
 * React Native 不替原生子视图做 measure/layout，子视图的位置尺寸全部在 onLayout 里手算。
 */
class ConnectTerminalView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {

  private val termView = TerminalView(context, null)
  private val sessionClient = BridgeSessionClient()

  private var session: TerminalSession? = null
  private val pendingOutput = StringBuilder()
  private var announcedReady = false
  private var lastFit: Pair<Int, Int>? = null
  private var geometry: Pair<Int, Int>? = null

  private var typeface: Typeface = Typeface.MONOSPACE
  private var preferredFontSize = 13.0
  private var appliedTextSize = 0
  private var appliedTypeface: Typeface? = null

  private var palette: Map<String, Any?> = emptyMap()
  private var wheelAtEdges = false
  private var wheelCarry = 0
  private var reportedBrowsing = false

  // 画布比容器宽时向左移出的像素；横向拖动才移动，竖向手势照旧交给终端。
  private var panX = 0
  private var maxPanX = 0
  private var sideways = false
  private var downX = 0f
  private var downY = 0f
  private var lastX = 0f
  private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop

  private val onReady by EventDispatcher<Bundle>()
  private val onFit by EventDispatcher<Bundle>()
  private val onPainted by EventDispatcher<Bundle>()
  private val onWheel by EventDispatcher<Bundle>()
  private val onBrowsing by EventDispatcher<Bundle>()

  init {
    clipChildren = true
    // 输入走 React 组合键盘：不让终端视图抢焦点弹系统键盘。
    termView.isFocusable = false
    termView.isFocusableInTouchMode = false
    termView.setTerminalViewClient(BridgeViewClient())
    termView.setKeepScrollOnOutput(true)
    termView.setConnectScrollHook(ScrollHook())
    // Termux 视图的渲染器在第一次 setTextSize 前为 null，setTypeface / updateSize / 字体度量都会空指针。
    termView.setTextSize(preferredTextSize())
    addView(termView)
    rebuildSession()
  }

  // —— 生命周期 ——

  /** 与 iOS didMoveToWindow 同义：原生视图已在，JS 可以发命令了（只报一次）。 */
  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    if (announcedReady) return
    announcedReady = true
    onReady(Bundle())
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    reportFit()
    layoutTerminal()
  }

  override fun onInterceptTouchEvent(ev: MotionEvent): Boolean {
    if (maxPanX <= 0) return false
    when (ev.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        downX = ev.x
        downY = ev.y
        lastX = ev.x
        sideways = false
      }
      MotionEvent.ACTION_MOVE -> {
        val dx = ev.x - downX
        val dy = ev.y - downY
        if (!sideways && abs(dx) > touchSlop && abs(dx) > abs(dy)) {
          sideways = true
          lastX = ev.x
          return true
        }
      }
    }
    return false
  }

  override fun onTouchEvent(ev: MotionEvent): Boolean {
    if (!sideways) return super.onTouchEvent(ev)
    when (ev.actionMasked) {
      MotionEvent.ACTION_MOVE -> {
        val next = min(maxPanX, max(0, panX - (ev.x - lastX).toInt()))
        lastX = ev.x
        if (next != panX) {
          panX = next
          termView.offsetLeftAndRight(-panX - termView.left)
        }
      }
      MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> sideways = false
    }
    return true
  }

  // —— Props ——

  fun setFontFamily(value: String) {
    // Menlo 是苹果系统字体、不能随包分发；Android 用 Menlo 的开源同源字体 DejaVu Sans Mono（2026-10-15）
    val jetBrains = value == "jetbrains-mono"
    typeface = terminalTypeface(if (jetBrains) "fonts/JetBrainsMono-Regular.ttf" else "fonts/DejaVuSansMono.ttf", bold = false)
    termView.setBoldTypeface(
      terminalTypeface(if (jetBrains) "fonts/JetBrainsMono-Bold.ttf" else "fonts/DejaVuSansMono-Bold.ttf", bold = true),
    )
    relayout()
  }

  /**
   * 主字体 → 随包符号补字（Claude 的 ⏺ ⏵ ⏸ ⎿、盲文转圈，主字体与小米系统字体都缺，曾显示成方块）
   * → 系统字体（中文等）。CustomFallbackBuilder 需 API 29；更早的系统只用主字体加系统默认补字。
   */
  private fun terminalTypeface(asset: String, bold: Boolean): Typeface {
    val base = runCatching { Typeface.createFromAsset(context.assets, asset) }.getOrNull()
      ?: return if (bold) Typeface.create(Typeface.MONOSPACE, Typeface.BOLD) else Typeface.MONOSPACE
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return base
    return runCatching {
      fun family(path: String) = FontFamily.Builder(Font.Builder(context.assets, path).build()).build()
      val builder = Typeface.CustomFallbackBuilder(family(asset))
      for (path in SYMBOL_FALLBACK_ASSETS) builder.addCustomFallback(family(path))
      // 粗体链让系统补字（中文）也挑粗体字重
      if (bold) builder.setStyle(FontStyle(FontStyle.FONT_WEIGHT_BOLD, FontStyle.FONT_SLANT_UPRIGHT))
      builder.setSystemFallback("sans-serif").build()
    }.getOrDefault(base)
  }

  fun setPreferredFontSize(value: Double) {
    if (value <= 0 || value == preferredFontSize) return
    preferredFontSize = value
    lastFit = null
    relayout()
  }

  fun setPalette(value: Map<String, Any?>) {
    palette = value
    applyPalette()
  }

  fun setWheelAtEdges(value: Boolean) {
    wheelAtEdges = value
  }

  // —— 命令（对齐 Swift 端） ——

  fun feed(text: String) {
    appendOutput(text)
    termView.onScreenUpdated()
    reportBrowsing()
  }

  /** apply 内的批量追加：整批结束后统一 onScreenUpdated 一次。 */
  private fun appendOutput(text: String) {
    val emulator = session?.emulator
    if (emulator == null) {
      pendingOutput.append(text)
      return
    }
    val bytes = text.toByteArray(StandardCharsets.UTF_8)
    emulator.append(bytes, bytes.size)
  }

  fun setGeometry(cols: Int, rows: Int) {
    if (cols < 2 || cols > 500 || rows < 1 || rows > 200) return
    if (geometry == cols to rows) return
    geometry = cols to rows
    // 换了形状就是新的排版：回到最左边。
    panX = 0
    layoutTerminal()
  }

  /** 清屏与回看（与 SwiftTerm resetToInitialState 同义）：换一个新的桥接会话，几何不变。 */
  fun resetTerminal() {
    rebuildSession()
  }

  fun applyCommands(commands: List<Map<String, Any?>>, operationId: String?) {
    var replaced = false
    var keepFromBottom: Int? = null
    for (command in commands) {
      when (command["kind"]) {
        "reset" -> {
          if (command["keepScroll"] == true && termView.topRow < 0) keepFromBottom = -termView.topRow
          resetTerminal()
          replaced = true
        }
        "geometry" -> {
          val cols = (command["cols"] as? Number)?.toInt()
          val rows = (command["rows"] as? Number)?.toInt()
          if (cols != null && rows != null) setGeometry(cols, rows)
        }
        "text" -> (command["data"] as? String)?.let { appendOutput(it) }
      }
    }
    if (replaced) {
      // 重放后停在最新行；重建正在读的面板时回到读者原来的位置。
      // 锚点越过重建后历史的顶端，说明原位置已不存在：回到最新，而不是夹到最旧一行
      //（IPAD-SIDEBAR-SCROLL-TOP-1025，与 iOS apply 同义）。
      val anchored = -(keepFromBottom ?: 0)
      termView.topRow = if (anchored < termView.minTopRow) 0 else anchored
    }
    termView.onScreenUpdated()
    if (operationId != null) markPainted(operationId)
    reportBrowsing()
  }

  fun markPainted(operationId: String) {
    // 下一帧绘制之后再回执（与 iOS 在同一 runloop 绘制后回执同义）。
    termView.postOnAnimation {
      onPainted(Bundle().apply { putString("operationId", operationId) })
    }
  }

  fun scrollToBottomNow() {
    termView.topRow = 0
    termView.invalidate()
    reportBrowsing()
  }

  // —— 排版 ——

  private fun relayout() {
    reportFit()
    layoutTerminal()
  }

  private fun cellAt(textSize: Int): Pair<Float, Int> {
    val paint = Paint().apply {
      isAntiAlias = true
      this.typeface = this@ConnectTerminalView.typeface
      this.textSize = textSize.toFloat()
    }
    return paint.measureText("X") to ceil(paint.fontSpacing.toDouble()).toInt()
  }

  private fun preferredTextSize(): Int =
    max(6, (preferredFontSize * resources.displayMetrics.density).toInt())

  /** 缩字号的下限（旧 Exact Grid 的 11pt）：再小手机上就看不清了。 */
  private fun readableTextFloor(): Int =
    max(6, (min(preferredFontSize, READABLE_FONT_FLOOR) * resources.displayMetrics.density).toInt())

  /** 首选字号下容器能放下的列行：手机自己的形状，接管时交给 PTY。 */
  private fun reportFit() {
    if (width <= 0 || height <= 0) return
    val (cellWidth, lineSpacing) = cellAt(preferredTextSize())
    val fit = max(2, min(500, (width / cellWidth).toInt())) to max(1, min(200, height / max(1, lineSpacing)))
    if (fit == lastFit) return
    lastFit = fit
    onFit(Bundle().apply {
      putInt("cols", fit.first)
      putInt("rows", fit.second)
    })
  }

  private fun layoutTerminal() {
    if (width <= 0 || height <= 0) return
    val (cols, rows) = geometry ?: lastFit ?: (80 to 24)
    // 比容器宽：缩字号到放得下（像素整数步进，测量与 Termux 渲染器同一算法），
    // 到可读下限为止；剩下的宽度靠横向拖动。
    val floorSize = readableTextFloor()
    var size = preferredTextSize()
    if (cols * cellAt(size).first > width + 1) {
      size = max(floorSize, floor(size * width / (cols * cellAt(size).first)).toInt())
      while (size > floorSize && cols * cellAt(size).first > width + 0.5f) size -= 1
    }
    if (size != appliedTextSize || typeface !== appliedTypeface) {
      appliedTextSize = size
      appliedTypeface = typeface
      // setTextSize 先于 setTypeface：后者读当前渲染器的字号（真机闪退，2026-10-15）
      termView.setTextSize(size)
      termView.setTypeface(typeface)
    }
    // 先定列行再给子视图尺寸：子视图第一次有尺寸时 Termux 就会建模拟器并灌入缓冲输出，
    // 此刻若还没有固定几何，会按手机宽度排一遍再被改宽，历史排乱（真机，2026-10-15）。
    termView.setFixedGeometry(cols, rows)
    // rows 行比容器高：子视图加高并上移，最新行贴底可见（同 iOS）。
    // rows 行比容器矮：子视图铺满容器，上方空出的行画回看历史、整体贴底，不留半屏空白。
    val ascentPad = max(0, termView.fontLineSpacingAndAscent)
    val needed = rows * termView.fontLineSpacing + ascentPad
    val fill = if (needed > height) 0 else (height - ascentPad) / termView.fontLineSpacing - rows
    termView.setFillRows(fill)
    val viewHeight = max(needed, height)
    val y = if (needed > height) height - needed else 0
    val viewWidth = max(width, ceil(cols * cellAt(size).first.toDouble()).toInt())
    maxPanX = viewWidth - width
    panX = min(maxPanX, panX)
    termView.measure(
      MeasureSpec.makeMeasureSpec(viewWidth, MeasureSpec.EXACTLY),
      MeasureSpec.makeMeasureSpec(viewHeight, MeasureSpec.EXACTLY),
    )
    termView.layout(-panX, y, viewWidth - panX, y + viewHeight)
  }

  // —— 会话与主题 ——

  private fun rebuildSession() {
    pendingOutput.setLength(0)
    val fresh = TerminalSession(TRANSCRIPT_ROWS, sessionClient)
    session = fresh
    sessionClient.current = fresh
    sessionClient.view = this
    termView.attachSession(fresh)
    applyPalette()
  }

  private fun parseColor(value: Any?): Int? =
    (value as? String)?.let { runCatching { Color.parseColor(it) }.getOrNull() }

  private fun applyPalette() {
    val background = parseColor(palette["background"]) ?: return
    val foreground = parseColor(palette["foreground"]) ?: return
    val cursor = parseColor(palette["cursor"]) ?: foreground
    val ansi = (palette["ansi"] as? List<*>)?.mapNotNull { parseColor(it) }?.toIntArray() ?: IntArray(0)
    setBackgroundColor(background)
    termView.setBackgroundColor(background)
    val emulator = session?.emulator ?: return
    emulator.applyConnectColors(background, foreground, cursor, ansi)
    termView.invalidate()
  }

  /** 模拟器在首次有尺寸时才建立：灌入此前缓冲的输出、套主题。 */
  private fun onEmulatorReady(emulator: TerminalEmulator) {
    applyPalette()
    if (pendingOutput.isNotEmpty()) {
      val bytes = pendingOutput.toString().toByteArray(StandardCharsets.UTF_8)
      pendingOutput.setLength(0)
      emulator.append(bytes, bytes.size)
    }
    termView.onScreenUpdated()
  }

  private fun reportBrowsing() {
    val browsing = termView.topRow < 0
    if (browsing == reportedBrowsing) return
    reportedBrowsing = browsing
    onBrowsing(Bundle().apply { putBoolean("browsing", browsing) })
  }

  /**
   * 全屏应用（备用屏）没有本地回看：竖向拖动转成桌面端的滚轮刻度（与 iOS handleWheelPan 同义，
   * 约两行手指位移一格）。普通屏先用本地回看，wheelAtEdges 时越过两端才交给应用。
   * 能不能真的发给桌面由 JS 侧按归属与 write 权限决定。
   */
  private inner class ScrollHook : TerminalView.ConnectScrollHook {
    override fun onScrollRows(up: Boolean, rows: Int): Boolean {
      val emulator = session?.emulator ?: return true
      val byteStreamApp = emulator.isAlternateBufferActive
      if (!byteStreamApp) {
        val pastTop = up && termView.topRow <= termView.minTopRow
        val pastBottom = !up && termView.topRow >= 0
        if (!wheelAtEdges || !(pastTop || pastBottom)) {
          wheelCarry = 0
          return false
        }
      }
      wheelCarry += if (up) rows else -rows
      while (wheelCarry >= ROWS_PER_NOTCH) {
        onWheel(Bundle().apply { putString("direction", "up") })
        wheelCarry -= ROWS_PER_NOTCH
      }
      while (wheelCarry <= -ROWS_PER_NOTCH) {
        onWheel(Bundle().apply { putString("direction", "down") })
        wheelCarry += ROWS_PER_NOTCH
      }
      return true
    }

    override fun onTopRowChanged(topRow: Int) {
      reportBrowsing()
    }
  }

  private class BridgeSessionClient : TerminalSessionClient {
    var current: TerminalSession? = null
    var view: ConnectTerminalView? = null

    override fun onTextChanged(changedSession: TerminalSession) {
      if (changedSession !== current) return
      view?.termView?.onScreenUpdated()
    }

    override fun onTitleChanged(changedSession: TerminalSession) {}
    override fun onSessionFinished(finishedSession: TerminalSession) {}
    override fun onCopyTextToClipboard(session: TerminalSession, text: String) {}
    override fun onPasteTextFromClipboard(session: TerminalSession) {}
    override fun onBell(session: TerminalSession) {}
    override fun onColorsChanged(session: TerminalSession) {}
    override fun onTerminalCursorStateChange(state: Boolean) {}
    override fun getTerminalCursorStyle(): Int = TerminalEmulator.DEFAULT_TERMINAL_CURSOR_STYLE
    override fun logError(tag: String, message: String) {}
    override fun logWarn(tag: String, message: String) {}
    override fun logInfo(tag: String, message: String) {}
    override fun logDebug(tag: String, message: String) {}
    override fun logVerbose(tag: String, message: String) {}
    override fun logStackTraceWithMessage(tag: String, message: String, e: Exception) {}
    override fun logStackTrace(tag: String, e: Exception) {}
  }

  /** 输入不经此视图（React 组合键盘负责），全部回调走最小实现。 */
  private inner class BridgeViewClient : TerminalViewClient {
    override fun onScale(scale: Float): Float = 1.0f
    override fun onSingleTapUp(e: MotionEvent) {}
    override fun shouldBackButtonBeMappedToEscape(): Boolean = false
    override fun shouldEnforceCharBasedInput(): Boolean = true
    override fun shouldUseCtrlSpaceWorkaround(): Boolean = false
    override fun isTerminalViewSelected(): Boolean = false
    override fun copyModeChanged(copyMode: Boolean) {}
    override fun onKeyDown(keyCode: Int, e: KeyEvent, session: TerminalSession): Boolean = false
    override fun onKeyUp(keyCode: Int, e: KeyEvent): Boolean = false
    override fun onLongPress(event: MotionEvent): Boolean = false
    override fun readControlKey(): Boolean = false
    override fun readAltKey(): Boolean = false
    override fun readShiftKey(): Boolean = false
    override fun readFnKey(): Boolean = false
    override fun onCodePoint(codePoint: Int, ctrlDown: Boolean, session: TerminalSession): Boolean = false
    override fun onEmulatorSet() {
      session?.emulator?.let { onEmulatorReady(it) }
    }
    override fun logError(tag: String, message: String) {}
    override fun logWarn(tag: String, message: String) {}
    override fun logInfo(tag: String, message: String) {}
    override fun logDebug(tag: String, message: String) {}
    override fun logVerbose(tag: String, message: String) {}
    override fun logStackTraceWithMessage(tag: String, message: String, e: Exception) {}
    override fun logStackTrace(tag: String, e: Exception) {}
  }

  companion object {
    /** 与桌面端 altScrollback 同量级的回看行数。 */
    private const val TRANSCRIPT_ROWS = 2000
    /** 电脑宽度画面缩字号的下限（pt，同 iOS）。 */
    private const val READABLE_FONT_FLOOR = 11.0
    private val SYMBOL_FALLBACK_ASSETS = listOf(
      "fonts/NotoSansSymbols2-TerminalSubset.ttf",
      "fonts/NotoSansSymbols-TerminalSubset.ttf",
    )
    /** 约两行手指位移算一格滚轮（同 iOS）。 */
    private const val ROWS_PER_NOTCH = 2
  }
}
