// 领域类型 —— 与 contracts/*.schema.json 一一对应（契约是事实来源，类型是其 TS 投影）

import type {
  TerminalKeyModifiers,
  TerminalKeyName,
  TerminalMouseAction,
  TerminalMouseButton,
} from './terminalInput';

export type Provider = 'claude' | 'codex' | 'fake';
export type GatePolicy = 'every_round' | 'on_approve' | 'full_auto';
export type GateReason = 'approve' | 'every_round' | 'round_limit' | 'stalled' | 'superseded' | 'error' | 'ambiguous';

export interface PendingGateOccurrence {
  occurrenceId: string;
  reason: GateReason;
  round: number;
  createdAt: string;
}

export type TaskStatus =
  | 'DRAFTING' | 'REVIEWING' | 'REVISING'
  | 'WAITING_APPROVAL' | 'DISPATCHING' | 'RECOVERING' | 'AMBIGUOUS'
  | 'HUMAN_GATE' | 'COMPLETED' | 'INTERRUPTED' | 'FAILED' | 'CANCELLED';

export type CallState = 'PREPARED' | 'DISPATCHED' | 'STREAMING' | 'COMMITTED' | 'AMBIGUOUS';
export type Stage = 'draft' | 'review' | 'revise' | 'gate';

export type RoomAgent = 'claude' | 'codex';
export type RoomAgentPhase = 'coordinate' | 'contribute' | 'finalize' | 'format_fix';
export type RoomAgentAction =
  | { type: 'finish' }
  | { type: 'ask_user' }
  | { type: 'delegate'; target: RoomAgent; task: string }
  | { type: 'return'; result: string };

export interface RoomAgentResponse {
  schemaVersion: 1;
  message: string;
  action: RoomAgentAction;
}

export type ErrorCode =
  | 'timeout' | 'quota_exhausted' | 'network_error' | 'auth_expired'
  | 'permission_denied' | 'process_exit' | 'schema_invalid'
  | 'version_unsupported' | 'interrupted' | 'unknown';
export type ErrorCategory = 'retryable' | 'action_required' | 'permanent' | 'ambiguous';

export interface StageError {
  code: ErrorCode;
  category: ErrorCategory;
  message: string;
}

export type CollabGateAction =
  | 'complete'
  | 'continue'
  | 're_review'
  | 'cancel'
  | 'fail';

export interface CollabGateDecision {
  decision: 'APPROVE' | 'REVISE';
  summary: string;
  issues: Array<{
    id: string;
    severity: 'blocking' | 'non_blocking';
    message: string;
  }>;
}

export interface CollabGateEvent {
  schemaVersion: 1;
  taskId: string;
  reason: GateReason;
  round: number;
  decision: CollabGateDecision | null;
  error: {
    code: ErrorCode;
    category: ErrorCategory;
    message: string;
  } | null;
}

export interface CollabGateResolveRequest {
  schemaVersion: 1;
  taskId: string;
  action: CollabGateAction;
}

export interface CollabInjectRequest {
  schemaVersion: 1;
  taskId: string;
  text: string;
  target: 'driver' | 'reviewer';
}

export interface RoomGate {
  schemaVersion: 1;
  taskId: string;
  actions: Array<{
    action: CollabGateAction;
    label: string;
  }>;
}

export type RoomTurnStatus =
  | 'CREATED' | 'COORDINATING' | 'WAITING_CONTRIBUTORS' | 'FINALIZING'
  | 'WAITING_USER' | 'COMPLETED' | 'CANCELLED' | 'FAILED' | 'AMBIGUOUS';

export interface RoomTurnCall {
  operationId: string;
  agent: RoomAgent;
  phase: RoomAgentPhase;
  callState: CallState;
  providerTurnId: string | null;
  outcome: RoomAgentResponse | null;
  error: StageError | null;
  startedAt: string;
  endedAt: string | null;
}

