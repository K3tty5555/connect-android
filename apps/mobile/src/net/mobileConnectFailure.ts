import type { MobileErrorCategory } from './bridgeClient';
import { isRelayOnlyPairingHost } from '../../../../src/shared/mobilePairingQrBoundary';

/**
 * Why a dial never became a connection. Every dial failure arrives as close
 * code 1006, so the close event alone cannot tell these apart; the platform's
 * error description can, and it used to be discarded.
 */
export type MobileConnectFailureKind = 'unreachable' | 'refused' | 'timeout' | 'unknown';

/**
 * iOS hands us `NSError.localizedDescription` (`RCTWebSocketModule.mm:219`),
 * and that string **is translated**. Measured on the real device
 * (iPhone 17 Pro Max / iOS 26.6.2 / zh-Hans, 2026-09-17) it is plain localized
 * prose with no error domain or code in it at all:
 *
 *   未能完成该操作。连接被拒绝      ← ECONNREFUSED
 *   未能完成该操作。操作超时        ← ETIMEDOUT
 *
 * So each supported language needs its own phrasings. A phone set to some third
 * language falls through to `unknown`, which is honest — better a vague line
 * than a confident wrong one.
 */
const UNREACHABLE = /network is unreachable|no route to host|appears to be offline|unable to resolve host|nodename nor servname|cannot find host|a server with the specified hostname|网络不可达|网络不可及|无法连接到网络|没有到达主机的路由|无法路由到主机|主机不可达|网络已关闭/iu;
const REFUSED = /connection refused|econnrefused|could not connect to the server|failed to connect to|连接被拒绝|拒绝连接/iu;
const TIMEOUT = /timed out|timeout|etimedout|操作超时|连接超时|已超时/iu;

/**
 * Foundation falls back to `(<domain> error <code>.)` when it has no strerror
 * text for an errno, and that form keeps the domain and number untranslated.
 *
 * The 2026-09-17 device run did **not** produce this form — it gave localized
 * prose — so this is a secondary net, not the primary path. It is kept because
 * it costs nothing and covers the errnos Foundation has no wording for.
 */
// `[^-\d]*` rather than `\D*`: the latter swallows the minus sign, turning
// NSURLErrorDomain -1009 into 1009 and losing the classification entirely.
const DOMAIN_CODE = /NS(POSIX|URL)ErrorDomain[^-\d]*(-?\d+)/u;
const POSIX_KINDS: Record<number, MobileConnectFailureKind> = {
  50: 'unreachable',  // ENETDOWN
  51: 'unreachable',  // ENETUNREACH
  60: 'timeout',      // ETIMEDOUT
  61: 'refused',      // ECONNREFUSED
  64: 'unreachable',  // EHOSTDOWN
  65: 'unreachable',  // EHOSTUNREACH
};
const URL_KINDS: Record<number, MobileConnectFailureKind> = {
  [-1001]: 'timeout',       // NSURLErrorTimedOut
  [-1004]: 'refused',       // NSURLErrorCannotConnectToHost
  [-1005]: 'unreachable',   // NSURLErrorNetworkConnectionLost
  [-1009]: 'unreachable',   // NSURLErrorNotConnectedToInternet
};

function classifyByDomainCode(message: string): MobileConnectFailureKind | null {
  const match = DOMAIN_CODE.exec(message);
  if (match === null) return null;
  const code = Number(match[2]);
  if (!Number.isInteger(code)) return null;
  return (match[1] === 'POSIX' ? POSIX_KINDS[code] : URL_KINDS[code]) ?? null;
}

export function classifyMobileConnectFailure(input: {
  /** `message` off the socket's error event, kept only for this decision. */
  platformMessage: string | null;
  /** Our own connect deadline fired, which outranks any half-finished message. */
  timedOut: boolean;
}): MobileConnectFailureKind {
  if (input.timedOut) return 'timeout';
  const message = input.platformMessage;
  if (message === null || message === '') return 'unknown';
  // The numeric code outranks the prose: it survives translation.
  const byCode = classifyByDomainCode(message);
  if (byCode !== null) return byCode;
  if (TIMEOUT.test(message)) return 'timeout';
  if (UNREACHABLE.test(message)) return 'unreachable';
  if (REFUSED.test(message)) return 'refused';
  return 'unknown';
}

/** Tailscale's CGNAT range, the half of `isMobileBridgeIpv4` that is not LAN. */
function isTailnetHost(host: string): boolean {
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false;
  const [a, b] = parts as [number, number, number, number];
  return a === 100 && b >= 64 && b <= 127;
}

/**
 * One line per cause. Only the refusal case may name Connect: it is the only
 * one where the desktop was actually reached and said no.
 */
export function describeMobileConnectFailure(
  kind: MobileConnectFailureKind,
  host: string,
): string {
  if (isRelayOnlyPairingHost(host)) {
    return kind === 'refused'
      ? '私人 Relay 已连接，但电脑端 Connect 未接受连接。'
      : '无法连接私人 Relay，请检查 Relay 地址、API Key 和服务器状态。';
  }
  switch (kind) {
    case 'unreachable':
      return isTailnetHost(host)
        ? '手机未接入 Tailscale，请先在 Tailscale App 连接。'
        : '手机不在电脑所在的局域网，请检查 Wi-Fi。';
    case 'refused':
      return '电脑可达，但 Connect 未运行或未开启手机远程控制。';
    case 'timeout':
      // 09-14 事故走的正是这条：Tailscale 未连接时包进 utun 黑洞，iOS 报超时而不是
      // 「网络不可达」。手机侧无法区分「我没上 tailnet」和「电脑不在线」，所以两个
      // 都点到，一个都不断言——这正是当初那句错误断言的教训。
      return isTailnetHost(host)
        ? '连不上电脑，请确认手机 Tailscale 已连接、电脑已开机。'
        : '连不上电脑，请确认与电脑在同一 Wi-Fi、电脑已开机。';
    default:
      return '无法连接到电脑，请检查网络后重试。';
  }
}

/** A dial that failed before the socket ever opened, with the cause kept. */
export class MobileConnectFailureError extends Error {
  readonly kind: MobileConnectFailureKind;

  readonly category: MobileErrorCategory;

  constructor(kind: MobileConnectFailureKind, host: string) {
    super(describeMobileConnectFailure(kind, host));
    this.name = 'MobileConnectFailureError';
    this.kind = kind;
    this.category = kind === 'timeout' || kind === 'unknown' ? 'retryable' : 'action_required';
  }
}
