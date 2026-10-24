export type ConnectionState =
  | 'unpaired'
  | 'online'
  | 'confirming'
  | 'reconnecting'
  | 'offline';
export type OwnershipState =
  | 'desktop_owned'
  | 'takeover_pending'
  | 'mobile_owned'
  | 'other_mobile_owned'
  | 'return_pending'
  | 'reconciling';
export type OwnershipAuthority = Extract<
  OwnershipState,
  'desktop_owned' | 'mobile_owned' | 'other_mobile_owned'
> | null;
export type AgentKind = 'claude' | 'codex' | 'shell';
export type SurfaceKind = AgentKind | 'collaboration';
export type TaskPhase =
  | 'idle'
  | 'running'
  | 'stopping'
  | 'waiting_confirmation'
  | 'retryable_failure'
  | 'action_required'
  | 'failed'
  | 'ambiguous'
  | 'stopped'
  | 'completed';
export type MobileIntent =
  | 'send'
  | 'stop'
  | 'continue'
  | 'approve'
  | 'reject'
  | 'retry'
  | 'takeover'
  | 'return_to_desktop'
  | 'reconnect';
export type OwnershipIntent = Extract<
  MobileIntent,
  'takeover' | 'return_to_desktop'
>;
export type OwnershipEventDisposition = 'apply' | 'settle' | 'ignore_stale';
export type FailureCategory =
  | 'retryable'
  | 'action_required'
  | 'permanent'
  | 'ambiguous';

export interface TerminalLine {
  id: string;
  text: string;
  tone: 'default' | 'agent' | 'success' | 'warning' | 'danger';
}

export interface SessionPanelSummary {
  panelId: string;
  kind: SurfaceKind;
  label: string;
  workspaceCapability?: string;
  workspaceLabel?: string;
}

export interface SessionWorkspaceSummary {
  workspaceCapability: string;
  label: string;
  activeSurfaceCount: number;
}

/**
 * Avatar sync borrows an already-running workspace authorization. A trusted recent
 * workspace is intentionally insufficient: reading a profile must never open a project.
 */
export function collaborationProfileWorkspace(
  workspaces: readonly SessionWorkspaceSummary[],
): SessionWorkspaceSummary | undefined {
  return workspaces.find((workspace) => workspace.activeSurfaceCount > 0);
}

export interface SessionViewModel {
  deviceName: string;
  connection: ConnectionState;
  ownership: OwnershipState;
  /** Last authoritative owner. Pending/reconcile presentation must not overwrite it. */
  ownershipAuthority: OwnershipAuthority;
  agent: AgentKind;
  taskPhase: TaskPhase;
  lines: TerminalLine[];
  draft: string;
  pendingIntent: MobileIntent | null;
  isDemo: boolean;
  panels: SessionPanelSummary[];
  workspaces: SessionWorkspaceSummary[];
  activePanelId: string | null;
  ownershipEpoch: number | null;
  panelExited: boolean;
  /** 服务端实时下发的设备 write scope；不得从本地配对资料猜测。 */
  canControlInput: boolean;
  hasActivePanel: boolean;
}

export function ownershipEventDisposition(
  pendingRequestId: string | null,
  eventRequestId: string | undefined,
): OwnershipEventDisposition {
  if (pendingRequestId === null) return 'apply';
  if (eventRequestId === undefined) return 'apply';
  return eventRequestId === pendingRequestId ? 'settle' : 'ignore_stale';
}

function effectiveOwnershipAuthority(state: SessionViewModel): OwnershipAuthority {
  if (
    state.ownership === 'desktop_owned'
    || state.ownership === 'mobile_owned'
    || state.ownership === 'other_mobile_owned'
  ) return state.ownership;
  return state.ownershipAuthority;
}

export function acceptsOwnershipUpdate(
  state: SessionViewModel,
  event: Pick<
    Extract<SessionEvent, { type: 'ownership_changed' }>,
    'panelId' | 'owner' | 'epoch' | 'controlledByThisDevice'
  >,
): boolean {
  if (event.panelId !== state.activePanelId) return false;
  if (state.ownershipEpoch === null) return true;
  if (event.epoch < state.ownershipEpoch) return false;
  if (event.epoch > state.ownershipEpoch) return true;
  const currentAuthority = effectiveOwnershipAuthority(state);
  const nextAuthority: Exclude<OwnershipAuthority, null> = event.owner === 'desktop'
    ? 'desktop_owned'
    : event.controlledByThisDevice
      ? 'mobile_owned'
      : 'other_mobile_owned';
  return currentAuthority === null || currentAuthority === nextAuthority;
}