export interface RoomTurnState {
  schemaVersion: 1;
  turnId: string;
  userMessageId: string;
  coordinator: RoomAgent;
  initialTargets: RoomAgent[];
  status: RoomTurnStatus;
  delegation: {
    target: RoomAgent;
    task: string;
    result: string | null;
    requestedAt: string;
  } | null;
  calls: RoomTurnCall[];
  error: StageError | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewIssue {
  id: string;
  severity: 'blocking' | 'non_blocking';
  message: string;
  origin?: 'new' | 'carried' | 'reopened';
  location?: { path: string; line?: number };
  evidence?: string;
}

export interface ReviewDecision {
  schemaVersion: 1;
  decision: 'APPROVE' | 'REVISE';
  summary: string;
  issues: ReviewIssue[];
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  costUsd?: number;
}

export type UsageProvider = 'claude' | 'codex';
export type ProviderUsageAvailability = 'unavailable' | 'partial' | 'available';

export interface ProviderUsageRequest {
  schemaVersion: 1;
  workspacePath: string;
}

export interface ProviderUsageLedgerCounters {
  structuredCalls: number;
  tokenCalls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costCalls: number;
  costUsd: number;
  structuredDurationMs: number;
  terminalSessions: number;
  terminalDurationMs: number;
}

export interface ProviderUsageLedgerRecord {
  workspacePath: string;
  recordedSince: string;
  updatedAt: string;
  claude: ProviderUsageLedgerCounters;
  codex: ProviderUsageLedgerCounters;
}

export interface ProviderUsageLedgerState {
  schemaVersion: 1;
  records: ProviderUsageLedgerRecord[];
}

export interface ProviderUsageProviderSnapshot {
  provider: UsageProvider;
  structured: {
    calls: number;
    tokenCalls: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    durationMs: number;
    tokenState: ProviderUsageAvailability;
    costCalls: number;
    costUsd: number;
    costState: ProviderUsageAvailability;
  };
  terminal: {
    sessions: number;
    activeSessions: number;
    durationMs: number;
    tokenState: 'unavailable';
  };
  accountQuotaState: 'unavailable';
}

export interface ProviderUsageSnapshot {
  schemaVersion: 1;
  scope: 'connect_recorded';
  state: 'ready' | 'unavailable';
  recordedSince: string | null;
  updatedAt: string | null;
  capturedAt: string;
  providers: [ProviderUsageProviderSnapshot, ProviderUsageProviderSnapshot];
}

export type AgentEventType =
  | 'session_started' | 'session_ended'
  | 'turn_started' | 'turn_completed'
  | 'text_delta' | 'message'
  | 'tool_call' | 'tool_result'
  | 'file_ref'
  | 'approval_request' | 'approval_resolved'
  | 'usage'
  | 'error';

export interface AgentEvent {
  schemaVersion: 1;
  eventId: string;
  seq: number;
  ts: string;
  provider: Provider;
  sessionId: string;
  taskId?: string | null;
  type: AgentEventType;
  payload: Record<string, unknown>;
}

export interface ManifestEntry {
  path: string;
  sha256: string;
  size: number;
}

export interface ArtifactManifest {
  paths: string[];
  exclude: string[];
  entries: ManifestEntry[];
  manifestHash: string;
}

export interface AgentRef {
  provider: Provider;
  model?: string | null;
  sessionId?: string | null;
}

export interface CallRecord {
  operationId: string;
  callState: CallState;
  providerTurnId?: string | null;
}

export interface IssueState {
  issueId: string;
  status: 'open' | 'fixed' | 'rejected' | 'needs_human' | 'closed' | 'reopened';
}

export interface StageRecord {
  round: number;
  stage: Stage;
  attempt: number;
  idempotencyKey: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'superseded';
  call?: CallRecord | null;
  providerSessionId?: string | null;
  basedOnHash?: string | null;
  inputDigest?: string | null;
  decision?: ReviewDecision | null;
  issueStates?: IssueState[];
  usage?: Usage | null;
  error?: StageError | null;
  startedAt: string;
  endedAt?: string | null;
}

export interface MetaInstruction {
  ts: string;
  text: string;
  target: 'driver' | 'reviewer';
  injectedIntoRound?: number | null;
}

export interface TaskState {
  schemaVersion: 2;
  taskId: string;
  title: string;
  goal: string;
  reviewAngle?: string;
  artifactType?: 'doc' | 'code';
  projectPath: string;
  /** 产物工作区相对路径；持久化以支持崩溃恢复（整仓验收 P1.2） */
  artifactRelPath: string;
  artifactManifest?: ArtifactManifest;
  runDir?: string;
  driver: AgentRef;
  reviewer: AgentRef;
  gatePolicy: GatePolicy;
  roundLimit: number;
  state: TaskStatus;
  currentRound: number;
  rounds: StageRecord[];
  metaInstructions: MetaInstruction[];
  pendingGate?: PendingGateOccurrence | null;
  budgetUsdLimit?: number | null;
  createdAt: string;
  updatedAt: string;
}

export type ControlPlane = 'pty' | 'exec_json' | 'app_server' | 'sdk' | 'stream_json';
export type AuthMode = 'subscription_oauth' | 'api_key' | 'auth_token_env' | 'unauthenticated' | 'unknown';

export interface CapabilityReport {
  schemaVersion: 1;
  provider: Provider;
  controlPlane: ControlPlane;
  status: 'supported' | 'degraded' | 'unsupported';
  authMode: AuthMode;
  endpoint?: string | null;
  cliVersion?: string | null;
  cliPath?: string | null;
  sdkVersion?: string | null;
  protocolVersion?: string | null;
  models?: string[];
  features: {
    structuredOutput: boolean;
    approvals: boolean;
    steer: boolean;
    resume: boolean;
    usage: boolean;
    sandbox: boolean;
    terminal: boolean;
    supportsReconcile: boolean;
    supportsIdempotency: boolean;
    supportsSharedTuiSession: boolean;
  };
  notes?: string | null;
}

export interface ProbeSummary {
  schemaVersion: 1;
  guiEnvHasClaudeToken: boolean;
  shellEnvHasClaudeToken: boolean;
  reports: CapabilityReport[];
}

export type InstallableProvider = 'claude' | 'codex';

export interface ProviderInstallRequest {
  schemaVersion: 1;
  provider: InstallableProvider;
}

export interface ProviderInstallResult {
  schemaVersion: 1;
  provider: InstallableProvider;
  status: 'installed' | 'failed';
  version: string | null;
  path: string | null;
  /** official-installer：Windows 上运行厂商官方 PowerShell 安装器（ADR-006） */
  method: 'existing' | 'npm' | 'npm-mirror' | 'node-bootstrap-npm' | 'official-installer' | 'failed';
  errorCode: 'network' | 'permission' | 'node_unavailable' | 'package_unavailable' | 'verification_failed' | 'failed' | null;
}

export type PublicLinkKind =
  | 'macDownload'
  | 'androidDownload'
  | 'iosAppStore'
  | 'privacy'
  | 'support'
  | 'compatibility';

export interface PublicAppInfo {
  schemaVersion: 1;
  version: string;
  links: Record<PublicLinkKind, string | null>;
}

export type WorkspaceGitEntryStatus =
  | 'untracked'
  | 'added'
  | 'modified'
  | 'renamed'
  | 'conflict'
  | 'ignored';

export interface WorkspaceGitEntry {
  path: string;
  status: WorkspaceGitEntryStatus;
}

export interface WorkspaceGitSnapshot {
  schemaVersion: 1;
  state: 'ready' | 'not_repository' | 'unavailable';
  revision: number;
  entries: WorkspaceGitEntry[];
}

export type WorktreeAgentKind = 'claude' | 'codex';
export type WorktreeState = 'dirty' | 'ahead' | 'merged' | 'conflict' | 'unavailable';

export interface WorktreeSnapshot {
  schemaVersion: 1;
  id: string;
  kind: WorktreeAgentKind;
  branch: string;
  state: WorktreeState;
  changedFiles: number;
  commitsAhead: number;
  createdAt: string;
}

export interface WorktreeCreateRequest {
  schemaVersion: 1;
  workspacePath: string;
  kind: WorktreeAgentKind;
}

export interface WorktreeListRequest {
  schemaVersion: 1;
  workspacePath: string;
}

export interface WorktreeRefRequest {
  schemaVersion: 1;
  workspacePath: string;
  worktreeId: string;
}

export interface PtyCreateRequest {
  schemaVersion: 1;
  kind: 'claude' | 'codex' | 'shell';
  workspacePath: string;
  worktreeId?: string;
}

export interface WorktreeRegistryRecord {
  id: string;
  workspacePath: string;
  repoRoot: string;
  worktreePath: string;
  workspaceRelativePath: string;
  branch: string;
  baseBranch: string;
  kind: WorktreeAgentKind;
  createdAt: string;
}

export interface WorktreeRegistryState {
  schemaVersion: 1;
  records: WorktreeRegistryRecord[];
}

export interface WorkspaceFileDocument {
  schemaVersion: 1;
  subPath: string;
  content: string;
  bytes: number;
  /** SHA-256 of the exact UTF-8 bytes read from disk. */
  revision: string;
}

export interface WorkspaceFileSaveRequest {
  schemaVersion: 1;
  subPath: string;
  content: string;
  expectedRevision: string;
}

export interface WorkspaceTextLocation {
  line: number;
  column: number;
}

export interface WorkspaceSearchRequest {
  schemaVersion: 1;
  query: string;
  maxResults: number;
}

export interface WorkspaceSearchMatch extends WorkspaceTextLocation {
  subPath: string;
  preview: string;
  matchStart: number;
  matchLength: number;
}

export interface WorkspaceSearchResponse {
  schemaVersion: 1;
  query: string;
  truncated: boolean;
  results: WorkspaceSearchMatch[];
}

export interface WorkspaceFilePreview {
  schemaVersion: 1;
  subPath: string;
  /** office：.docx/.xlsx 在 Mac 面板内只读渲染；.doc/.xls 只带字节给手机，Mac 上提示用默认应用打开。 */
  kind: 'image' | 'pdf' | 'audio' | 'video' | 'office' | 'unsupported';
  mimeType: string;
  bytes: number;
  dataBase64: string | null;
  unavailableReason: 'too_large' | 'unsupported' | null;
}

export interface WorkspaceFileOpenRequest {
  schemaVersion: 1;
  subPath: string;
  /** browser：仅 .html/.htm，用系统默认浏览器打开（.html 的默认应用常被编辑器接管）。 */
  mode: 'default' | 'choose' | 'browser';
}

export interface WorkspaceInvalidated {
  workspacePath: string;
}

/** 侧栏单灯：attention（红）> running（黄）> idle（绿）。 */
export type WorkspaceAggregateStatus =
  | 'idle'
  | 'running'
  | 'attention';

export interface WorkspaceTarget {
  type: 'panel' | 'task';
  id: string;
}

export interface WorkspaceAttention {
  schemaVersion: 1;
  eventId: string;
  workspacePath: string;
  kind: 'completed' | 'waiting' | 'failed';
  target: WorkspaceTarget;
  createdAt: string;
}

export interface WorkspaceSummary {
  path: string;
  name: string;
  trusted: boolean;
  status: WorkspaceAggregateStatus;
  /** 需要你查看的面板/任务：未读提醒，或仍在等你输入/已出错。去重。 */
  attentionTargets: readonly WorkspaceTarget[];
  /** 正在运行的面板/任务。去重。 */
  runningTargets: readonly WorkspaceTarget[];
}

export type WorkspaceRuntimeBindingKind = 'pty' | 'room' | 'task';

export interface WorkspaceRuntimeBinding {
  panelId: string;
  kind: WorkspaceRuntimeBindingKind;
  targetId: string;
}

export interface WorkspaceSurfaceSnapshot {
  schemaVersion: 1;
  workspacePath: string;
  layout: Record<string, unknown>;
  runtimeBindings: WorkspaceRuntimeBinding[];
  focusedPanelId: string | null;
}

export interface WorkspaceDragPreview {
  schemaVersion: 1;
  dragId: string;
  workspacePath: string;
  phase: 'source' | 'outside-windows' | 'over-target';
  sourceWindowId: number;
  targetWindowId?: number;
  targetIndex?: number;
}

export interface WorkspaceContentRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WorkspaceMovePreparation {
  schemaVersion: 1;
  transactionId: string;
  workspace: WorkspaceSummary;
  snapshot: WorkspaceSurfaceSnapshot;
}

export interface WorkspaceMoveRuntimeEnable {
  schemaVersion: 1;
  transactionId: string;
  workspacePath: string;
}

export interface WorkspaceMoveAck {
  schemaVersion: 1;
  transactionId: string;
  phase: 'surface_ready' | 'runtime_ready';
  accepted: boolean;
  message?: string;
}

export interface WorkspaceMoveResult {
  schemaVersion: 1;
  transactionId: string;
  workspacePath: string;
  outcome: 'moved' | 'cancelled' | 'rolled_back';
  sourceWindowId: number;
  targetWindowId?: number;
  message?: string;
}

export interface PtyDataEvent {
  id: string;
  seq: number;
  data: string;
}

export interface PtyAttachResult {
  id: string;
  workspacePath: string;
  replay: Array<{ seq: number; data: string }>;
  upperSeq: number;
  exited: boolean;
  exitCode: number | null;
}

export interface CollabTaskSnapshot {
  taskId: string;
  title: string;
  goal: string;
  reviewAngle: string | null;
  artifactType: string;
  gatePolicy: string;
  driver: string;
  reviewer: string;
  state: string;
  currentRound: number;
  roundLimit: number;
  rounds: Array<{
    round: number;
    stage: string;
    attempt: number;
    status: string;
    callState: string | null;
    error: { code: string; message: string } | null;
    decision: {
      decision: string;
      summary: string;
      issues: Array<{ id: string; severity: string; message: string }>;
    } | null;
    usage: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; costUsd?: number } | null;
  }>;
  metaInstructions: Array<{
    text: string;
    target: string;
    injectedIntoRound: number | null;
  }>;
}

