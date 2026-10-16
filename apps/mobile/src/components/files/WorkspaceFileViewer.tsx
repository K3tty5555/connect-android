import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { ChevronLeft, Pencil, RotateCw, X } from 'lucide-react-native';
import { MOBILE_FILE_SAVE_MAX_BYTES } from '../../../../../src/shared/mobileFileBoundary';
import {
  decodeWorkspaceText,
  WorkspaceFileDownloadSupersededError,
  WorkspaceFileError,
  type WorkspaceFileContent,
  type WorkspaceFileTransport,
} from '../../domain/workspaceFiles';
import { textToBytes } from '../../net/bytes';
import { createExpoOfficePreviewFiles, type OfficePreviewFiles } from '../../domain/officePreviewFile';
import type { ConnectTheme } from '../../theme/theme';
import { MAX_COMPACT_FONT_SCALE, RADIUS, SPACE } from '../../theme/tokens';
import { MotionPressable } from '../MotionPressable';
import { t } from '../../i18n';

const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });

/**
 * 未保存的编辑按文档身份（项目 label + 路径）暂存在内存：查看器因重连轮换 capability、
 * iPad 窗口变窄切回 iPhone 排版而重挂时，草稿与它所基于的 revision 一并恢复，绝不静默丢弃。
 * 保存成功或用户明确放弃时清除。
 */
const unsavedDrafts = new Map<string, { draft: string; baseRevision: string }>();

let defaultOfficeFiles: OfficePreviewFiles | null = null;
/** 首次用到时才创建；创建即清掉上次进程残留的预览文件。 */
function officePreviewFiles(): OfficePreviewFiles {
  if (defaultOfficeFiles === null) {
    defaultOfficeFiles = createExpoOfficePreviewFiles();
    try {
      defaultOfficeFiles.clear();
    } catch {
      // 清理失败不影响查看；下次写入前还会再清一次
    }
  }
  return defaultOfficeFiles;
}

type ViewerState =
  | { status: 'loading'; received: number; total: number }
  | { status: 'error'; message: string }
  | { status: 'ready'; content: WorkspaceFileContent; text: string | null };

/**
 * 工作区文件的查看/编辑（ADR-003 §14）。iPhone 以全屏模态呈现，iPad 嵌在主区标签里。
 * 内容只在内存里：图片与 PDF 用 data URI，不落手机磁盘。保存只走乐观并发——
 * 电脑上的版本变了就提示重新载入，绝不覆盖。
 */
