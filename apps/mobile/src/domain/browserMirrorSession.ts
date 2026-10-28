import {
  BROWSER_KEY_WHITELIST,
  BROWSER_MIRROR_LIMITS,
  type MobileBrowserKeyName,
  type MobileBrowserResolvedTier,
} from '../../../../src/shared/mobileBrowserMirror';

/**
 * 内置网页面板手机镜像的界面状态（ADR-003 §19，设计 §5.5）。
 *
 * 纯逻辑、不 import react-native：帧到达、Ack 节奏、坐标归一化、错误码映射都在
 * 这里经 jest 验证；App.tsx 只做接线和发送。列表条目只有桌面给的 bcap 与标题，
 * **永远不出现 URL 或路径**（与 terminalGridFrame 同样的「只信结构化标签」口径）。
 */

export interface BrowserPanelEntry {
  browserCapability: string;
  title: string;
  workspaceCapability: string;
  workspaceLabel: string;
}

/** 一帧已解密画面（JPEG → base64，RN Image 以 data URI 消费）。 */
export interface DisplayedBrowserFrame {
  seq: number;
  jpegBase64: string;
  byteLength: number;
  viewportWidth: number;
  viewportHeight: number;
  encodedWidth: number;
  encodedHeight: number;
  sharp: boolean;
}

export type BrowserMirrorPhase = 'starting' | 'live' | 'paused' | 'stopped';

export interface BrowserMirrorViewState {
  browserCapability: string;
  phase: BrowserMirrorPhase;
  tier: MobileBrowserResolvedTier | null;
  pausedReason: 'idle' | 'background' | 'relay-budget' | null;
  /** 是否已收到过本路流的帧（画面本体在 BrowserFrameHost，不进 App 状态）。 */
  hasLiveFrame: boolean;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  owner: 'desktop' | 'mobile';
  controlledByThisDevice: boolean;
  /** 桌面权威 epoch；输入与导航都要带上它。 */
  epoch: number | null;
}

export interface BrowserMirrorState {
  panels: BrowserPanelEntry[];
  /** 当前打开的观看器；同一连接同时只有一路（协议约束）。 */
  view: BrowserMirrorViewState | null;
}

export const initialBrowserMirrorState: BrowserMirrorState = { panels: [], view: null };

export type BrowserMirrorAction =
  | { type: 'panels_changed'; panels: BrowserPanelEntry[] }
  | { type: 'open'; browserCapability: string }
  | { type: 'close' }
  | { type: 'view_started'; browserCapability: string; tier: MobileBrowserResolvedTier }
  | { type: 'view_stopped'; browserCapability: string; reason: string }
  | {
      type: 'state';
      browserCapability: string;
      title: string;
      loading: boolean;
      canGoBack: boolean;
      canGoForward: boolean;
      owner: 'desktop' | 'mobile';
      epoch: number;
      controlledByThisDevice: boolean;
    }
  | { type: 'paused'; browserCapability: string; reason: 'idle' | 'background' | 'relay-budget' }
  | { type: 'frame_active'; browserCapability: string }
  | { type: 'connection_lost' }
  | { type: 'reset' };

function applyAction(state: BrowserMirrorState, action: BrowserMirrorAction): BrowserMirrorState {
  switch (action.type) {
    case 'panels_changed':
      return { ...state, panels: action.panels };
    case 'open': {
      if (state.view?.browserCapability === action.browserCapability) return state;
      return {
        ...state,
        view: {
          browserCapability: action.browserCapability,
          phase: 'starting',
          tier: null,
          pausedReason: null,
          hasLiveFrame: false,
          title: state.panels.find((panel) => panel.browserCapability === action.browserCapability)?.title ?? '',
          loading: false,
          canGoBack: false,
          canGoForward: false,
          owner: 'desktop',
          controlledByThisDevice: false,
          epoch: null,
        },
      };
    }
    case 'close':
      return { ...state, view: null };
    case 'view_started': {
      const view = state.view;
      if (view === null || view.browserCapability !== action.browserCapability) return state;
      // 新一路流重新开始：帧本体留在 BrowserFrameHost 里继续垫着（断线保持），
      // 状态只标记“这一路还没收到新帧”。
      return {
        ...state,
        view: {
          ...view,
          phase: 'live',
          tier: action.tier,
          pausedReason: null,
          hasLiveFrame: false,
        },
      };
    }
    case 'view_stopped': {
      const view = state.view;
      if (view === null || view.browserCapability !== action.browserCapability) return state;
      return { ...state, view: { ...view, phase: 'stopped', pausedReason: null } };
    }
    case 'state': {
      const view = state.view;
      if (view === null || view.browserCapability !== action.browserCapability) return state;
      // epoch 单调不回退：乱序到达的旧状态不得把权威值拉低。
      const epoch = view.epoch === null ? action.epoch : Math.max(view.epoch, action.epoch);
      return {
        ...state,
        view: {
          ...view,
          title: action.title,
          loading: action.loading,
          canGoBack: action.canGoBack,
          canGoForward: action.canGoForward,
          owner: action.owner,
          controlledByThisDevice: action.controlledByThisDevice,
          epoch,
        },
      };
    }
    case 'paused': {
      const view = state.view;
      if (view === null || view.browserCapability !== action.browserCapability) return state;
      return { ...state, view: { ...view, phase: 'paused', pausedReason: action.reason } };
    }
    case 'frame_active': {
      const view = state.view;
      if (view === null || view.browserCapability !== action.browserCapability) return state;
      // 帧到达即说明推流活着：暂停遮罩（idle）随之撤下。画面本体在 host，这里只翻状态位。
      if (view.phase === 'live' && view.hasLiveFrame) return state;
      return {
        ...state,
        view: { ...view, phase: 'live', pausedReason: null, hasLiveFrame: true },
      };
    }
    case 'connection_lost': {
      const view = state.view;
      if (view === null) return state;
      // 断线保持（ADR-003 §11）：画面留着（host 不清），标记停止等待重连恢复。
      return { ...state, view: { ...view, phase: 'stopped', pausedReason: null } };
    }
    case 'reset':
      return initialBrowserMirrorState;
    default:
      return state;
  }
}

