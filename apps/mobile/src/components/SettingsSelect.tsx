import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Check, ChevronDown, ChevronUp } from 'lucide-react-native';
import type { ConnectTheme } from '../theme/theme';
import { MAX_COMPACT_FONT_SCALE, RADIUS, SPACE } from '../theme/tokens';
import { MotionPressable } from './MotionPressable';

export interface SettingsSelectOption<Value> {
  value: Value;
  label: string;
  description?: string;
}

/**
 * One setting as a row that opens into its choices.
 *
 * Collapsed, the row names the setting, says in one line what it does and
 * shows the current choice. Opened, every choice carries its own line, so the
 * difference between them is read where it is chosen, not in a manual.
 */
export function SettingsSelect<Value extends string | boolean>({
  title,
  description,
  value,
  options,
  disabled = false,
  onChange,
  theme,
}: {
  title: string;
  description?: string;
  value: Value;
  options: ReadonlyArray<SettingsSelectOption<Value>>;
  disabled?: boolean;
  onChange(value: Value): void;
  theme: ConnectTheme;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const styles = createStyles(theme);
  const current = options.find((option) => option.value === value) ?? options[0];
  const Chevron = open ? ChevronUp : ChevronDown;
  return (
    <View style={styles.container}>
      <MotionPressable
        accessibilityHint={description}
        accessibilityLabel={`${title}, ${current?.label ?? ''}`}
        accessibilityRole="button"
        accessibilityState={{ expanded: open, disabled }}
        disabled={disabled}
        onPress={() => setOpen((previous) => !previous)}
        style={[styles.header, disabled ? styles.disabled : null]}
      >
        <View style={styles.text}>
          <Text maxFontSizeMultiplier={MAX_COMPACT_FONT_SCALE} style={styles.title}>{title}</Text>
          {description ? (
            <Text maxFontSizeMultiplier={MAX_COMPACT_FONT_SCALE} style={styles.description}>
              {description}
            </Text>
          ) : null}
        </View>
        <Text maxFontSizeMultiplier={MAX_COMPACT_FONT_SCALE} numberOfLines={1} style={styles.value}>
          {current?.label}
        </Text>
        <Chevron color={theme.colors.text3} size={16} />
      </MotionPressable>
      {open ? (
        <View accessibilityRole="radiogroup" style={styles.options}>
          {options.map((option) => {
            const selected = option.value === value;
            return (
              <MotionPressable
                accessibilityHint={option.description}
                accessibilityLabel={option.label}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected, disabled }}
                disabled={disabled}
                key={String(option.value)}
                onPress={() => {
                  setOpen(false);
                  if (!selected) onChange(option.value);
                }}
                style={[styles.option, selected ? styles.optionSelected : null]}
              >
                <View style={styles.text}>
                  <Text
                    maxFontSizeMultiplier={MAX_COMPACT_FONT_SCALE}
                    style={[styles.optionLabel, selected ? styles.optionLabelSelected : null]}
                  >
                    {option.label}
                  </Text>
                  {option.description ? (
                    <Text maxFontSizeMultiplier={MAX_COMPACT_FONT_SCALE} style={styles.description}>
                      {option.description}
                    </Text>
                  ) : null}
                </View>
                {selected ? <Check color={theme.colors.accent} size={15} /> : null}
              </MotionPressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

function createStyles(theme: ConnectTheme) {
  return StyleSheet.create({
    container: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.line,
    },
    header: {
      minHeight: 56,
      paddingVertical: SPACE.x2,
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACE.x2,
    },
    disabled: { opacity: 0.5 },
    text: { flex: 1, minWidth: 0, gap: 2 },
    title: { color: theme.colors.text, fontSize: 14, fontWeight: '600' },
    description: { color: theme.colors.text3, fontSize: 12 },
    value: {
      maxWidth: '45%',
      color: theme.colors.text2,
      fontSize: 14,
      textAlign: 'right',
    },
    options: { paddingBottom: SPACE.x2, gap: SPACE.x1 },
    option: {
      minHeight: 48,
      paddingVertical: SPACE.x2,
      paddingHorizontal: SPACE.x3,
      borderRadius: RADIUS.control,
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACE.x2,
    },
    optionSelected: { backgroundColor: theme.colors.panel2 },
    optionLabel: { color: theme.colors.text2, fontSize: 14, fontWeight: '600' },
    optionLabelSelected: { color: theme.colors.text },
  });
}