export function WorkspaceFileViewer({
  transport,
  workspaceCapability,
  documentKey,
  subPath,
  canWrite,
  theme,
  chrome,
  onClose,
  officeFiles,
}: {
  transport: WorkspaceFileTransport;
  /** 只用于发请求；变化（重连轮换）不触发重新载入，下次请求自动用新值。 */
  workspaceCapability: string;
  /** 文档身份：项目 label + 路径，不含会轮换的 capability。 */
  documentKey: string;
  subPath: string;
  canWrite: boolean;
  theme: ConnectTheme;
  /** modal：左上「关闭」；pane：左上「返回」且不占安全区（宿主负责）。 */
  chrome: 'modal' | 'pane';
  onClose(): void;
  /** 测试注入；默认写进 App 缓存目录（见 officePreviewFile.ts）。 */
  officeFiles?: OfficePreviewFiles;
}): React.ReactElement {
  const [state, setState] = useState<ViewerState>({ status: 'loading', received: 0, total: 0 });
  const [draft, setDraftState] = useState<string | null>(null);
  /** 草稿所基于的 revision；恢复的草稿可能早于刚载入的内容，保存时必须用它做乐观并发。 */
  const [baseRevision, setBaseRevision] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const capabilityRef = useRef(workspaceCapability);
  capabilityRef.current = workspaceCapability;
  const setDraft = useCallback((next: string | null, revision?: string | null) => {
    setDraftState(next);
    if (revision !== undefined) setBaseRevision(revision);
  }, []);
  const [notice, setNotice] = useState<string | null>(null);
  const [imageAspect, setImageAspect] = useState(1);
  const loadToken = useRef(0);
  const styles = createStyles(theme);
  const name = subPath.slice(subPath.lastIndexOf('/') + 1);

  const load = useCallback((discardDraft: boolean) => {
    const token = ++loadToken.current;
    setState({ status: 'loading', received: 0, total: 0 });
    if (discardDraft) unsavedDrafts.delete(documentKey);
    setDraft(null, null);
    setNotice(null);
    void transport.download(
      capabilityRef.current,
      subPath,
      (received, total) => {
        if (token === loadToken.current) setState({ status: 'loading', received, total });
      },
      (kind) => kind === 'text' || kind === 'image' || kind === 'pdf' || kind === 'office',
    ).then((content) => {
      if (token !== loadToken.current) return;
      const kept = unsavedDrafts.get(documentKey);
      if (kept !== undefined && content.contentKind === 'text') {
        setDraft(kept.draft, kept.baseRevision);
        if (kept.baseRevision !== content.sha256) setNotice(t('已恢复未保存的修改；电脑上的文件也变了，保存时会提示冲突。'));
      }
      setState({
        status: 'ready',
        content,
        text: content.contentKind === 'text' && content.bytes !== undefined
          ? decodeWorkspaceText(content.bytes)
          : null,
      });
    }, (error: unknown) => {
      if (token !== loadToken.current || error instanceof WorkspaceFileDownloadSupersededError) return;
      setState({ status: 'error', message: error instanceof Error ? error.message : t('无法打开文件') });
    });
  }, [documentKey, setDraft, subPath, transport]);

  useEffect(() => {
    load(false);
    return () => {
      loadToken.current += 1;
    };
  }, [load]);

  // 草稿随改随存进内存暂存区：卸载（重挂、排版切换）不丢。
  useEffect(() => {
    if (draft === null || baseRevision === null) return;
    unsavedDrafts.set(documentKey, { draft, baseRevision });
  }, [baseRevision, documentKey, draft]);

  const ready = state.status === 'ready' ? state : null;

  // Word / Excel：系统渲染只认 file://（实测 data: 空白），落到受保护的缓存文件，换文件或关闭即删
  const officeBytes = ready?.content.contentKind === 'office' ? ready.content.bytes : undefined;
  const [officeDocument, setOfficeDocument] = useState<{ uri: string; directoryUri: string } | 'failed' | null>(null);
  useEffect(() => {
    setOfficeDocument(null);
    // Android WebView 渲染不了 Office 文档：不写缓存文件，直接走「不能预览」分支
    if (officeBytes === undefined || Platform.OS !== 'ios') return undefined;
    const files = officeFiles ?? officePreviewFiles();
    let written: { uri: string; directoryUri: string } | null = null;
    try {
      written = files.write(subPath, officeBytes);
      setOfficeDocument(written);
    } catch {
      written = null;
      setOfficeDocument('failed');
    }
    return () => {
      if (written === null) return;
      try {
        files.remove(written.uri);
      } catch {
        // 下次写入前整个目录会被清空
      }
    };
  }, [officeBytes, officeFiles, subPath]);
  const editable = ready !== null
    && ready.text !== null
    && ready.content.byteLength <= MOBILE_FILE_SAVE_MAX_BYTES
    && canWrite;
  const dirty = draft !== null && (ready?.text !== draft || baseRevision !== ready?.content.sha256);

  const close = (): void => {
    if (!dirty) {
      unsavedDrafts.delete(documentKey);
      onClose();
      return;
    }
    Alert.alert(t('放弃未保存的修改？'), undefined, [
      { text: t('继续编辑'), style: 'cancel' },
      {
        text: t('放弃'),
        style: 'destructive',
        onPress: () => {
          unsavedDrafts.delete(documentKey);
          onClose();
        },
      },
    ]);
  };

  const save = async (): Promise<void> => {
    const revision = baseRevision ?? ready?.content.sha256;
    if (ready === null || draft === null || revision === undefined || savingRef.current) return;
    if (textToBytes(draft).byteLength > MOBILE_FILE_SAVE_MAX_BYTES) {
      setNotice(t('内容超过手机端编辑上限（512 KB）。'));
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setNotice(null);
    try {
      const saved = await transport.save(capabilityRef.current, subPath, revision, draft);
      unsavedDrafts.delete(documentKey);
      setState({
        status: 'ready',
        content: { ...ready.content, sha256: saved.revision, byteLength: saved.byteLength },
        text: draft,
      });
      setDraft(null, null);
    } catch (error) {
      if (error instanceof WorkspaceFileError && error.code === 'workspace_file_conflict') {
        Alert.alert(t('电脑上的文件已变化'), t('重新载入会放弃这里的修改。'), [
          { text: t('取消'), style: 'cancel' },
          { text: t('重新载入'), style: 'destructive', onPress: () => load(true) },
        ]);
      } else {
        setNotice(error instanceof Error ? error.message : t('保存没有完成，请重试。'));
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const lines = useMemo(() => (ready?.text ?? '').split('\n'), [ready?.text]);
  const gutterWidth = Math.max(2, String(lines.length).length) * 8 + SPACE.x3;

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <MotionPressable
          accessibilityLabel={chrome === 'modal' ? t('关闭') : t('返回')}
          accessibilityRole="button"
          onPress={close}
          style={styles.headerButton}
        >
          {chrome === 'modal'
            ? <X color={theme.colors.text2} size={21} />
            : <ChevronLeft color={theme.colors.text2} size={23} />}
        </MotionPressable>
        <View style={styles.titleCopy}>
          <Text maxFontSizeMultiplier={MAX_COMPACT_FONT_SCALE} numberOfLines={1} style={styles.title}>{name}</Text>
          <Text maxFontSizeMultiplier={MAX_COMPACT_FONT_SCALE} numberOfLines={1} style={styles.subtitle}>
            {subPath}
          </Text>
        </View>
        {draft !== null ? (
          <MotionPressable
            accessibilityLabel={t('保存')}
            accessibilityRole="button"
            accessibilityState={{ disabled: !dirty || saving, busy: saving }}
            disabled={!dirty || saving}
            onPress={() => void save()}
            style={[styles.saveButton, !dirty || saving ? styles.disabled : null]}
          >
            {saving
              ? <ActivityIndicator color={theme.colors.bg} size="small" />
              : <Text style={styles.saveText}>{t('保存')}</Text>}
          </MotionPressable>
        ) : editable ? (
          <MotionPressable
            accessibilityLabel={t('编辑')}
            accessibilityRole="button"
            onPress={() => setDraft(ready.text, ready.content.sha256 ?? null)}
            style={styles.headerButton}
          >
            <Pencil color={theme.colors.text2} size={19} />
          </MotionPressable>
        ) : null}
        <MotionPressable
          accessibilityLabel={t('重新载入')}
          accessibilityRole="button"
          disabled={saving}
          onPress={() => {
            if (!dirty) {
              load(true);
              return;
            }
            Alert.alert(t('放弃未保存的修改？'), undefined, [
              { text: t('继续编辑'), style: 'cancel' },
              { text: t('重新载入'), style: 'destructive', onPress: () => load(true) },
            ]);
          }}
          style={styles.headerButton}
        >
          <RotateCw color={theme.colors.text2} size={18} />
        </MotionPressable>
      </View>
      {notice !== null ? <Text style={styles.notice}>{notice}</Text> : null}
      {state.status === 'loading' ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.text3} />
          {state.total > 0 ? (
            <Text style={styles.muted}>{`${formatBytes(state.received)} / ${formatBytes(state.total)}`}</Text>
          ) : null}
        </View>
      ) : state.status === 'error' ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{state.message}</Text>
          <MotionPressable accessibilityRole="button" onPress={() => load(false)} style={styles.retry}>
            <Text style={styles.retryText}>{t('重试')}</Text>
          </MotionPressable>
        </View>
      ) : draft !== null ? (
        <TextInput
          accessibilityLabel={t('编辑 {name}', { name })}
          autoCapitalize="none"
          autoCorrect={false}
          multiline
          onChangeText={(next) => setDraft(next)}
          scrollEnabled
          smartInsertDelete={false}
          spellCheck={false}
          style={styles.editor}
          testID="file-editor"
          textAlignVertical="top"
          value={draft}
        />
      ) : state.text !== null ? (
        <FlatList
          contentContainerStyle={styles.textBody}
          data={lines}
          initialNumToRender={60}
          keyExtractor={(_line, index) => String(index)}
          renderItem={({ item: line, index }) => (
            <View style={styles.line}>
              <Text style={[styles.lineNumber, { width: gutterWidth }]}>{index + 1}</Text>
              <Text selectable style={styles.lineText}>{line.length === 0 ? ' ' : line}</Text>
            </View>
          )}
          testID="file-text"
          windowSize={11}
        />
      ) : state.content.contentKind === 'image' && state.content.base64 !== undefined ? (
        <ScrollView
          centerContent
          contentContainerStyle={styles.mediaBody}
          maximumZoomScale={6}
          minimumZoomScale={1}
        >
          <Image
            accessibilityLabel={name}
            onLoad={(event) => {
              const { width, height } = event.nativeEvent.source;
              if (width > 0 && height > 0) setImageAspect(width / height);
            }}
            resizeMode="contain"
            source={{ uri: `data:${state.content.mime ?? 'image/png'};base64,${state.content.base64}` }}
            style={[styles.image, { aspectRatio: imageAspect }]}
          />
        </ScrollView>
      ) : state.content.contentKind === 'pdf' && state.content.base64 !== undefined && Platform.OS === 'ios' ? (
        <WebView
          javaScriptEnabled={false}
          onShouldStartLoadWithRequest={(request) => request.url.startsWith('data:')}
          originWhitelist={['*']}
          source={{ uri: `data:application/pdf;base64,${state.content.base64}` }}
          style={styles.pdf}
          testID="file-pdf"
        />
      ) : state.content.contentKind === 'office' && state.content.bytes !== undefined && Platform.OS === 'ios' && officeDocument === null ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.text3} />
        </View>
      ) : state.content.contentKind === 'office' && Platform.OS === 'ios' && officeDocument !== null && officeDocument !== 'failed' ? (
        <WebView
          allowingReadAccessToURL={officeDocument.directoryUri}
          javaScriptEnabled={false}
          onShouldStartLoadWithRequest={(request) => request.url === officeDocument.uri}
          originWhitelist={['file://*']}
          source={{ uri: officeDocument.uri }}
          style={styles.pdf}
          testID="file-office"
        />
      ) : (
        <View style={styles.center}>
          <Text style={styles.muted}>{unsupportedCopy(state.content)}</Text>
        </View>
      )}
      {ready !== null && ready.text !== null && !editable && draft === null && canWrite ? (
        <Text style={styles.footnote}>{t('文件超过 512 KB，手机上只读。')}</Text>
      ) : null}
    </View>
  );
}