export function reduceBrowserMirror(
  state: BrowserMirrorState,
  action: BrowserMirrorAction | readonly BrowserMirrorAction[],
): BrowserMirrorState {
  // Array.isArray 不收窄 readonly 数组：显式判一次，调用方可以一次送一串动作。
  if (Array.isArray(action)) {
    return (action as readonly BrowserMirrorAction[]).reduce<BrowserMirrorState>(applyAction, state);
  }
  return applyAction(state, action as BrowserMirrorAction);
}

/**
 * 显示几何（用户 2026-10-28 反馈「上下的布局有问题」后的修订）：
 * 画面默认**撑满观看区**（cover）——比观看区更宽的帧按高度贴合、左右溢出可平移；
 * 比观看区更高的帧按宽度贴合、上下溢出可平移。此前的「整页缩到屏宽」在宽面板下
 * 只剩屏幕上一小条、窄竖条面板下画面比屏幕还高被硬裁，两种都不成立。
 */
export function browserDisplayGeometry(input: {
  containerWidth: number;
  containerHeight: number;
  encodedWidth: number;
  encodedHeight: number;
}): { width: number; height: number } {
  const cw = Math.max(1, input.containerWidth);
  const ch = Math.max(1, input.containerHeight);
  const ew = Math.max(1, input.encodedWidth);
  const eh = Math.max(1, input.encodedHeight);
  const imageAspect = ew / eh;
  const boxAspect = cw / ch;
  if (imageAspect > boxAspect) {
    // 帧更宽：贴合高度，横向溢出。
    return { width: Math.round(ch * imageAspect), height: Math.round(ch) };
  }
  // 帧更高（或同比例）：贴合宽度，纵向溢出。
  return { width: Math.round(cw), height: Math.round(cw / imageAspect) };
}

/** cover 起始把溢出的那一维居中：不满的一维贴 0（画面恰好撑满）。 */
export function browserCenteredPan(
  geometry: { width: number; height: number },
  container: { width: number; height: number },
): { x: number; y: number } {
  return {
    x: Math.min(0, Math.round((container.width - geometry.width) / 2)),
    y: Math.min(0, Math.round((container.height - geometry.height) / 2)),
  };
}

/** 本地平移的边界：画面任何一维都不得拖出观看区（缩放放大后同理）。 */
export function browserClampPan(
  pan: { x: number; y: number },
  zoom: number,
  geometry: { width: number; height: number } | null,
  container: { width: number; height: number },
): { x: number; y: number } {
  if (geometry === null || container.width <= 0) return { x: 0, y: 0 };
  const maxX = Math.min(0, container.width - geometry.width * zoom);
  const maxY = Math.min(0, container.height - geometry.height * zoom);
  return {
    x: Math.max(maxX, Math.min(0, pan.x)),
    y: Math.max(maxY, Math.min(0, pan.y)),
  };
}

/** 12 键白名单之外的任何按键都到不了发送层。 */
export function isBrowserKeyName(key: string): key is MobileBrowserKeyName {
  return (BROWSER_KEY_WHITELIST as readonly string[]).includes(key);
}

/**
 * 触点 → 页面归一化坐标（0..1，分母 = 帧的 CSS 视口；设计 §5.5）。
 *
 * 双指缩放与平移只是手机本地显示：把触点换算回「画面上的位置」再除以画面尺寸，
 * 发出去的坐标与缩放无关。imageWidth/Height 是缩放为 1（整页缩到屏宽）时的画面尺寸。
 */
