import type { LoadingBand } from '../components/loadingPresentation';
import type { OperationPhase } from './operationPresentation';

/**
 * What a surface row says underneath its label while a create is in flight.
 *
 * Every phase except `pending` already had its own line; `pending` fell through
 * to the row's static description, so the 313-941ms the Mac spends opening a
 * closed workspace looked exactly like doing nothing. That wait is real work —
 * `mobileBridgeServer.ts` awaits `requestWorkspaceOpen` before it reports
 * `authorized` — and the fix is to say so, not to make it faster.
 *
 * `opening` is an inference, so it is fenced twice. The phone cannot tell an
 * open-but-empty workspace from a closed one: `listTrustedWorkspaces` reports a
 * real count for open workspaces (which may be 0) and a hardcoded 0 for recent
 * ones. So:
 *
 *  - a workspace with running sessions is demonstrably open — never claim to be
 *    opening it, no matter how long the create takes;
 *  - otherwise wait for the `waiting` band. Creating in an already-open
 *    workspace takes 0.5-2ms and never reaches 600ms, so anything still pending
 *    there is the closed-workspace branch.
 *
 * Together those keep the line true rather than merely plausible.
 */
export type SurfaceCreateRowDetail =
  | 'static'
  | 'creating'
  | 'opening'
  | 'accepted'
  | 'ambiguous'
  | 'failed';

export function surfaceCreateRowDetail(input: {
  status: OperationPhase;
  /** This row is the kind the user actually tapped. */
  isPendingKind: boolean;
  band: LoadingBand;
  workspaceHasActiveSurfaces: boolean;
}): SurfaceCreateRowDetail {
  if (!input.isPendingKind) return 'static';
  if (input.status === 'accepted') return 'accepted';
  if (input.status === 'ambiguous') return 'ambiguous';
  if (input.status === 'failed') return 'failed';
  if (input.status !== 'pending') return 'static';
  // Under the `brief` threshold the create is about to land; a line that shows
  // for one frame is noise, not feedback.
  if (input.band === 'idle' || input.band === 'instant') return 'static';
  if (input.band === 'brief') return 'creating';
  return input.workspaceHasActiveSurfaces ? 'creating' : 'opening';
}
