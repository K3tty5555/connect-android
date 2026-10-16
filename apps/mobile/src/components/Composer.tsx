import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  AtSign,
  ClipboardPaste,
  ChevronDown,
  Grid3x3,
  ImagePlus,
  Keyboard,
  X,
} from 'lucide-react-native';
import type { PreparedRoomImage } from '../domain/roomImageTransfer';
import {
  operationPresentation,
  type OperationPhase,
} from '../domain/operationPresentation';
import type { ConnectTheme } from '../theme/theme';
import { MAX_COMPACT_FONT_SCALE, RADIUS, SPACE } from '../theme/tokens';
import { MotionPressable } from './MotionPressable';
import { KindIcon } from './KindIcon';
import { t } from '../i18n';

const MAX_DRAFT_CHARS = 4000;
const INPUT_FONT_SIZE = 15;
const INPUT_MIN_HEIGHT = 40;

/**
 * An empty multiline input is sized by its (empty) text, not its placeholder,
 * so it sits at minHeight. A fixed 40 leaves 24pt between the paddings — enough
 * for 15pt, not for the 30pt the compact cap allows, whose descenders were cut.
 */
export function composerInputMinHeight(fontScale: number): number {
  const font = INPUT_FONT_SIZE * Math.min(Math.max(fontScale, 1), MAX_COMPACT_FONT_SCALE);
  return Math.max(INPUT_MIN_HEIGHT, SPACE.x2 * 2 + Math.ceil(font * 1.25));
}
const NATIVE_SUBMIT_SENTINEL_CHARS = 2;
const MENTION_MEMBERS = [
  { id: 'all', label: '所有人' },
  { id: 'claude', label: 'Claude' },
  { id: 'codex', label: 'Codex' },
] as const;

function mentionContext(value: string): { at: number; query: string } | null {
  const match = /(?:^|\s)@([^\s@]{0,12})$/u.exec(value);
  if (!match || match.index === undefined) return null;
  const at = match.index + (match[0].startsWith('@') ? 0 : 1);
  return { at, query: match[1] ?? '' };
}

function stripTrailingLineBreak(value: string): string | null {
  if (value.endsWith('\r\n')) return value.slice(0, -2);
  if (value.endsWith('\r') || value.endsWith('\n')) return value.slice(0, -1);
  return null;
}

function limitDraft(value: string): string {
  if (value.length <= MAX_DRAFT_CHARS) return value;
  let end = MAX_DRAFT_CHARS;
  const last = value.charCodeAt(end - 1);
  const next = value.charCodeAt(end);
  if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end -= 1;
  return value.slice(0, end);
}

export interface ComposerProps {
  value: string;
  enabled: boolean;
  operationStatus?: OperationPhase;
  images?: readonly PreparedRoomImage[];
  imagePickPending?: boolean;
  mentionsEnabled?: boolean;
  theme: ConnectTheme;
  onChangeText(value: string): void;
  onDismissKeyboard?(): void;
  /** Swaps the system keyboard for Connect's on-screen full terminal keyboard. */
  onFullKeyboard?(): void;
  onPaste?(): void;
  quickKeysAvailable?: boolean;
  quickKeysExpanded?: boolean;
  onQuickKeysToggle?(): void;
  onFocus?(): void;
  onPickImages?(): void;
  onRemoveImage?(id: string): void;
  onSend(value: string): void;
}