export function browserPointerFromTouch(input: {
  touchX: number;
  touchY: number;
  scale: number;
  panX: number;
  panY: number;
  imageWidth: number;
  imageHeight: number;
}): { x: number; y: number } {
  const scale = input.scale > 0 ? input.scale : 1;
  const width = input.imageWidth > 0 ? input.imageWidth : 1;
  const height = input.imageHeight > 0 ? input.imageHeight : 1;
  const x = (input.touchX - input.panX) / (width * scale);
  const y = (input.touchY - input.panY) / (height * scale);
  return {
    x: Math.min(1, Math.max(0, x)),
    y: Math.min(1, Math.max(0, y)),
  };
}

/**
 * 未缩放时的一指拖动 = 页面滚轮：屏幕像素按「整页缩到屏宽」的比率换算成 CSS 像素。
 * 手指向下拖 = 内容上滚（wheelY 为负），与触屏浏览习惯一致。
 */
export function browserWheelFromDrag(input: {
  dragDownPx: number;
  dragRightPx: number;
  imageWidth: number;
  /** 只用到宽度两项；传整帧元数据也可以（调用点直接给帧）。 */
  frame: { viewportWidth: number; encodedWidth: number; viewportHeight?: number; encodedHeight?: number };
}): { deltaX: number; deltaY: number } {
  const referenceWidth = input.frame.viewportWidth > 0
    ? input.frame.viewportWidth
    : input.frame.encodedWidth;
  const imageWidth = input.imageWidth > 0 ? input.imageWidth : 1;
  const cssPerPixel = referenceWidth / imageWidth;
  const clamp = (value: number): number => {
    const rounded = Math.round(value) || 0;
    return Math.max(-BROWSER_MIRROR_LIMITS.wheelDeltaMax, Math.min(BROWSER_MIRROR_LIMITS.wheelDeltaMax, rounded));
  };
  return {
    deltaX: clamp(-input.dragRightPx * cssPerPixel),
    deltaY: clamp(-input.dragDownPx * cssPerPixel),
  };
}

/** insertText 只送非空文本，长度按协议上限截断（中文上屏文字原样直送）。 */
export function clampBrowserInsertText(text: string): string | null {
  if (text.length === 0) return null;
  return text.slice(0, BROWSER_MIRROR_LIMITS.insertTextMaxLength);
}

/**
 * 空闲暂停后的恢复通道：本机持有控制权时任何输入都会唤醒桌面引擎
 * （noteActivity）——轻点遮罩把这次轻点直接送到页面（拿不到触点就送中性的
 * wheel 0,0）；否则只能重开观看流。
 */
export function browserResumeAction(
  view: BrowserMirrorViewState,
): { kind: 'input' } | { kind: 'view_restart' } {
  if (view.controlledByThisDevice && view.epoch !== null && view.hasLiveFrame) {
    return { kind: 'input' };
  }
  return { kind: 'view_restart' };
}

export type BrowserMirrorNotice =
  | { kind: 'none' }
  | { kind: 'message'; tone: 'info' | 'warn'; text: string };

/**
 * 错误码 → 一行克制提示（AGENTS §5.8）。按四分类兜底，不做「出错了」式的统一文案；
 * `browser_input_stale_frame` 是桌面按设计的静默丢弃，不打扰用户。
 */
export function browserMirrorErrorPresentation(
  code: string,
  category: 'retryable' | 'action_required' | 'permanent' | 'ambiguous',
): BrowserMirrorNotice {
  switch (code) {
    case 'browser_input_stale_frame':
      return { kind: 'none' };
    case 'browser_input_throttled':
    case 'browser_takeover_throttled':
    case 'browser_nav_throttled':
      return { kind: 'message', tone: 'info', text: '操作太频繁，请稍等' };
    case 'browser_view_throttled':
      return { kind: 'message', tone: 'info', text: '刷新太频繁，请稍等' };
    case 'epoch_denied':
      return { kind: 'message', tone: 'warn', text: '控制权已变化，请重新接管' };
    case 'not_attached':
      return { kind: 'message', tone: 'warn', text: '请退出后重新打开这个网页' };
    case 'browser_capability_expired':
      return { kind: 'message', tone: 'warn', text: '网页面板已变化，请刷新' };
    case 'browser_panel_closed':
      return { kind: 'message', tone: 'warn', text: '网页已在电脑上关闭' };
    case 'browser_mirror_unavailable':
      return { kind: 'message', tone: 'warn', text: '电脑端暂不支持网页镜像' };
    case 'workspace_authorization_expired':
      return { kind: 'message', tone: 'warn', text: '项目授权已变化，请刷新' };
    case 'mobile_bridge_rejected':
      return { kind: 'message', tone: 'warn', text: '当前设备没有操作权限' };
    case 'audit_unavailable':
      return { kind: 'message', tone: 'warn', text: '操作未完成，请重试' };
    default:
      switch (category) {
        case 'retryable':
          return { kind: 'message', tone: 'info', text: '操作未完成，请重试' };
        case 'action_required':
          return { kind: 'message', tone: 'warn', text: '请刷新后重试' };
        case 'ambiguous':
          return { kind: 'message', tone: 'warn', text: '结果未能确认，请查看画面' };
        default:
          return { kind: 'message', tone: 'warn', text: '操作被电脑拒绝' };
      }
  }
}
