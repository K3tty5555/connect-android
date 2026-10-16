import type { ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider, useSafeAreaFrame, useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * iPad 主区（标签条下方）的安全区边界（IPAD-DOUBLE-TOP-INSET-1013）。
 *
 * 标签条外层已经让出了状态栏。主区里的页面沿用手机写法 `SafeAreaView edges={['top', …]}`，
 * 而 safe-area-context 5.7 在 Fabric 下取的是**最近 Provider** 的安全区、不看自身位置；
 * 只有整窗一个 Provider 时，页面会在标签条下面再垫一个状态栏高。这里再包一层 Provider，
 * 原生侧按这块区域的真实位置重新计算（标签条下方 top 为 0），页面代码与手机布局都不用改。
 *
 * `initialMetrics` 只决定原生回报之前的首帧：顶部已被标签条消费；侧栏展开时左边也不贴屏幕边。
 */
export function TabletContentArea({
  children,
  sidebarVisible,
}: {
  children: ReactNode;
  sidebarVisible: boolean;
}): React.ReactElement {
  const insets = useSafeAreaInsets();
  const frame = useSafeAreaFrame();
  return (
    <SafeAreaProvider
      initialMetrics={{
        frame,
        insets: {
          top: 0,
          left: sidebarVisible ? 0 : insets.left,
          right: insets.right,
          bottom: insets.bottom,
        },
      }}
      style={styles.root}
    >
      {children}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