export interface CollabTaskAttachment {
  schemaVersion: 1;
  taskId: string;
  workspacePath: string;
  source: 'direct' | 'room' | 'recovery';
  snapshot: CollabTaskSnapshot | null;
  gate: CollabGateEvent | null;
}

export interface WindowWorkspaceState {
  schemaVersion: 1;
  activePath: string | null;
  workspaces: WorkspaceSummary[];
}

export interface RecoveryPrepareResult {
  schemaVersion: 1;
  projectPath: string;
}

export interface RecoveryResumeResult {
  schemaVersion: 1;
  state: 'COMPLETED' | 'FAILED' | 'CANCELLED';
  artifact: string;
  runDir: string;
  projectPath: string;
}

/** 桌面 renderer 与主进程之间的 PTY 输入归属投影。 */
export interface PtyOwnershipState {
  panelId: string;
  owner: 'desktop' | 'mobile';
  epoch: number;
}

/** 终端面板背后 agent 的生命周期状态（contracts/pty-agent-state）。只由 hook 与进程退出推导。 */
export type AgentSessionState =
  | 'ready'
  | 'running'
  | 'needs_input'
  | 'waiting'
  | 'done'
  | 'error'
  | 'exited';

export interface PtyAgentState {
  panelId: string;
  state: AgentSessionState;
}