export type SessionEvent =
  | { type: 'draft_changed'; draft: string }
  | { type: 'connection_changed'; connection: ConnectionState }
  | { type: 'unpaired' }
  | { type: 'paired'; deviceName: string }
  | { type: 'panels_changed'; panels: SessionPanelSummary[]; selectedDraft?: string }
  | { type: 'workspaces_changed'; workspaces: SessionWorkspaceSummary[] }
  | { type: 'panel_selected'; panelId: string; draft?: string }
  | { type: 'panel_exited'; panelId: string }
  | { type: 'device_access_changed'; scopes: readonly ('read' | 'write')[] }
  | {
      type: 'ownership_changed';
      panelId: string;
      owner: 'desktop' | 'mobile';
      epoch: number;
      controlledByThisDevice: boolean;
      settlesPending?: boolean;
    }
  | { type: 'intent_requested'; intent: MobileIntent }
  | { type: 'intent_acknowledged'; intent: MobileIntent }
  | {
      type: 'intent_failed';
      intent: MobileIntent;
      category: FailureCategory;
    };

export function ownershipIntent(
  state: SessionViewModel,
): OwnershipIntent | null {
  if (
    state.connection !== 'online'
    || !state.hasActivePanel
    || !state.canControlInput
    || state.ownershipEpoch === null
    || state.pendingIntent !== null
  ) return null;
  if (state.ownership === 'desktop_owned') return 'takeover';
  if (state.ownership === 'mobile_owned') return 'return_to_desktop';
  return null;
}

export function canCompose(state: SessionViewModel): boolean {
  return state.connection === 'online'
    && state.hasActivePanel
    && state.canControlInput
    && state.ownership === 'mobile_owned'
    && !['stopping', 'ambiguous', 'action_required', 'failed'].includes(
      state.taskPhase,
    );
}

export function shouldCarryMobileControl(
  state: SessionViewModel,
  targetPanelId: string,
): boolean {
  const source = state.panels.find((panel) => panel.panelId === state.activePanelId);
  const target = state.panels.find((panel) => panel.panelId === targetPanelId);
  const sameWorkspace = source?.workspaceCapability === undefined
    || target?.workspaceCapability === undefined
    || source.workspaceCapability === target.workspaceCapability;
  return state.connection === 'online'
    && state.ownership === 'mobile_owned'
    && state.canControlInput
    && state.pendingIntent === null
    && targetPanelId !== state.activePanelId
    && target?.kind !== 'collaboration'
    && target !== undefined
    && sameWorkspace;
}

/**
 * Whether opening a terminal should take its input for this phone.
 *
 * User decision 2026-09-29 (ADR-003 §11): with the preference on, opening a
 * terminal is the takeover, as the last client to be used is the one it
 * serves. Only a device the desktop granted `write` may; the same takeover
 * command, gates, epoch and audit apply. It fires once per opening: if the
 * Mac takes the terminal back while the phone still shows it, the phone stays
 * a viewer until the user opens it again or taps 接管.
 */
export function shouldAutoTakeover(
  state: SessionViewModel,
  input: {
    enabled: boolean;
    armedPanelId: string | null;
    onSessionRoute: boolean;
    appActive: boolean;
  },
): boolean {
  const active = state.panels.find((panel) => panel.panelId === state.activePanelId);
  return input.enabled
    && input.onSessionRoute
    && input.appActive
    && input.armedPanelId !== null
    && input.armedPanelId === state.activePanelId
    && active !== undefined
    && active.kind !== 'collaboration'
    && !state.isDemo
    && !state.panelExited
    && state.connection === 'online'
    && state.ownership === 'desktop_owned'
    // Confirmed on this connection: the desktop answers ownership only for a
    // panel this connection has attached, so an epoch means it is attached.
    && state.ownershipEpoch !== null
    && state.canControlInput
    && state.pendingIntent === null;
}