export function Composer({
  value,
  enabled,
  operationStatus = 'idle',
  images = [],
  imagePickPending = false,
  mentionsEnabled = false,
  theme,
  onChangeText,
  onDismissKeyboard,
  onFullKeyboard,
  onPaste,
  quickKeysAvailable = false,
  quickKeysExpanded = false,
  onQuickKeysToggle,
  onFocus,
  onPickImages,
  onRemoveImage,
  onSend,
}: ComposerProps): React.ReactElement {
  const { fontScale } = useWindowDimensions();
  const styles = createStyles(theme);
  const operation = operationPresentation(operationStatus);
  const pending = operation.busy;
  const [mentionMenuForced, setMentionMenuForced] = useState(false);
  const [nativeValue, setNativeValue] = useState(value);
  const latestValue = useRef(value);
  const submittedValue = useRef<string | null>(null);
  const wasPending = useRef(pending);
  if (
    wasPending.current
    && !pending
    && submittedValue.current === value
  ) submittedValue.current = null;
  wasPending.current = pending;
  useEffect(() => {
    latestValue.current = value;
    setNativeValue(value);
  }, [value]);

  const submit = (candidate = latestValue.current) => {
    if (
      pending
      || operationStatus === 'ambiguous'
      || !enabled
      || (candidate.trim().length === 0 && images.length === 0)
      || submittedValue.current === candidate
    ) return;
    setMentionMenuForced(false);
    submittedValue.current = candidate;
    onSend(candidate);
  };

  const changeDraft = (nextValue: string) => {
    const previousValue = latestValue.current;
    if (nextValue === previousValue) return;
    const nativeSubmitCandidate = stripTrailingLineBreak(nextValue);
    if (nativeSubmitCandidate !== null) {
      const candidate = limitDraft(nativeSubmitCandidate);
      latestValue.current = candidate;
      setNativeValue(candidate);
      submit(candidate);
      return;
    }
    if (!pending) submittedValue.current = null;
    const limitedValue = limitDraft(nextValue);
    latestValue.current = limitedValue;
    setNativeValue(limitedValue);
    onChangeText(limitedValue);
  };

  const openMentionMenu = () => {
    if (mentionContext(latestValue.current) === null) {
      const separator = latestValue.current.length > 0 && !/\s$/u.test(latestValue.current) ? ' ' : '';
      const nextValue = `${latestValue.current}${separator}@`;
      latestValue.current = nextValue;
      setNativeValue(nextValue);
      onChangeText(nextValue);
    }
    setMentionMenuForced(true);
  };

  const insertMention = (label: string) => {
    const current = latestValue.current;
    const context = mentionContext(current);
    const prefix = context === null
      ? `${current}${current.length > 0 && !/\s$/u.test(current) ? ' ' : ''}`
      : current.slice(0, context.at);
    const nextValue = limitDraft(`${prefix}@${label} `);
    latestValue.current = nextValue;
    setNativeValue(nextValue);
    submittedValue.current = null;
    setMentionMenuForced(false);
    onChangeText(nextValue);
  };

  const currentMention = mentionsEnabled ? mentionContext(nativeValue) : null;
  const mentionCandidates = mentionsEnabled && (mentionMenuForced || currentMention !== null)
    ? MENTION_MEMBERS.filter((member) => (
      currentMention === null
      || member.label.toLocaleLowerCase().startsWith(currentMention.query.toLocaleLowerCase())
    ))
    : [];

  return (
    <View style={styles.container}>
      {mentionCandidates.length > 0 ? (
        <View accessibilityLabel={t('可提及的成员')} style={styles.mentionMenu}>
          {mentionCandidates.map((member) => (
            <MotionPressable
              accessibilityLabel={t('提及 {member}', { member: t(member.label) })}
              accessibilityRole="button"
              key={member.id}
              onPress={() => insertMention(member.label)}
              style={styles.mentionRow}
            >
              <View style={styles.mentionIcon}>
                {member.id === 'all' ? (
                  <AtSign color={theme.colors.text2} size={20} />
                ) : (
                  <KindIcon kind={member.id} size={20} theme={theme} />
                )}
              </View>
              <Text style={styles.mentionLabel}>{t(member.label)}</Text>
            </MotionPressable>
          ))}
        </View>
      ) : null}
      {images.length > 0 ? (
        <View accessibilityLabel={t('已选择 {count} 张图片', { count: images.length })} style={styles.imageStrip}>
          {images.map((image, index) => (
            <View key={image.id} style={styles.imagePreview}>
              <Image
                accessibilityLabel={t('待发送图片 {index}', { index: index + 1 })}
                source={{ uri: image.uri }}
                style={styles.image}
              />
              <MotionPressable
                accessibilityLabel={t('删除待发送图片 {index}', { index: index + 1 })}
                accessibilityRole="button"
                disabled={pending}
                onPress={() => onRemoveImage?.(image.id)}
                style={styles.removeImage}
              >
                <X color={theme.colors.text} size={15} />
              </MotionPressable>
            </View>
          ))}
        </View>
      ) : null}
      <View style={styles.inputFrame}>
        <TextInput
          accessibilityLabel={t('消息或命令')}
          maxFontSizeMultiplier={MAX_COMPACT_FONT_SCALE}
          editable={enabled}
          maxLength={MAX_DRAFT_CHARS + NATIVE_SUBMIT_SENTINEL_CHARS}
          multiline
          onKeyPress={(event) => {
            const key = event.nativeEvent.key.toLocaleLowerCase();
            if (key === 'enter' || key === 'return') submit(latestValue.current);
          }}
          onChangeText={changeDraft}
          onFocus={onFocus}
          onSubmitEditing={(event) => {
            const eventText = event.nativeEvent.text || latestValue.current;
            const stripped = eventText === latestValue.current
              ? null
              : stripTrailingLineBreak(eventText);
            const candidate = limitDraft(stripped ?? eventText);
            latestValue.current = candidate;
            setNativeValue(candidate);
            submit(candidate);
          }}
          placeholder={t('输入消息或命令')}
          placeholderTextColor={theme.colors.text3}
          returnKeyType="send"
          // A multiline input defaults to 'newline', which swallows
          // onSubmitEditing while returnKeyType still advertises a send key —
          // third-party IMEs such as 微信输入法 render their own send affordance
          // from that declaration and it would do nothing. 'submit' honours the
          // press without blurring, so the keyboard stays up for the next line.
          submitBehavior="submit"
          style={[styles.input, { minHeight: composerInputMinHeight(fontScale) }]}
          value={nativeValue}
        />
      </View>
      <View style={styles.toolbar}>
        <View style={styles.leadingActions}>
          {onPaste ? (
            <MotionPressable
              accessibilityLabel="Paste"
              accessibilityRole="button"
              accessibilityState={{ disabled: pending || !enabled }}
              disabled={pending || !enabled}
              hitSlop={SPACE.x1}
              onPress={onPaste}
              style={styles.action}
              testID="composer-paste"
            >
              <ClipboardPaste color={theme.colors.text2} size={21} />
            </MotionPressable>
          ) : null}
          {onPickImages ? (
            <MotionPressable
              accessibilityLabel={imagePickPending ? t('正在选择图片') : t('选择图片')}
              accessibilityRole="button"
              accessibilityState={{ busy: imagePickPending, disabled: pending || imagePickPending }}
              disabled={pending || imagePickPending}
              hitSlop={SPACE.x1}
              onPress={onPickImages}
              style={styles.action}
            >
              {imagePickPending ? (
                <ActivityIndicator color={theme.colors.text2} size="small" />
              ) : (
                <ImagePlus color={theme.colors.text2} size={22} />
              )}
            </MotionPressable>
          ) : null}
          {mentionsEnabled ? (
            <MotionPressable
              accessibilityLabel={t('提及成员')}
              accessibilityRole="button"
              disabled={!enabled || pending}
              hitSlop={SPACE.x1}
              onPress={openMentionMenu}
              style={styles.action}
            >
              <AtSign color={theme.colors.text2} size={23} />
            </MotionPressable>
          ) : null}
        </View>
        <View style={styles.trailingActions}>
          {quickKeysAvailable && onQuickKeysToggle ? (
            <MotionPressable
              accessibilityLabel={quickKeysExpanded
                ? t('收起终端快捷键')
                : t('展开终端快捷键')}
              accessibilityRole="button"
              accessibilityState={{ expanded: quickKeysExpanded }}
              onPress={onQuickKeysToggle}
              style={[
                styles.action,
                quickKeysExpanded ? styles.actionActive : null,
              ]}
              testID="composer-keyboard-action"
            >
              <Keyboard
                color={quickKeysExpanded ? theme.colors.accent : theme.colors.text2}
                size={21}
              />
            </MotionPressable>
          ) : null}
          {onFullKeyboard ? (
            <MotionPressable
              accessibilityLabel={t('全键盘')}
              accessibilityRole="button"
              onPress={onFullKeyboard}
              style={styles.action}
              testID="composer-full-keyboard"
            >
              <Grid3x3 color={theme.colors.text2} size={21} />
            </MotionPressable>
          ) : null}
          {onDismissKeyboard ? (
            <MotionPressable
              accessibilityLabel={t('收起键盘')}
              accessibilityRole="button"
              hitSlop={SPACE.x1}
              onPress={onDismissKeyboard}
              style={styles.action}
              testID="composer-dismiss-keyboard"
            >
              <ChevronDown color={theme.colors.text2} size={23} />
            </MotionPressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function createStyles(theme: ConnectTheme) {
  return StyleSheet.create({
    container: {
      position: 'relative',
      paddingHorizontal: SPACE.x3,
      paddingVertical: SPACE.x1,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.line,
      backgroundColor: theme.colors.panel,
    },
    mentionMenu: {
      position: 'absolute',
      left: SPACE.x3,
      right: SPACE.x3,
      bottom: 104,
      zIndex: 3,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: theme.colors.line2,
      borderRadius: RADIUS.control,
      backgroundColor: theme.colors.panel,
    },
    mentionRow: {
      minHeight: 48,
      paddingHorizontal: SPACE.x3,
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACE.x3,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.line,
    },
    mentionIcon: {
      width: 30,
      height: 30,
      borderRadius: RADIUS.control,
      backgroundColor: theme.colors.panel2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    mentionLabel: {
      color: theme.colors.text,
      fontSize: 15,
    },
    inputFrame: {
      minHeight: 48,
      paddingLeft: SPACE.x3,
      paddingRight: SPACE.x3,
      paddingVertical: SPACE.x1,
      borderWidth: 1,
      borderColor: theme.colors.line2,
      borderRadius: RADIUS.control,
      backgroundColor: theme.colors.panel,
      alignItems: 'stretch',
    },
    imageStrip: {
      minHeight: 72,
      paddingBottom: SPACE.x2,
      flexDirection: 'row',
      gap: SPACE.x2,
    },
    imagePreview: {
      width: 64,
      height: 64,
      position: 'relative',
    },
    image: {
      width: 64,
      height: 64,
      borderRadius: RADIUS.control,
      borderWidth: 1,
      borderColor: theme.colors.line2,
    },
    removeImage: {
      position: 'absolute',
      top: -5,
      right: -5,
      width: 26,
      height: 26,
      borderRadius: 13,
      borderWidth: 1,
      borderColor: theme.colors.line2,
      backgroundColor: theme.colors.panel2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    input: {
      minHeight: INPUT_MIN_HEIGHT,
      maxHeight: 96,
      flex: 1,
      paddingTop: SPACE.x2,
      paddingBottom: SPACE.x2,
      paddingRight: SPACE.x2,
      color: theme.colors.text,
      fontSize: INPUT_FONT_SIZE,
      // No fixed lineHeight: iOS scales it by the raw system font scale while
      // the font stops at the compact cap, which dropped the placeholder below
      // its own line at the largest accessibility sizes. minHeight keeps the box.
      textAlignVertical: 'center',
    },
    action: {
      width: 44,
      height: 44,
      borderRadius: RADIUS.control,
      alignItems: 'center',
      justifyContent: 'center',
    },
    actionActive: {
      backgroundColor: theme.colors.panel2,
    },
    toolbar: {
      minHeight: 44,
      marginTop: SPACE.x1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    leadingActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACE.x1,
    },
    trailingActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACE.x1,
    },
  });
}