/**
 * 移动桥线协议（ADR-003）。这些是 contracts/mobile-*.schema.json 的 TS 投影，
 * schema 是事实来源；改形状必须先改 schema。
 */

export type MobileScope = 'read' | 'write';

export const MOBILE_PROTOCOL_VERSION = 2 as const;

export type MobileErrorCategory = 'retryable' | 'action_required' | 'permanent' | 'ambiguous';

export interface MobilePairRequest {
  v: 2;
  deviceName: string;
  identityPubKey: string;
  ephemeralPubKey: string;
  /** 密钥确认值：同时认证设备名、身份公钥与临时公钥，防止同网篡改待登记身份 */
  pairingConfirm: string;
}

export interface MobilePairResult {
  v: 2;
  deviceId: string;
  desktopIdentityPubKey: string;
  /** 配对时恒为 ['read']；提权到 write 是桌面上的独立显式操作 */
  scopes: ['read'];
}

/** 配对码与密钥确认已通过；手机收到后才显示本机算出的 SAS。 */
export interface MobilePairPending {
  v: 2;
  kind: 'pairPending';
  pairingId: string;
}

/**
 * 桌面在每条连接上的开场消息，先于手机的 MobileHandshake。
 * 手机没有桌面的临时公钥就算不出待签转录，所以桌面必须先说话。
 * 不含任何设备信息：未配对的探测者从中学不到东西。
 */
export interface MobileServerHello {
  v: 2;
  kind: 'serverHello';
  ephemeralPubKey: string;
}

/** 桌面用配对时保存的长期身份密钥签完整握手转录。 */
export interface MobileServerAuth {
  v: 2;
  kind: 'serverAuth';
  signature: string;
}

export interface MobileHandshake {
  v: 2;
  deviceId: string;
  ephemeralPubKey: string;
  nonce: string;
  signature: string;
}

export interface MobileFrame {
  v: 2;
  deviceId: string;
  /** 每会话严格递增，起点为 1；重复或回退即判重放 */
  counter: number;
  ciphertext: string;
  tag: string;
}

export type TerminalTransportRenderer = 'native-grid' | 'legacy-webview';
export type TerminalViewPreference = 'reflow-view' | 'exact-grid-view' | 'webview' | 'swiftterm-view';
export type TerminalFontPreference = 'menlo' | 'jetbrains-mono';
export type TerminalKeyboardMode = 'simple' | 'full';
export type TerminalShortcutKey = 'c' | 'd' | 'z';
export interface TerminalShortcutBindings {
  interrupt: TerminalShortcutKey;
  eof: TerminalShortcutKey;
  cancel: TerminalShortcutKey;
}
export type MobileServerCapability =
  | 'terminal-grid-v1'
  | 'workspace-files-v1'
  | 'workspace-office-preview-v1'
  | 'panel-states-v1';
