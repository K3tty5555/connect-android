import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ClipboardPaste,
  CornerDownLeft,
  Delete,
  Keyboard,
  Smartphone,
} from 'lucide-react-native';
import type { TerminalShortcutBindings } from '../../../../src/shared/types';
import type { TerminalKeyModifiers } from '../../../../src/shared/terminalInput';
import { MotionPressable } from '../components/MotionPressable';
import { t } from '../i18n';
import { useReducedMotion } from '../theme/reducedMotion';
import type { ConnectTheme } from '../theme/theme';
import { RADIUS, SPACE } from '../theme/tokens';
import { encodeTerminalKey, type TerminalKeyName } from './terminalKeyEncoding';

type Modifier = 'ctrl' | 'alt' | 'shift' | 'meta';
type KeyIcon = typeof ArrowLeft;
type SemanticKey = {
  key: TerminalKeyName;
  label: string;
  Icon?: KeyIcon;
  weight?: number;
};
type RawKey = {
  raw: string;
  shifted?: string;
  label: string;
  weight?: number;
};
type KeySpec = SemanticKey | RawKey;

const semantic = (
  key: TerminalKeyName,
  label: string,
  options: { Icon?: KeyIcon; weight?: number } = {},
): SemanticKey => ({ key, label, ...options });
const raw = (value: string, shifted: string, label: string): RawKey => ({
  raw: value,
  shifted,
  label,
});

const NAVIGATION_ROWS: readonly (readonly SemanticKey[])[] = [
  [semantic('escape', 'Esc'), semantic('tab', 'Tab'), semantic('home', 'Home'), semantic('end', 'End')],
  [semantic('insert', 'Ins'), semantic('delete', 'Del'), semantic('page-up', 'PgUp'), semantic('page-down', 'PgDn')],
  [semantic('f1', 'F1'), semantic('f2', 'F2'), semantic('f3', 'F3'), semantic('f4', 'F4')],
  [semantic('f5', 'F5'), semantic('f6', 'F6'), semantic('f7', 'F7'), semantic('f8', 'F8')],
  [semantic('f9', 'F9'), semantic('f10', 'F10'), semantic('f11', 'F11'), semantic('f12', 'F12')],
  [
    semantic('arrow-left', 'Left', { Icon: ArrowLeft }),
    semantic('arrow-down', 'Down', { Icon: ArrowDown }),
    semantic('arrow-up', 'Up', { Icon: ArrowUp }),
    semantic('arrow-right', 'Right', { Icon: ArrowRight }),
  ],
];

const TYPING_ROWS: readonly (readonly KeySpec[])[] = [
  [
    raw('-', '_', '-  _'), raw('=', '+', '=  +'), raw('[', '{', '[  {'), raw(']', '}', ']  }'),
    raw('\\', '|', '\\  |'), raw(';', ':', ';  :'), raw("'", '"', "'  \""), raw(',', '<', ',  <'),
    raw('.', '>', '.  >'), raw('/', '?', '/  ?'),
  ],
  [...(['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'] as const)
    .map((key) => semantic(key, key))],
  [...(['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'] as const)
    .map((key) => semantic(key, key.toUpperCase()))],
  [
    ...(['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'] as const)
      .map((key) => semantic(key, key.toUpperCase())),
    semantic('backspace', 'Backspace', { Icon: Delete, weight: 1.35 }),
  ],
  [
    ...(['z', 'x', 'c', 'v', 'b', 'n', 'm'] as const)
      .map((key) => semantic(key, key.toUpperCase())),
    semantic('space', 'Space', { weight: 2.2 }),
    semantic('enter', 'Enter', { Icon: CornerDownLeft, weight: 1.35 }),
  ],
];

const MODIFIERS: readonly { key: Modifier; label: string }[] = [
  { key: 'ctrl', label: 'Ctrl' },
  { key: 'shift', label: 'Shift' },
  { key: 'alt', label: 'Alt' },
  { key: 'meta', label: 'Cmd' },
];

