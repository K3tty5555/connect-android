import 'react-native-gesture-handler/jestSetup';

/**
 * 测试期间任何未白名单的 `console.error` 都判失败。
 *
 * 2026-09-15 验收 P3-05：移动全量测试 exit 0，却稳定输出两条
 * `You seem to have overlapping act() calls`。绿灯夹带告警会让未来真实的异步
 * 竞态告警被同类噪声淹没——React 的生命周期与 act 告警走的正是 `console.error`，
 * 而 Jest 默认不把它当失败。这里把它提升为失败信号。
 *
 * 白名单是精确子串匹配，且**故意留空**：加守门时实测全量移动测试零未白名单告警。
 * 新增条目必须写明来源以及为什么不能修，不得用来静默自己写出来的告警。
 */
const ALLOWED_CONSOLE_ERROR_SUBSTRINGS: readonly string[] = [];

const formatConsoleArg = (arg: unknown): string => {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return arg.message;
  try {
    return String(arg);
  } catch {
    return '[unprintable]';
  }
};

const originalConsoleError = console.error;
let unexpectedConsoleErrors: string[] = [];

beforeEach(() => {
  unexpectedConsoleErrors = [];
  console.error = (...args: unknown[]): void => {
    const message = args.map(formatConsoleArg).join(' ');
    if (!ALLOWED_CONSOLE_ERROR_SUBSTRINGS.some((allowed) => message.includes(allowed))) {
      unexpectedConsoleErrors.push(message);
    }
    // 仍然原样输出，便于定位；失败信息只负责让它不再被忽略。
    originalConsoleError(...(args as Parameters<typeof console.error>));
  };
});

afterEach(() => {
  console.error = originalConsoleError;
  const captured = unexpectedConsoleErrors;
  unexpectedConsoleErrors = [];
  if (captured.length === 0) return;
  throw new Error(
    `测试期间出现 ${captured.length} 条未白名单的 console.error：\n${captured.join('\n')}`,
  );
});

jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native');
  class AnimationBuilder {
    duration(): this { return this; }
    easing(): this { return this; }
    reduceMotion(): this { return this; }
  }
  return {
    __esModule: true,
    default: {
      View,
      createAnimatedComponent: (Component: unknown) => Component,
    },
    Easing: { bezier: jest.fn(() => jest.fn()) },
    Keyframe: AnimationBuilder,
    LinearTransition: AnimationBuilder,
    ReduceMotion: { System: 'system', Always: 'always', Never: 'never' },
    ReducedMotionConfig: jest.fn(() => null),
    useAnimatedStyle: (factory: () => unknown) => factory(),
    useSharedValue: (value: unknown) => ({ value }),
    withTiming: (value: unknown) => value,
  };
});

jest.mock('expo-haptics', () => ({
  ImpactFeedbackStyle: { Light: 'light' },
  impactAsync: jest.fn(async () => undefined),
  selectionAsync: jest.fn(async () => undefined),
}));

// 文件查看器的 PDF 预览用 WebView；没有原生模块的测试环境给一个透明替身。
// 需要断言 WebView 交互的测试文件仍各自 jest.mock 覆盖它。
jest.mock('react-native-webview', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    WebView: React.forwardRef((props: Record<string, unknown>, _ref: React.Ref<unknown>) => (
      React.createElement(View, props)
    )),
  };
});

jest.mock('@gorhom/bottom-sheet', () => {
  const React = require('react');
  const { FlatList, ScrollView, TextInput, View } = require('react-native');
  const PassThrough = ({ children }: { children: React.ReactNode }) =>
    React.createElement(View, null, children);
  const BottomSheetModal = React.forwardRef(({
    children,
    enableBlurKeyboardOnGesture,
    keyboardBlurBehavior,
    onDismiss,
    overrideReduceMotion,
  }: {
    children: React.ReactNode;
    enableBlurKeyboardOnGesture?: boolean;
    keyboardBlurBehavior?: string;
    onDismiss?(): void;
    overrideReduceMotion?: string;
  }, ref: React.Ref<unknown>) => {
    const [open, setOpen] = React.useState(false);
    React.useImperativeHandle(ref, () => ({
      present: () => setOpen(true),
      dismiss: () => {
        setOpen(false);
        onDismiss?.();
      },
    }));
    return open ? React.createElement(View, {
      testID: 'bottom-sheet-modal',
      enableBlurKeyboardOnGesture,
      keyboardBlurBehavior,
      overrideReduceMotion,
    }, children) : null;
  });
  return {
    __esModule: true,
    BottomSheetBackdrop: PassThrough,
    BottomSheetFlatList: FlatList,
    BottomSheetScrollView: ScrollView,
    BottomSheetTextInput: TextInput,
    BottomSheetModal,
    BottomSheetModalProvider: ({ children }: { children: React.ReactNode }) => children,
  };
});

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

jest.mock('react-native-keyboard-controller', () => {
  const React = require('react');
  const { Pressable, ScrollView, Text, View } = require('react-native');
  const PassThrough = ({ children }: { children: React.ReactNode }) =>
    React.createElement(View, null, children);
  const scrollToEnd = jest.fn();
  const KeyboardChatScrollView = React.forwardRef(
    (
      {
        children,
        ...props
      }: { children: React.ReactNode; [key: string]: unknown },
      ref: React.Ref<unknown>,
    ) => {
      React.useImperativeHandle(ref, () => ({ scrollToEnd }));
      return React.createElement(ScrollView, props, children);
    },
  );
  const KeyboardToolbar = ({ children }: { children: React.ReactNode }) =>
    React.createElement(View, { testID: 'keyboard-toolbar' }, children);
  KeyboardToolbar.Content = PassThrough;
  KeyboardToolbar.Done = ({ text }: { text: string }) => React.createElement(
    Pressable,
    { accessibilityLabel: text, accessibilityRole: 'button' },
    React.createElement(Text, null, text),
  );
  return {
    KeyboardEvents: { addListener: jest.fn(() => ({ remove: jest.fn() })) },
    KeyboardProvider: PassThrough,
    KeyboardAvoidingView: ({ children, ...props }: {
      children: React.ReactNode;
      [key: string]: unknown;
    }) => React.createElement(
      View,
      { testID: 'keyboard-avoiding-view', ...props },
      children,
    ),
    KeyboardStickyView: PassThrough,
    KeyboardChatScrollView,
    useKeyboardState: jest.fn(() => false),
    KeyboardToolbar,
    KeyboardController: {
      dismiss: jest.fn(async () => undefined),
      isVisible: jest.fn(() => false),
      preload: jest.fn(),
    },
    __keyboardScrollToEndMock: scrollToEnd,
  };
});