/** Desktop lamp per panel (MOBILE-SESSION-RUN-STATE-01): red = needs_input/error/unread, yellow = running, green = idle. */
export type MobilePanelStatus = 'needs_input' | 'error' | 'unread' | 'running' | 'idle';
export interface MobilePanelState {
  panelId: string;
  status: MobilePanelStatus;
}
export const MOBILE_CAPABILITY_PROBE_REQUEST_ID = 'req_capability_probe_v1';
/**
 * 第二代探针：回复完整能力表。v1 探针的回复永远只含 terminal-grid-v1——已发布的手机按精确
 * 枚举解析 capabilities，多一个串就会丢弃整份工作区列表（ADR-003 §14）。
 */
export const MOBILE_CAPABILITY_PROBE_V2_REQUEST_ID = 'req_capability_probe_v2';

/** ADR-003 §14 工作区文件：Mac 右键菜单的写操作，经同一个 WorkspaceFs 执行。 */
export type MobileFileMutation =
  | { op: 'createFile'; dirSubPath: string; name: string }
  | { op: 'createDir'; dirSubPath: string; name: string }
  | { op: 'rename'; subPath: string; name: string }
  | { op: 'delete'; subPath: string }
  | { op: 'paste'; sourceSubPath: string; mode: 'copy' | 'cut'; targetDirSubPath: string };
export type MobileFileMutationOp = MobileFileMutation['op'];
export type MobileFileContentKind =
  | 'text' | 'image' | 'pdf' | 'audio' | 'video' | 'office' | 'unsupported' | 'too_large' | 'binary';
/** 新于初版文件协议的内容种类：手机须在 openFile 里显式声明接受，旧手机永远收不到。 */
export type MobileFileOptInContentKind = 'office';
export interface MobileFileEntry {
  name: string;
  dir: boolean;
  hidden: boolean;
}

export type TerminalGridColor =
  | { kind: 'palette'; index: number }
  | { kind: 'rgb'; value: number };

export interface TerminalGridStyle {
  foreground?: TerminalGridColor;
  background?: TerminalGridColor;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  inverse: boolean;
  invisible: boolean;
  strikethrough: boolean;
  overline: boolean;
}

export interface TerminalGridSpan {
  column: number;
  width: number;
  text: string;
  style: TerminalGridStyle;
}

export interface TerminalGridRow {
  wrapped: boolean;
  spans: TerminalGridSpan[];
}

export interface TerminalGridFrame {
  kind: 'terminalGridFrame';
  panelId: string;
  revision: number;
  upperSeq: number;
  full: boolean;
  cols: number;
  rows: number;
  screen: 'normal' | 'alternate';
  omittedLines: number;
  scrolledRows: number;
  historyRows: TerminalGridRow[];
  viewportRows: TerminalGridRow[];
  cursor?: { row: number; column: number; visible: boolean };
}

export type MobileCommand =
  | { kind: 'listWorkspaces'; requestId?: string }
  | { kind: 'listPanels'; requestId?: string }
  | { kind: 'listRooms'; requestId?: string }
  | { kind: 'listNotifications'; requestId: string }
  | { kind: 'markNotificationsRead'; requestId: string; cursor: number }
  | { kind: 'watchPanelStates'; requestId: string }
  | { kind: 'markPanelRead'; requestId: string; panelId: string }
  | { kind: 'getCollaborationProfile'; requestId: string; workspaceCapability: string }
  | {
      kind: 'setCollaborationAvatar';
      requestId: string;
      workspaceCapability: string;
      avatar: string;
    }
  | {
      kind: 'createSurface';
      requestId: string;
      workspaceCapability: string;
      surfaceKind: MobileSurfaceKind;
    }
  | { kind: 'closeSurface'; requestId: string; panelId: string; epoch: number }
  | {
      kind: 'attach';
      requestId?: string;
      panelId: string;
      afterSeq?: number;
      viewportFirst?: true;
      terminalRenderer?: TerminalTransportRenderer;
      cols?: number;
      rows?: number;
    }
  | { kind: 'queryOwnership'; requestId: string; panelId: string }
  | { kind: 'attachRoom'; roomCapability: string }
  | { kind: 'sendRoom'; requestId: string; roomCapability: string; text: string }
  | {
      kind: 'beginRoomImageUpload';
      requestId: string;
      roomCapability: string;
      mime: MobileRoomImageMime;
      byteLength: number;
      sha256: string;
      chunkCount: number;
    }
  | {
      kind: 'roomImageChunk';
      requestId: string;
      uploadCapability: string;
      index: number;
      data: string;
    }
  | {
      kind: 'commitRoomMessage';
      requestId: string;
      roomCapability: string;
      text: string;
      uploadCapabilities: string[];
    }
  | {
      kind: 'beginRoomImageDownload';
      requestId: string;
      roomCapability: string;
      messageId: string;
      imageIndex: number;
    }
  | {
      kind: 'readRoomImageChunk';
      requestId: string;
      imageCapability: string;
      index: number;
    }
  | {
      kind: 'beginTerminalImageUpload';
      requestId: string;
      panelId: string;
      epoch: number;
      mime: MobileRoomImageMime;
      byteLength: number;
      sha256: string;
      chunkCount: number;
    }
  | {
      kind: 'terminalImageChunk';
      requestId: string;
      uploadCapability: string;
      index: number;
      data: string;
    }
  | {
      kind: 'commitTerminalImageMessage';
      requestId: string;
      panelId: string;
      epoch: number;
      uploadCapability: string;
      text: string;
    }
  | { kind: 'write'; requestId?: string; panelId: string; data: string; epoch: number; paste?: boolean }
  | { kind: 'writeBytes'; requestId?: string; panelId: string; data: string; epoch: number }
  | { kind: 'sendKey'; requestId?: string; panelId: string; key: TerminalKeyName; modifiers?: TerminalKeyModifiers; epoch: number }
  | { kind: 'mouse'; requestId?: string; panelId: string; action: TerminalMouseAction; button?: TerminalMouseButton; column: number; row: number; modifiers?: TerminalKeyModifiers; epoch: number }
  | { kind: 'copy'; requestId: string; panelId: string; mode: 'screen' | 'scrollback' }
  | { kind: 'resize'; panelId: string; cols: number; rows: number }
  | { kind: 'takeover'; requestId: string; panelId: string }
  | { kind: 'returnToDesktop'; requestId: string; panelId: string; epoch: number }
  | { kind: 'listFiles'; requestId: string; workspaceCapability: string; subPath: string }
  | {
      kind: 'openFile';
      requestId: string;
      workspaceCapability: string;
      subPath: string;
      acceptContentKinds?: MobileFileOptInContentKind[];
    }
  | { kind: 'readFileChunk'; requestId: string; fileCapability: string; index: number }
  | ({ kind: 'mutateFile'; requestId: string; workspaceCapability: string } & MobileFileMutation)
  | {
      kind: 'saveFile';
      requestId: string;
      workspaceCapability: string;
      subPath: string;
      expectedRevision: string;
      content: string;
    }
  | { kind: 'heartbeat'; requestId?: string };

