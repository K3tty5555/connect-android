import { StyleSheet, Text, View } from 'react-native';
import type { ConnectTheme } from '../theme/theme';
import { MAX_COMPACT_FONT_SCALE, RADIUS, SPACE } from '../theme/tokens';
import { MotionPressable } from './MotionPressable';

/** 与设置页分段控件同形的标签切换（项目页「会话 / 文件」、iPad 侧栏「项目 / 文件」）。 */
export function SegmentedTabs<T extends string>({
  options,
  value,
  theme,
  onChange,
  testID,
}: {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  theme: ConnectTheme;
  onChange(value: T): void;
  testID?: string;
}): React.ReactElement {
  const styles = createStyles(theme);
  return (
    <View accessibilityRole="tablist" style={styles.root} testID={testID}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <MotionPressable
            accessibilityLabel={option.label}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            feedback={selected ? undefined : 'selection'}
            key={option.value}
            onPress={() => onChange(option.value)}
            style={[styles.segment, selected ? styles.segmentSelected : null]}
          >
            <Text
              maxFontSizeMultiplier={MAX_COMPACT_FONT_SCALE}
              numberOfLines={1}
              style={[styles.label, selected ? styles.labelSelected : null]}
            >
              {option.label}
            </Text>
          </MotionPressable>
        );
      })}
    </View>
  );
}

function createStyles(theme: ConnectTheme) {
  return StyleSheet.create({
    root: {
      minHeight: 40,
      padding: 3,
      borderWidth: 1,
      borderColor: theme.colors.line,
      borderRadius: RADIUS.control,
      backgroundColor: theme.colors.panel,
      flexDirection: 'row',
      gap: SPACE.x1,
    },
    segment: {
      minWidth: 0,
      minHeight: 32,
      flex: 1,
      borderRadius: RADIUS.control - 2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    segmentSelected: { backgroundColor: theme.colors.panel2 },
    label: { color: theme.colors.text3, fontSize: 13, fontWeight: '600' },
    labelSelected: { color: theme.colors.text },
  });
}