const SHORTCUT_LABELS = {
  interrupt: '中断',
  eof: 'EOF',
  cancel: '取消',
} as const;

const CONTROL_PUNCTUATION: Readonly<Record<string, string>> = {
  '[': '\x1b',
  '\\': '\x1c',
  ']': '\x1d',
  _: '\x1f',
  '?': '\x7f',
};

export function FullTerminalKeyboard({
  onInput,
  onKey,
  onUseSystemInput,
  onPaste,
  theme,
  shortcutBindings,
  queueDepth = 0,
}: {
  onInput(data: string): void;
  onKey?(key: TerminalKeyName, modifiers: TerminalKeyModifiers): void;
  onUseSystemInput(): void;
  onPaste?(): void;
  theme: ConnectTheme;
  shortcutBindings?: TerminalShortcutBindings;
  queueDepth?: number;
}): React.ReactElement {
  const styles = createStyles(theme);
  const reducedMotion = useReducedMotion();
  const pager = useRef<ScrollView>(null);
  const [pageWidth, setPageWidth] = useState(1);
  const [activePage, setActivePage] = useState<0 | 1>(0);
  const [modifiers, setModifiers] = useState<Record<Modifier, boolean>>({
    ctrl: false,
    alt: false,
    shift: false,
    meta: false,
  });
  const modifierState = useMemo(() => ({ ...modifiers }), [modifiers]);
  const resetModifiers = (): void => {
    setModifiers({ ctrl: false, alt: false, shift: false, meta: false });
  };
  const pressSemanticKey = (key: TerminalKeyName): void => {
    const data = encodeTerminalKey(key, modifierState);
    if (onKey !== undefined) onKey(key, modifierState);
    else if (data.length > 0) onInput(data);
    resetModifiers();
  };
  const pressRawKey = ({ raw: value, shifted }: RawKey): void => {
    const character = modifierState.shift && shifted !== undefined ? shifted : value;
    const controlled = modifierState.ctrl ? CONTROL_PUNCTUATION[character] : undefined;
    onInput(`${modifierState.alt ? '\x1b' : ''}${controlled ?? character}`);
    resetModifiers();
  };
  const goToPage = useCallback((page: 0 | 1): void => {
    setActivePage(page);
    pager.current?.scrollTo({ x: page * pageWidth, animated: !reducedMotion });
  }, [pageWidth, reducedMotion]);
  const updatePage = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>): void => {
    const next = Math.round(event.nativeEvent.contentOffset.x / Math.max(1, pageWidth));
    setActivePage(next <= 0 ? 0 : 1);
  }, [pageWidth]);
  const updateWidth = useCallback((event: LayoutChangeEvent): void => {
    const width = Math.max(1, event.nativeEvent.layout.width);
    setPageWidth(width);
    pager.current?.scrollTo({ x: activePage * width, animated: false });
  }, [activePage]);

  const renderKey = (keySpec: KeySpec, typing = false): React.ReactElement => {
    const isSemantic = 'key' in keySpec;
    const Icon = isSemantic ? keySpec.Icon : undefined;
    const id = isSemantic ? keySpec.key : keySpec.raw;
    return (
      <MotionPressable
        accessibilityLabel={keySpec.label}
        accessibilityRole="button"
        key={id}
        onPress={() => {
          if (isSemantic) pressSemanticKey(keySpec.key);
          else pressRawKey(keySpec);
        }}
        style={[
          styles.key,
          typing ? styles.typingKey : null,
          { flex: keySpec.weight ?? 1 },
        ]}
      >
        {Icon
          ? <Icon color={theme.colors.text2} size={19} />
          : <Text allowFontScaling={false} adjustsFontSizeToFit minimumFontScale={0.72} numberOfLines={1} style={styles.keyLabel}>{keySpec.label}</Text>}
      </MotionPressable>
    );
  };

  return (
    <View accessibilityLabel="Full Keyboard Mode" style={styles.container}>
      <View style={styles.header}>
        <View accessibilityRole="tablist" style={styles.pageTabs}>
          {([
            { page: 0 as const, label: t('导航键盘'), short: t('导航') },
            { page: 1 as const, label: t('输入键盘'), short: t('输入') },
          ]).map(({ page, label, short }) => (
            <MotionPressable
              accessibilityLabel={label}
              accessibilityRole="tab"
              accessibilityState={{ selected: activePage === page }}
              key={page}
              onPress={() => goToPage(page)}
              style={[styles.pageTab, activePage === page ? styles.pageTabSelected : null]}
            >
              {page === 0
                ? <Keyboard color={activePage === page ? theme.colors.text : theme.colors.text3} size={15} />
                : null}
              <Text allowFontScaling={false} style={[styles.pageTabLabel, activePage === page ? styles.pageTabLabelSelected : null]}>{short}</Text>
            </MotionPressable>
          ))}
        </View>
        {queueDepth > 0 ? <Text allowFontScaling={false} style={styles.queueLabel}>{t('排队中 {count}', { count: queueDepth })}</Text> : null}
        <View style={styles.headerActions}>
          <MotionPressable
            accessibilityLabel={t('简易键盘')}
            accessibilityRole="button"
            onPress={onUseSystemInput}
            style={styles.headerButton}
          >
            <Smartphone color={theme.colors.accent} size={18} />
          </MotionPressable>
          {onPaste ? (
            <MotionPressable
              accessibilityLabel={t('粘贴')}
              accessibilityRole="button"
              onPress={onPaste}
              style={styles.headerButton}
              testID="full-keyboard-paste"
            >
              <ClipboardPaste color={theme.colors.text2} size={18} />
            </MotionPressable>
          ) : null}
        </View>
      </View>
      {shortcutBindings ? (
        <View style={styles.shortcutRow}>
          {(['interrupt', 'eof', 'cancel'] as const).map((action) => (
            <MotionPressable
              accessibilityLabel={`${t(SHORTCUT_LABELS[action])} Ctrl+${shortcutBindings[action].toUpperCase()}`}
              accessibilityRole="button"
              key={action}
              onPress={() => {
                if (onKey !== undefined) onKey(shortcutBindings[action], { ctrl: true });
                else onInput(encodeTerminalKey(shortcutBindings[action], { ctrl: true }));
              }}
              style={styles.shortcutKey}
            >
              <Text allowFontScaling={false} adjustsFontSizeToFit minimumFontScale={0.8} numberOfLines={1} style={styles.shortcutLabel}>
                {t(SHORTCUT_LABELS[action])} · Ctrl+{shortcutBindings[action].toUpperCase()}
              </Text>
            </MotionPressable>
          ))}
        </View>
      ) : null}
      <View style={styles.modifierRow}>
        {MODIFIERS.map(({ key, label }) => (
          <MotionPressable
            accessibilityLabel={label}
            accessibilityRole="button"
            accessibilityState={{ selected: modifiers[key] }}
            key={key}
            onPress={() => setModifiers((current) => ({ ...current, [key]: !current[key] }))}
            style={[styles.modifier, modifiers[key] ? styles.modifierSelected : null]}
          >
            <Text allowFontScaling={false} style={[styles.keyLabel, modifiers[key] ? styles.modifierLabelSelected : null]}>{label}</Text>
          </MotionPressable>
        ))}
      </View>
      <View onLayout={updateWidth} style={styles.pagerViewport}>
        <ScrollView
          bounces={false}
          decelerationRate="fast"
          directionalLockEnabled
          horizontal
          onMomentumScrollEnd={updatePage}
          onScrollEndDrag={updatePage}
          pagingEnabled
          ref={pager}
          showsHorizontalScrollIndicator={false}
          testID="full-keyboard-pager"
        >
          <View
            accessibilityElementsHidden={activePage !== 0}
            importantForAccessibility={activePage === 0 ? 'auto' : 'no-hide-descendants'}
            style={[styles.page, { width: pageWidth }]}
          >
            {NAVIGATION_ROWS.map((row, rowIndex) => (
              <View key={`navigation-row-${rowIndex}`} style={styles.row}>
                {row.map((keySpec) => renderKey(keySpec))}
              </View>
            ))}
          </View>
          <View
            accessibilityElementsHidden={activePage !== 1}
            importantForAccessibility={activePage === 1 ? 'auto' : 'no-hide-descendants'}
            style={[styles.page, { width: pageWidth }]}
          >
            {TYPING_ROWS.map((row, rowIndex) => (
              <View key={`typing-row-${rowIndex}`} style={styles.typingRow}>
                {row.map((keySpec) => renderKey(keySpec, true))}
              </View>
            ))}
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

function createStyles(theme: ConnectTheme) {
  return StyleSheet.create({
    container: {
      paddingHorizontal: SPACE.x2,
      paddingTop: SPACE.x2,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.line,
      backgroundColor: theme.colors.panel2,
    },
    header: {
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACE.x2,
    },
    headerActions: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: SPACE.x1 },
    headerButton: {
      width: 44,
      height: 44,
      borderRadius: RADIUS.control,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pageTabs: {
      height: 36,
      padding: 2,
      borderWidth: 1,
      borderColor: theme.colors.line,
      borderRadius: RADIUS.control,
      backgroundColor: theme.colors.panel,
      flexDirection: 'row',
      alignItems: 'center',
    },
    pageTab: {
      minWidth: 64,
      height: 30,
      paddingHorizontal: SPACE.x2,
      borderRadius: RADIUS.control - 2,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: SPACE.x1,
    },
    pageTabSelected: { backgroundColor: theme.colors.line },
    pageTabLabel: { color: theme.colors.text3, fontSize: 12, fontWeight: '600' },
    pageTabLabelSelected: { color: theme.colors.text, fontWeight: '700' },
    queueLabel: { color: theme.colors.warn, fontSize: 11, fontWeight: '600' },
    shortcutRow: { flexDirection: 'row', gap: SPACE.x1, paddingTop: SPACE.x1 },
    shortcutKey: {
      flex: 1,
      minWidth: 0,
      height: 44,
      borderWidth: 1,
      borderColor: theme.colors.line2,
      borderRadius: RADIUS.control,
      backgroundColor: theme.colors.panel,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: SPACE.x1,
    },
    shortcutLabel: { color: theme.colors.text2, fontSize: 11, fontWeight: '700' },
    modifierRow: { flexDirection: 'row', gap: SPACE.x1, paddingVertical: SPACE.x1 },
    modifier: {
      flex: 1,
      minWidth: 0,
      height: 44,
      borderWidth: 1,
      borderColor: theme.colors.line2,
      borderRadius: RADIUS.control,
      backgroundColor: theme.colors.panel,
      alignItems: 'center',
      justifyContent: 'center',
    },
    modifierSelected: { borderColor: theme.colors.accent, backgroundColor: theme.colors.bg },
    modifierLabelSelected: { color: theme.colors.accent },
    pagerViewport: { height: 288, overflow: 'hidden' },
    page: { height: 288, gap: SPACE.x1, justifyContent: 'center' },
    row: { height: 44, flexDirection: 'row', gap: SPACE.x1, width: '100%' },
    typingRow: { height: 52, flexDirection: 'row', gap: 3, width: '100%' },
    key: {
      minWidth: 0,
      height: 44,
      paddingHorizontal: SPACE.x1,
      borderWidth: 1,
      borderColor: theme.colors.line2,
      borderRadius: RADIUS.control,
      backgroundColor: theme.colors.panel,
      alignItems: 'center',
      justifyContent: 'center',
    },
    typingKey: { height: 52, paddingHorizontal: 2 },
    keyLabel: { color: theme.colors.text2, fontSize: 12, fontWeight: '700' },
  });
}