export type MobileEvent =
  | {
      kind: 'workspaceList';
      requestId?: string;
      capabilities?: MobileServerCapability[];
      workspaces: MobileWorkspaceSummary[];
    }
  | { kind: 'panelList'; requestId?: string; panels: MobilePanelSummary[] }
  | { kind: 'panelStates'; requestId?: string; panels: MobilePanelState[] }
  | { kind: 'roomList'; requestId?: string; rooms: MobileRoomSummary[] }
  | {
      kind: 'notificationList';
      requestId: string;
      readCursor: number;
      latestCursor: number;
      notifications: MobileNotificationSummary[];
    }
  | { kind: 'notificationsRead'; requestId: string; readCursor: number }
  | { kind: 'collaborationProfile'; requestId?: string; avatar: string | null }
  | {
      kind: 'roomHistory';
      roomCapability: string;
      messages: MobileRoomMessage[];
      omittedMessages: number;
    }
  | { kind: 'roomMessage'; roomCapability: string; message: MobileRoomMessage }
  | { kind: 'roomSendAccepted'; requestId: string; roomCapability: string }
  | { kind: 'terminalWriteAccepted'; requestId: string; panelId: string }
  | { kind: 'terminalCopyResult'; requestId: string; panelId: string; mode: 'screen' | 'scrollback'; text: string }
  | {
      kind: 'roomImageUploadReady';
      requestId: string;
      roomCapability: string;
      uploadCapability: string;
      expiresInMs: 120_000;
    }
  | {
      kind: 'roomImageChunkAccepted';
      requestId: string;
      uploadCapability: string;
      nextIndex: number;
    }
  | {
      kind: 'roomImageDownloadReady';
      requestId: string;
      roomCapability: string;
      messageId: string;
      imageIndex: number;
      imageCapability: string;
      mime: MobileRoomImageMime;
      byteLength: number;
      sha256: string;
      chunkCount: number;
      expiresInMs: 120_000;
    }
  | {
      kind: 'roomImageDownloadChunk';
      requestId: string;
      imageCapability: string;
      index: number;
      data: string;
      complete: boolean;
    }
  | {
      kind: 'terminalImageUploadReady';
      requestId: string;
      panelId: string;
      uploadCapability: string;
      expiresInMs: 120_000;
    }
  | {
      kind: 'terminalImageChunkAccepted';
      requestId: string;
      uploadCapability: string;
      nextIndex: number;
    }
  | { kind: 'terminalImageMessageAccepted'; requestId: string; panelId: string }
  | {
      kind: 'surfaceCreateAccepted';
      requestId: string;
      workspaceCapability: string;
      surfaceKind: MobileSurfaceKind;
    }
  | { kind: 'surfaceCloseAccepted'; requestId: string; panelId: string }
  | TerminalGridFrame
  | {
      kind: 'ptyReplay';
      panelId: string;
      oldestSeq: number;
      upperSeq: number;
      droppedLines: number;
      /** Retained by desktop but omitted from the bounded mobile replay. */
      omittedLines?: number;
      /** Serialized authoritative VT state through snapshotSeq. */
      snapshot?: string;
      snapshotSeq?: number;
      /** Current PTY geometry; paired and optional for compatibility with older peers. */
      cols?: number;
      rows?: number;
    }
  | {
      kind: 'ptyData';
      id: string;
      seq: number;
      upperSeq?: number;
      data: string;
      /** Geometry that produced this output batch; always paired when present. */
      cols?: number;
      rows?: number;
    }
  | {
      kind: 'ptyReplayStart';
      panelId: string;
      oldestSeq: number;
      upperSeq: number;
      droppedLines: number;
      omittedLines: number;
      snapshotSeq: number;
      cols: number;
      rows: number;
      snapshotBytes: number;
      fragmentCount: number;
    }
  | {
      kind: 'ptyReplayChunk';
      panelId: string;
      snapshotSeq: number;
      fragmentIndex: number;
      /** Base64 bytes. Fragments may split a UTF-8 code point and are decoded only after commit. */
      data: string;
    }
  | {
      kind: 'ptyReplayCommit';
      panelId: string;
      snapshotSeq: number;
      snapshotBytes: number;
      fragmentCount: number;
    }
  | { kind: 'ptyReplayAbort'; panelId: string }
  | {
      kind: 'ptyHistoryStart';
      panelId: string;
      snapshotSeq: number;
      omittedLines: number;
      cols: number;
      rows: number;
      snapshotBytes: number;
      fragmentCount: number;
    }
  | {
      kind: 'ptyHistoryChunk';
      panelId: string;
      snapshotSeq: number;
      fragmentIndex: number;
      data: string;
    }
  | {
      kind: 'ptyHistoryCommit';
      panelId: string;
      snapshotSeq: number;
      snapshotBytes: number;
      fragmentCount: number;
    }
  | { kind: 'ptyHistoryAbort'; panelId: string }
  | { kind: 'attachReady'; requestId: string; panelId: string }
  | { kind: 'ptyExit'; id: string; exitCode: number }
  | { kind: 'deviceAccess'; scopes: MobileScope[] }
  | {
      kind: 'ownership';
      requestId?: string;
      panelId: string;
      owner: 'desktop' | 'mobile';
      epoch: number;
      /** 缺失按 false：旧 peer 不得让当前手机误以为自己持有控制权。 */
      controlledByThisDevice?: boolean;
    }
  | {
      kind: 'error';
      code: string;
      category: MobileErrorCategory;
      requestId?: string;
      panelId?: string;
      message?: string;
    }
  | {
      kind: 'fileList';
      requestId: string;
      workspaceCapability: string;
      subPath: string;
      entries: MobileFileEntry[];
      truncated: boolean;
    }
  | {
      kind: 'fileOpened';
      requestId: string;
      workspaceCapability: string;
      subPath: string;
      contentKind: MobileFileContentKind;
      /** 只有 text 与限额内可预览媒体才签发；其余种类是不带内容的诚实回答。 */
      fileCapability?: string;
      mime?: string;
      byteLength: number;
      sha256?: string;
      chunkCount: number;
      expiresInMs?: 120000;
    }
  | {
      kind: 'fileChunk';
      requestId: string;
      fileCapability: string;
      index: number;
      data: string;
      complete: boolean;
    }
  | {
      kind: 'fileMutationAccepted';
      requestId: string;
      workspaceCapability: string;
      op: MobileFileMutationOp;
      name?: string;
    }
  | {
      kind: 'fileSaved';
      requestId: string;
      workspaceCapability: string;
      subPath: string;
      revision: string;
      byteLength: number;
    }
  | { kind: 'heartbeat'; requestId?: string };