/**
 * Only a real return from the background is a new opening. iOS passes through
 * `inactive` for Control Center, banners and the app switcher; re-arming on
 * those took a terminal back right after the user returned it. The order iOS
 * reports on the way back (background → active, or through inactive) must not
 * matter, so having been in the background is remembered until `active`.
 */
export function appStateReopen(
  wasBackgrounded: boolean,
  next: string,
): { wasBackgrounded: boolean; reopened: boolean } {
  if (next === 'background') return { wasBackgrounded: true, reopened: false };
  if (next === 'active') return { wasBackgrounded: false, reopened: wasBackgrounded };
  return { wasBackgrounded, reopened: false };
}

/**
 * The opening is over without a takeover: the terminal is already this phone's
 * or another's, or this device could not write when it was opened. A later
 * grant of write is not an opening and must not take the terminal.
 */
export function autoTakeoverArmSpent(
  state: SessionViewModel,
  armedPanelId: string | null,
): boolean {
  if (armedPanelId === null || armedPanelId !== state.activePanelId) return false;
  // Only an owner confirmed on this connection says anything about this opening.
  if (state.connection !== 'online' || state.ownershipEpoch === null) return false;
  if (state.ownership === 'mobile_owned' || state.ownership === 'other_mobile_owned') return true;
  return state.ownership === 'desktop_owned' && !state.canControlInput;
}

/** Exact capability match prevents stale or same-name workspace rows from being guessed. */
export function resolvePanelSelection(
  panels: readonly SessionPanelSummary[],
  panelId: string,
  workspaceCapability?: string,
): SessionPanelSummary | null {
  return panels.find((panel) => (
    panel.panelId === panelId
    && (workspaceCapability === undefined
      || panel.workspaceCapability === workspaceCapability)
  )) ?? null;
}

export function shouldTakeoverCreatedTerminal(
  state: SessionViewModel,
  targetPanelId: string,
  panels: readonly SessionPanelSummary[],
): boolean {
  return state.connection === 'online'
    && state.canControlInput
    && state.pendingIntent === null
    && targetPanelId !== state.activePanelId
    && panels.some((panel) => (
      panel.panelId === targetPanelId && panel.kind !== 'collaboration'
    ));
}

export function availableTaskIntents(
  state: SessionViewModel,
): MobileIntent[] {
  if (state.connection === 'unpaired') return [];
  if (!state.hasActivePanel) return [];
  if (state.connection === 'offline') return ['reconnect'];
  if (state.connection === 'confirming' || state.connection === 'reconnecting') return [];
  if (!state.canControlInput) return [];
  if (
    state.ownership === 'takeover_pending'
    || state.ownership === 'return_pending'
    || state.ownership === 'reconciling'
  ) return [];
  if (state.ownership !== 'mobile_owned') return [];
  switch (state.taskPhase) {
    case 'running': return ['stop'];
    case 'waiting_confirmation': return ['approve', 'reject'];
    case 'retryable_failure': return ['retry'];
    case 'idle':
    case 'stopped':
    case 'completed': return ['send'];
    default: return [];
  }
}

function isAwaitingIntentOutcome(
  state: SessionViewModel,
  intent: MobileIntent,
): boolean {
  if (state.pendingIntent !== intent) return false;
  if (intent === 'takeover') {
    return state.connection === 'online'
      && state.ownership === 'takeover_pending';
  }
  if (intent === 'return_to_desktop') {
    return state.connection === 'online'
      && state.ownership === 'return_pending';
  }
  if (intent === 'stop') {
    return state.connection === 'online' && state.taskPhase === 'stopping';
  }
  if (intent === 'reconnect') {
    return state.connection === 'reconnecting';
  }
  return state.connection === 'online' && state.ownership === 'mobile_owned';
}

