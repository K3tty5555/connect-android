import { useRef, useState } from 'react';
import { findNodeHandle, Modal, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { serializeCrashReport } from '../../../../src/shared/crashReport';
import type { CrashReport, CrashReportSendResult } from '../../../../src/shared/types';
import type { CrashDiagnostics } from '../crash/crashDiagnostics';
import { MotionPressable } from '../components/MotionPressable';
import { t } from '../i18n';
import type { ConnectTheme } from '../theme/theme';
import { MAX_COMPACT_FONT_SCALE, RADIUS, SPACE } from '../theme/tokens';

const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });

type FailureCode = Extract<CrashReportSendResult, { ok: false }>['code'];

const FAILURE_MESSAGES: Record<FailureCode, string> = {
  network: '网络不可用，请稍后重试。',
  rate_limited: '发送太频繁，请稍后再试。',
  rejected: '服务器未接受这份记录。',
  server: '服务器暂时不可用，请稍后重试。',
};

type SendState =
  | { kind: 'idle' }
  | { kind: 'already-sent' }
  | { kind: 'sending' }
  | { kind: 'sent'; reportId: string }
  | { kind: 'failed'; code: FailureCode };

/**
 * The exact text that would leave the phone (ADR-008), with send and share at
 * equal weight. The log is kept after sending.
 */
export function CrashReportPreview({
  report,
  diagnostics,
  theme,
  onClose,
}: {
  report: CrashReport;
  diagnostics: CrashDiagnostics;
  theme: ConnectTheme;
  onClose(): void;
}): React.ReactElement {
  const styles = createStyles(theme);
  const [text] = useState(() => serializeCrashReport(report));
  // 用户 2026-11-01：发过的同一批记录不能再发，按钮保持「发送成功」直到出现新记录。
  const [state, setState] = useState<SendState>(() => (diagnostics.isSent(report) ? { kind: 'already-sent' } : { kind: 'idle' }));
  const sending = useRef(false);
  // iPad presents the share sheet as a popover; anchor it on the button instead of the screen centre.
  const shareAnchor = useRef<View>(null);

  const send = async (): Promise<void> => {
    if (sending.current || state.kind === 'sent' || state.kind === 'already-sent') return;
    sending.current = true;
    setState({ kind: 'sending' });
    try {
      const result = await diagnostics.send(report);
      setState(result.ok ? { kind: 'sent', reportId: result.reportId } : { kind: 'failed', code: result.code });
    } catch {
      setState({ kind: 'failed', code: 'network' });
    } finally {
      sending.current = false;
    }
  };

  const sent = state.kind === 'sent' || state.kind === 'already-sent';
  const sendDisabled = state.kind === 'sending' || sent;
  const sendLabel = sent ? t('发送成功') : state.kind === 'sending' ? t('正在发送') : t('发送给作者');

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen'}
      visible
    >
      <SafeAreaView edges={['top', 'bottom', 'left', 'right']} style={styles.root}>
        <View style={styles.header}>
          <Text accessibilityRole="header" maxFontSizeMultiplier={MAX_COMPACT_FONT_SCALE} style={styles.title}>{t('诊断记录')}</Text>
          <MotionPressable
            accessibilityLabel={sent ? t('关闭') : t('取消')}
            accessibilityRole="button"
            onPress={onClose}
            style={styles.headerButton}
          >
            <Text style={styles.headerButtonLabel}>{sent ? t('关闭') : t('取消')}</Text>
          </MotionPressable>
        </View>
        <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
          <Text selectable style={styles.text} testID="crash-report-text">{text}</Text>
        </ScrollView>
        <View style={styles.footer}>
          {state.kind === 'sent' ? (
            <Text accessibilityRole="alert" style={styles.ok}>
              {t('已发送，编号 {id}', { id: state.reportId.slice(0, 8) })}
            </Text>
          ) : null}
          {state.kind === 'failed' ? (
            <Text accessibilityRole="alert" style={styles.error}>{t(FAILURE_MESSAGES[state.code])}</Text>
          ) : null}
          <View style={styles.actions}>
            <View collapsable={false} ref={shareAnchor} style={styles.actionSlot}>
              <MotionPressable
                accessibilityLabel={t('分享')}
                accessibilityRole="button"
                onPress={() => void diagnostics.share(report, findNodeHandle(shareAnchor.current) ?? undefined)}
                style={styles.action}
              >
                <Text maxFontSizeMultiplier={MAX_COMPACT_FONT_SCALE} style={styles.actionLabel}>{t('分享')}</Text>
              </MotionPressable>
            </View>
            {diagnostics.canSend ? (
              <MotionPressable
                accessibilityLabel={sent ? t('发送成功') : t('发送给作者')}
                accessibilityRole="button"
                accessibilityState={{ busy: state.kind === 'sending', disabled: sendDisabled }}
                disabled={sendDisabled}
                onPress={() => void send()}
                style={[styles.action, styles.actionSlot, sendDisabled ? styles.disabled : null]}
              >
                <Text maxFontSizeMultiplier={MAX_COMPACT_FONT_SCALE} style={styles.actionLabel}>
                  {sendLabel}
                </Text>
              </MotionPressable>
            ) : null}
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function createStyles(theme: ConnectTheme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.bg },
    header: {
      minHeight: 52,
      paddingHorizontal: SPACE.x4,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.line,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    title: { color: theme.colors.text, fontSize: 17, fontWeight: '700' },
    headerButton: { minHeight: 44, minWidth: 44, alignItems: 'flex-end', justifyContent: 'center' },
    headerButtonLabel: { color: theme.colors.accent, fontSize: 15, fontWeight: '600' },
    body: { flex: 1 },
    bodyContent: { padding: SPACE.x4 },
    text: { color: theme.colors.text2, fontFamily: MONO, fontSize: 12, lineHeight: 17 },
    footer: {
      paddingHorizontal: SPACE.x4,
      paddingVertical: SPACE.x3,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.line,
      gap: SPACE.x2,
    },
    actions: { flexDirection: 'row', gap: SPACE.x2 },
    actionSlot: { flex: 1 },
    action: {
      minHeight: 44,
      paddingHorizontal: SPACE.x3,
      paddingVertical: SPACE.x2,
      borderRadius: RADIUS.control,
      // Light theme panel2 is ~1:1 with the page background; the border keeps it reading as a button.
      borderWidth: 1,
      borderColor: theme.colors.line2,
      backgroundColor: theme.colors.panel2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    actionLabel: { color: theme.colors.text, fontSize: 14, fontWeight: '700', textAlign: 'center' },
    // Semantic green on 13 pt text falls under 4.5:1 in the light theme; body text colour keeps it legible.
    ok: { color: theme.colors.text, fontSize: 13, fontWeight: '600', lineHeight: 18, textAlign: 'center' },
    error: { color: theme.colors.danger, fontSize: 13, lineHeight: 18, textAlign: 'center' },
    disabled: { opacity: 0.45 },
  });
}