export interface MobilePanelSummary {
  panelId: string;
  kind: 'claude' | 'codex' | 'shell';
  /** 可含工作区 basename 供用户辨认，但不得包含规范路径或父目录。 */
  label: string;
  workspaceCapability: string;
  workspaceLabel: string;
}

export interface MobileRoomSummary {
  roomCapability: string;
  label: string;
  workspaceCapability: string;
  workspaceLabel: string;
}

export interface MobileRoomMessage {
  id: string;
  from: 'user' | 'claude' | 'codex' | 'system';
  text: string;
  ts: number;
  pending?: boolean;
  queued?: boolean;
  model?: string;
  /** Attachments remain desktop-local; mobile receives only an honest count. */
  imageCount?: number;
}

export type MobileRoomImageMime = 'image/png' | 'image/jpeg';

export type MobileSurfaceKind = 'claude' | 'codex' | 'shell' | 'collaboration';

export interface MobileWorkspaceSummary {
  workspaceCapability: string;
  /** 只允许 canonical workspace 的 basename；不得包含父目录。 */
  label: string;
  activeSurfaceCount: number;
}

export type MobileNotificationKind = WorkspaceAttention['kind'];

export interface MobileNotificationStoredRecord {
  notificationId: string;
  eventId: string;
  workspacePath: string;
  kind: MobileNotificationKind;
  target: WorkspaceTarget;
  createdAt: string;
}

export interface MobileNotificationDelivery {
  notificationId: string;
  cursor: number;
}

export interface MobileNotificationDeviceState {
  deviceId: string;
  nextCursor: number;
  readCursor: number;
  updatedAt: string;
  deliveries: MobileNotificationDelivery[];
}

export interface MobileNotificationStoreState {
  schemaVersion: 1;
  records: MobileNotificationStoredRecord[];
  devices: MobileNotificationDeviceState[];
}

export type MobileNotificationTarget =
  | { type: 'panel'; panelId: string }
  | { type: 'room'; roomCapability: string };

export interface MobileNotificationSummary {
  notificationId: string;
  cursor: number;
  kind: MobileNotificationKind;
  title: '任务已完成' | '等待你处理' | '任务失败';
  createdAt: string;
  workspaceCapability: string;
  workspaceLabel: string;
  read: boolean;
  target?: MobileNotificationTarget;
}

/** 主进程重新验证 recent + trust 后，要求 renderer 打开并挂载工作区。 */
export interface MobileWorkspaceOpenDispatch {
  schemaVersion: 1;
  requestId: string;
  workspacePath: string;
}

export interface MobileWorkspaceOpenAck {
  schemaVersion: 1;
  requestId: string;
  accepted: boolean;
  message?: string;
}