function unsupportedCopy(content: WorkspaceFileContent): string {
  if (content.contentKind === 'too_large') return t('文件太大，手机上不预览。');
  if (content.contentKind === 'audio' || content.contentKind === 'video') return t('手机上暂不能播放音视频。');
  return t('手机上不能预览这种文件。');
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function createStyles(theme: ConnectTheme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.bg },
    header: {
      minHeight: 56,
      paddingHorizontal: SPACE.x2,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.line,
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACE.x1,
    },
    headerButton: {
      width: 44,
      height: 44,
      borderRadius: RADIUS.control,
      alignItems: 'center',
      justifyContent: 'center',
    },
    titleCopy: { minWidth: 0, flex: 1, paddingHorizontal: SPACE.x1 },
    title: { color: theme.colors.text, fontSize: 16, fontWeight: '700' },
    subtitle: { color: theme.colors.text3, fontSize: 11, marginTop: 1 },
    saveButton: {
      minWidth: 64,
      height: 34,
      paddingHorizontal: SPACE.x3,
      borderRadius: RADIUS.control,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.accent,
    },
    saveText: { color: theme.colors.bg, fontSize: 14, fontWeight: '700' },
    disabled: { opacity: 0.45 },
    notice: {
      color: theme.colors.warn,
      fontSize: 12,
      paddingHorizontal: SPACE.x4,
      paddingVertical: SPACE.x2,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.line,
    },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: SPACE.x3, padding: SPACE.x5 },
    muted: { color: theme.colors.text3, fontSize: 13, textAlign: 'center' },
    errorText: { color: theme.colors.danger, fontSize: 13, textAlign: 'center' },
    retry: {
      minHeight: 40,
      paddingHorizontal: SPACE.x4,
      borderRadius: RADIUS.control,
      borderWidth: 1,
      borderColor: theme.colors.line2,
      justifyContent: 'center',
    },
    retryText: { color: theme.colors.text, fontSize: 14 },
    textBody: { paddingVertical: SPACE.x2, paddingRight: SPACE.x3 },
    line: { flexDirection: 'row' },
    lineNumber: {
      color: theme.colors.text3,
      fontFamily: MONO,
      fontSize: 12,
      lineHeight: 18,
      textAlign: 'right',
      paddingRight: SPACE.x2,
    },
    lineText: { flex: 1, color: theme.colors.text, fontFamily: MONO, fontSize: 12, lineHeight: 18 },
    editor: {
      flex: 1,
      color: theme.colors.text,
      fontFamily: MONO,
      fontSize: 13,
      lineHeight: 19,
      padding: SPACE.x3,
    },
    mediaBody: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: SPACE.x3 },
    image: { width: '100%' },
    pdf: { flex: 1, backgroundColor: theme.colors.bg },
    footnote: {
      color: theme.colors.text3,
      fontSize: 11,
      textAlign: 'center',
      paddingVertical: SPACE.x2,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.line,
    },
  });
}
