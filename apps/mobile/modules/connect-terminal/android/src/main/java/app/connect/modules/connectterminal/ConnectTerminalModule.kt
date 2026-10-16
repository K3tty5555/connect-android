package app.connect.modules.connectterminal

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

/**
 * Connect 终端模块（Android）：
 * - protectFileComplete：终末画面缓存与 Office 预览的封存钩子（见 ../../index.ts）。
 *   Android 无按文件的 complete data protection 等价物；应用私有目录由沙箱 + FBE 保护，
 *   这里验证路径存在并返回 true；false 时 JS 侧按「封存失败」删文件不落盘。
 * - ConnectTerminalView：Termux terminal-view 的 Expo 封装（Canvas 自绘、吃 ptyData 字符流），
 *   与 iOS 的 SwiftTerm 视图同一契约。Termux 代码为 GPLv3 内嵌（android-vendor/，随安卓端开源）。
 */
class ConnectTerminalModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ConnectTerminal")

    Function("protectFileComplete") { path: String ->
      File(path).exists()
    }

    View(ConnectTerminalView::class) {
      Events("onFit", "onPainted", "onWheel", "onReady", "onBrowsing")

      Prop("fontFamily") { view: ConnectTerminalView, value: String ->
        view.setFontFamily(value)
      }
      Prop("preferredFontSize") { view: ConnectTerminalView, value: Double ->
        view.setPreferredFontSize(value)
      }
      Prop("palette") { view: ConnectTerminalView, value: Map<String, Any?> ->
        view.setPalette(value)
      }
      Prop("wheelAtEdges") { view: ConnectTerminalView, value: Boolean ->
        view.setWheelAtEdges(value)
      }
      Prop("probe") { _: ConnectTerminalView, _: Boolean ->
        // 演示/UI 测试标记；Android 视图暂不额外暴露
      }

      AsyncFunction("apply") { view: ConnectTerminalView, commands: List<Map<String, Any?>>, operationId: String? ->
        view.applyCommands(commands, operationId)
      }
      AsyncFunction("reset") { view: ConnectTerminalView ->
        view.resetTerminal()
      }
      AsyncFunction("setGeometry") { view: ConnectTerminalView, cols: Int, rows: Int ->
        view.setGeometry(cols, rows)
      }
      AsyncFunction("feed") { view: ConnectTerminalView, text: String ->
        view.feed(text)
      }
      AsyncFunction("markPainted") { view: ConnectTerminalView, operationId: String ->
        view.markPainted(operationId)
      }
      AsyncFunction("scrollToBottom") { view: ConnectTerminalView ->
        view.scrollToBottomNow()
      }
    }
  }
}