/** 主进程通过全部远端闸门后发给权威 renderer 的本地请求。 */
export interface MobileSurfaceDispatch {
  schemaVersion: 1;
  requestId: string;
  workspacePath: string;
  surfaceKind: MobileSurfaceKind;
}

/** 主进程完成全部远程关闭闸门后发给权威 renderer 的本地请求。 */
export interface MobileSurfaceCloseDispatch {
  schemaVersion: 1;
  requestId: string;
  workspacePath: string;
  panelId: string;
}

export interface MobileSurfaceAck {
  schemaVersion: 1;
  requestId: string;
  accepted: boolean;
  message?: string;
}

export interface MobileDeviceRecord {
  v: 2;
  deviceId: string;
  name: string;
  /** 手机 Ed25519 身份公钥，base64；握手签名验证需要完整公钥 */
  identityPubKey: string;
  /** 手机 Ed25519 身份公钥的 SHA-256，小写十六进制；仅供 UI 截断显示 */
  identityFingerprint: string;
  pairedAt: string;
  lastSeenAt: string | null;
  scopes: MobileScope[];
  /** 软删除：留时间戳供审计，但行为上等同不存在 */
  revokedAt: string | null;
}

/** 移动桥运行状态（renderer 视图）。 */
export interface MobileBridgeStatus {
  schemaVersion: 1;
  enabled: boolean;
  /** 用户配置：桥真实监听时阻止 macOS 自动休眠。 */
  keepAwake: boolean;
  /** 系统电源断言当前是否真实生效，不等同于 keepAwake 配置值。 */
  sleepBlockerActive: boolean;
  /** 实际监听地址；未监听时为 null */
  listening: { host: string; port: number } | null;
  /**
   * 正在监听的地址已不再是当前应选的私网地址（典型：Tailscale 晚于 Connect 启动，
   * 桥停在 LAN 回退地址上）。桥**不会**自行改绑——那会让已配对设备的 host 失效——
   * 只如实告诉用户需要重开一次。未监听时恒为 false。
   */
  addressStale: boolean;
}

/** 二维码载荷（renderer 视图）。只含连接信息，不含凭据或工作区路径。 */
export interface MobilePairingQr {
  v: 2;
  host: string;
  port: number;
  pairingCode: string;
  desktopEphemeralPubKey: string;
  /** 扫码带入的桌面长期身份；手机只接受与它一致的配对结果 */
  desktopIdentityPubKey: string;
  /** 配对码签发时刻（epoch ms），供 UI 算 90 秒倒计时 */
  issuedAtMs: number;
  expiresInMs: number;
}

/** 设备列表项（renderer 视图）。指纹截断到前 8 位由 UI 决定，这里给完整值。 */
export interface MobileDeviceView {
  deviceId: string;
  name: string;
  identityFingerprint: string;
  pairedAt: string;
  lastSeenAt: string | null;
  scopes: MobileScope[];
  /** 当前是否有活动连接 */
  connected: boolean;
}

export type MobileThemePreference = 'system' | 'dark' | 'light';
export type LanguagePreference = 'system' | 'zh-Hans' | 'zh-Hant' | 'en';

/** 手机本地偏好；不授予任何桌面或工作区能力。 */
export interface MobilePreferences {
  v: 2;
  theme: MobileThemePreference;
  language: LanguagePreference;
  terminalView: TerminalViewPreference;
  /** 旧 v2 记录缺少该字段；读取时归一为 simple。 */
  keyboardMode?: TerminalKeyboardMode;
  /** 旧 v2 记录缺少该字段；读取时归一为 Ctrl+C/D/Z。 */
  terminalShortcuts?: TerminalShortcutBindings;
  /** 旧 v2 记录缺少该字段；读取时归一为 menlo。 */
  terminalFont?: TerminalFontPreference;
  /** 手机持有输入时终端几何是否跟随手机；旧 v2 记录缺少该字段，读取时归一为 true。 */
  takeoverFollowsPhone?: boolean;
  /** 打开终端时是否自动接管输入；旧 v2 记录缺少该字段，读取时归一为 true。仅对已授予 write 的设备生效。 */
  autoTakeover?: boolean;
  notifications: {
    enabled: boolean;
    pending: boolean;
    completed: boolean;
    failed: boolean;
  };
}

export type DesktopUpdateChannel = 'local' | 'preview' | 'beta' | 'stable';
export type DesktopUpdatePhase =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error';
export type DesktopUpdateErrorCode =
  | 'configuration'
  | 'network'
  | 'metadata'
  | 'signature'
  | 'download'
  | 'install'
  | 'unknown';
export type DesktopUpdateMessageKey =
  | 'update_configuration_error'
  | 'update_network_error'
  | 'update_metadata_error'
  | 'update_signature_error'
  | 'update_download_error'
  | 'update_install_error'
  | 'update_unknown_error';

export interface DesktopUpdateError {
  code: DesktopUpdateErrorCode;
  category: 'retryable' | 'action_required' | 'permanent';
  messageKey: DesktopUpdateMessageKey;
}

export interface DesktopUpdateState {
  schemaVersion: 1;
  channel: DesktopUpdateChannel;
  currentVersion: string;
  phase: DesktopUpdatePhase;
  availableVersion: string | null;
  progressPercent: number | null;
  transferredBytes: number | null;
  totalBytes: number | null;
  skipped: boolean;
  autoCheck: boolean;
  lastCheckedAt: string | null;
  error: DesktopUpdateError | null;
}

export interface DesktopUpdatePreferences {
  schemaVersion: 1;
  autoCheck: boolean;
  skippedVersion: string | null;
}