export function reduceSession(
  state: SessionViewModel,
  event: SessionEvent,
): SessionViewModel {
  if (event.type === 'draft_changed') {
    return { ...state, draft: event.draft };
  }
  if (event.type === 'unpaired') {
    return {
      ...state,
      deviceName: '尚未绑定电脑',
      connection: 'unpaired',
      ownership: 'desktop_owned',
      agent: 'shell',
      taskPhase: 'idle',
      lines: [],
      draft: '',
      pendingIntent: null,
      isDemo: false,
      panels: [],
      workspaces: [],
      activePanelId: null,
      ownershipAuthority: null,
      ownershipEpoch: null,
      panelExited: false,
      canControlInput: false,
      hasActivePanel: false,
    };
  }
  if (event.type === 'connection_changed') {
    if (event.connection === 'offline' && state.pendingIntent !== null) {
      if (
        state.pendingIntent === 'takeover'
        || state.pendingIntent === 'return_to_desktop'
      ) {
        return {
          ...state,
          connection: 'offline',
          ownership: 'reconciling',
          pendingIntent: null,
        };
      }
      if (state.pendingIntent === 'reconnect') {
        return {
          ...state,
          connection: 'offline',
          pendingIntent: null,
        };
      }
      return {
        ...state,
        connection: 'offline',
        taskPhase: 'ambiguous',
        pendingIntent: null,
      };
    }
    // While the phone is away the desktop keeps what it held but refuses its
    // epoch, and the Mac may take it back meanwhile without the phone hearing
    // it (2026-10-23). Whatever ownership was known is stale until the next
    // attach answers it, with a fresh epoch if the terminal is still ours.
    const lost = event.connection === 'reconnecting' || event.connection === 'offline';
    const activeKind = state.panels.find((panel) => panel.panelId === state.activePanelId)?.kind;
    const staleOwnership = lost && activeKind !== undefined && activeKind !== 'collaboration';
    return {
      ...state,
      connection: event.connection,
      pendingIntent: event.connection === 'offline'
        ? null
        : state.pendingIntent,
      ...(staleOwnership ? { ownership: 'reconciling' as const, ownershipEpoch: null } : {}),
    };
  }
  if (event.type === 'paired') {
    return {
      ...state,
      deviceName: event.deviceName,
      connection: 'reconnecting',
      panels: [],
      workspaces: [],
      activePanelId: null,
      ownershipAuthority: null,
      ownershipEpoch: null,
      panelExited: false,
      canControlInput: false,
      hasActivePanel: false,
      pendingIntent: null,
    };
  }
  if (event.type === 'panels_changed') {
    const panels = event.panels.map((panel) => ({ ...panel }));
    const selected = panels.find((panel) => panel.panelId === state.activePanelId)
      ?? panels[0]
      ?? null;
    const selectionChanged = selected?.panelId !== state.activePanelId;
    return {
      ...state,
      panels,
      activePanelId: selected?.panelId ?? null,
      agent: selected?.kind === 'collaboration' || selected === null
        ? state.agent
        : selected.kind,
      panelExited: selected?.panelId === state.activePanelId
        ? state.panelExited
        : false,
      ownership: selectionChanged && selected !== null
        ? selected.kind === 'collaboration' ? 'desktop_owned' : 'reconciling'
        : state.ownership,
      ownershipAuthority: selectionChanged
        ? selected?.kind === 'collaboration' ? 'desktop_owned' : null
        : effectiveOwnershipAuthority(state),
      ownershipEpoch: selectionChanged ? null : state.ownershipEpoch,
      hasActivePanel: selected !== null,
      draft: selectionChanged && event.selectedDraft !== undefined
        ? event.selectedDraft
        : state.draft,
    };
  }
  if (event.type === 'workspaces_changed') {
    return {
      ...state,
      workspaces: event.workspaces.map((workspace) => ({ ...workspace })),
    };
  }
  if (event.type === 'panel_selected') {
    const selected = state.panels.find((panel) => panel.panelId === event.panelId);
    if (!selected || selected.panelId === state.activePanelId) return state;
    return {
      ...state,
      activePanelId: selected.panelId,
      agent: selected.kind === 'collaboration' ? state.agent : selected.kind,
      taskPhase: 'idle',
      draft: event.draft ?? state.draft,
      ownership: selected.kind === 'collaboration' ? 'desktop_owned' : 'reconciling',
      ownershipAuthority: selected.kind === 'collaboration' ? 'desktop_owned' : null,
      ownershipEpoch: null,
      panelExited: false,
      hasActivePanel: true,
    };
  }
  if (event.type === 'panel_exited') {
    if (event.panelId !== state.activePanelId) return state;
    return {
      ...state,
      taskPhase: 'completed',
      panelExited: true,
    };
  }
  if (event.type === 'device_access_changed') {
    return { ...state, canControlInput: event.scopes.includes('write') };
  }
  if (event.type === 'ownership_changed') {
    if (!acceptsOwnershipUpdate(state, event)) return state;
    const nextAuthority: Exclude<OwnershipAuthority, null> = event.owner === 'desktop'
      ? 'desktop_owned'
      : event.controlledByThisDevice
        ? 'mobile_owned'
        : 'other_mobile_owned';
    if (
      event.settlesPending === false
      && (
        state.pendingIntent === 'takeover'
        || state.pendingIntent === 'return_to_desktop'
      )
    ) {
      return {
        ...state,
        ownershipAuthority: nextAuthority,
        ownershipEpoch: event.epoch,
      };
    }
    return {
      ...state,
      ownership: nextAuthority,
      ownershipAuthority: nextAuthority,
      ownershipEpoch: event.epoch,
      pendingIntent: (
        state.pendingIntent === 'takeover'
        || state.pendingIntent === 'return_to_desktop'
      ) ? null : state.pendingIntent,
    };
  }
  if (event.type === 'intent_requested') {
    if (state.pendingIntent !== null) return state;
    if (event.intent === 'takeover') {
      return {
        ...state,
        ownershipAuthority: effectiveOwnershipAuthority(state),
        ownership: 'takeover_pending',
        pendingIntent: event.intent,
      };
    }
    if (event.intent === 'return_to_desktop') {
      return {
        ...state,
        ownershipAuthority: effectiveOwnershipAuthority(state),
        ownership: 'return_pending',
        pendingIntent: event.intent,
      };
    }
    if (event.intent === 'stop') {
      return {
        ...state,
        taskPhase: 'stopping',
        pendingIntent: event.intent,
      };
    }
    if (event.intent === 'reconnect') {
      return {
        ...state,
        connection: 'reconnecting',
        pendingIntent: event.intent,
      };
    }
    return { ...state, pendingIntent: event.intent };
  }
  if (!isAwaitingIntentOutcome(state, event.intent)) {
    return state;
  }
  if (event.type === 'intent_acknowledged') {
    if (event.intent === 'takeover') {
      return {
        ...state,
        ownership: 'mobile_owned',
        ownershipAuthority: 'mobile_owned',
        pendingIntent: null,
      };
    }
    if (event.intent === 'return_to_desktop') {
      return {
        ...state,
        ownership: 'desktop_owned',
        ownershipAuthority: 'desktop_owned',
        pendingIntent: null,
      };
    }
    if (event.intent === 'stop') {
      return { ...state, taskPhase: 'stopped', pendingIntent: null };
    }
    if (event.intent === 'reconnect') {
      return { ...state, connection: 'online', pendingIntent: null };
    }
    return { ...state, pendingIntent: null };
  }

  if (event.intent === 'takeover' || event.intent === 'return_to_desktop') {
    if (event.category === 'ambiguous') {
      return {
        ...state,
        ownership: 'reconciling',
        pendingIntent: null,
      };
    }
    return {
      ...state,
      ownership: effectiveOwnershipAuthority(state)
        ?? (event.intent === 'takeover' ? 'desktop_owned' : 'mobile_owned'),
      pendingIntent: null,
    };
  }
  if (event.intent === 'reconnect') {
    return {
      ...state,
      connection: 'offline',
      pendingIntent: null,
    };
  }
  if (event.category === 'ambiguous') {
    return {
      ...state,
      taskPhase: 'ambiguous',
      pendingIntent: null,
    };
  }
  if (event.category === 'retryable') {
    return { ...state, taskPhase: 'retryable_failure', pendingIntent: null };
  }
  if (event.category === 'action_required') {
    return { ...state, taskPhase: 'action_required', pendingIntent: null };
  }
  return { ...state, taskPhase: 'failed', pendingIntent: null };
}
