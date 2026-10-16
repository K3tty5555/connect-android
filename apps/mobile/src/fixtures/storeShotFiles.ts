import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { MobileFileEntry } from '../../../../src/shared/types';
import type { MobileCommand, MobileEvent } from '../net/bridgeClient';
import { bytesToBase64, textToBytes } from '../net/bytes';
import type { StoreShotLocale } from '../storeShot';

/**
 * 截图模式下的「假电脑」：按工作区文件协议回答 listFiles / openFile / readFileChunk，
 * 让文件树与查看器走真实的 WorkspaceFileTransport，而不是另画一套演示界面。
 * 写操作一律回 `mobile_bridge_rejected`——截图模式不改任何东西。
 */

const FILE_CAPABILITY = 'fcap_storeshot_readme_document';

const README: Record<StoreShotLocale, string> = {
  'zh-Hans': '# travel-planner\n\n行程规划小工具：按日期区间生成每日安排。\n\n## 开发\n\n```sh\nnpm install\nnpm run dev\n```\n\n## 目录\n\n- `src/` 页面与组件\n- `src/lib/` 日期与行程计算\n- `tests/` 单元测试\n',
  'zh-Hant': '# travel-planner\n\n行程規劃小工具：按日期區間生成每日安排。\n\n## 開發\n\n```sh\nnpm install\nnpm run dev\n```\n\n## 目錄\n\n- `src/` 頁面與元件\n- `src/lib/` 日期與行程計算\n- `tests/` 單元測試\n',
  en: '# travel-planner\n\nA small trip planner that turns a date range into a daily itinerary.\n\n## Develop\n\n```sh\nnpm install\nnpm run dev\n```\n\n## Layout\n\n- `src/` pages and components\n- `src/lib/` date and itinerary logic\n- `tests/` unit tests\n',
};

const DATE_RANGE = `export interface DateRange {
  start: Date;
  end: Date;
}

export function daysIn(range: DateRange): Date[] {
  const days: Date[] = [];
  const cursor = new Date(range.start);
  while (cursor <= range.end) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}
`;

const TREE: Record<string, MobileFileEntry[]> = {
  '': [
    { name: 'src', dir: true, hidden: false },
    { name: 'tests', dir: true, hidden: false },
    { name: '.gitignore', dir: false, hidden: true },
    { name: 'package.json', dir: false, hidden: false },
    { name: 'README.md', dir: false, hidden: false },
    { name: 'tsconfig.json', dir: false, hidden: false },
  ],
  src: [
    { name: 'components', dir: true, hidden: false },
    { name: 'lib', dir: true, hidden: false },
    { name: 'App.tsx', dir: false, hidden: false },
    { name: 'main.tsx', dir: false, hidden: false },
  ],
  'src/lib': [
    { name: 'dateRange.ts', dir: false, hidden: false },
    { name: 'itinerary.ts', dir: false, hidden: false },
  ],
  'src/components': [
    { name: 'DayCard.tsx', dir: false, hidden: false },
    { name: 'RangePicker.tsx', dir: false, hidden: false },
  ],
  tests: [{ name: 'dateRange.test.ts', dir: false, hidden: false }],
};

/** 截图场景默认展开的目录与打开的文件。 */
export const STORE_SHOT_EXPANDED_DIRS = ['src', 'src/lib'];
export const STORE_SHOT_OPEN_FILE = 'src/lib/dateRange.ts';

function contentOf(subPath: string, locale: StoreShotLocale): string {
  if (subPath === 'README.md') return README[locale];
  if (subPath === STORE_SHOT_OPEN_FILE) return DATE_RANGE;
  return '';
}

export function createStoreShotFileDesktop(
  locale: StoreShotLocale,
  deliver: (event: MobileEvent) => void,
): (command: MobileCommand) => Promise<void> {
  let open: { bytes: Uint8Array } | null = null;
  return async (command) => {
    const reply = (event: MobileEvent): void => {
      void Promise.resolve().then(() => deliver(event));
    };
    switch (command.kind) {
      case 'listFiles':
        reply({
          kind: 'fileList',
          requestId: command.requestId,
          workspaceCapability: command.workspaceCapability,
          subPath: command.subPath,
          entries: TREE[command.subPath] ?? [],
          truncated: false,
        });
        return;
      case 'openFile': {
        const bytes = textToBytes(contentOf(command.subPath, locale));
        open = { bytes };
        reply({
          kind: 'fileOpened',
          requestId: command.requestId,
          workspaceCapability: command.workspaceCapability,
          subPath: command.subPath,
          contentKind: 'text',
          mime: 'text/plain',
          byteLength: bytes.byteLength,
          sha256: bytesToHex(sha256(bytes)),
          ...(bytes.byteLength === 0
            ? { chunkCount: 0 }
            : { fileCapability: FILE_CAPABILITY, chunkCount: 1, expiresInMs: 120000 as const }),
        });
        return;
      }
      case 'readFileChunk':
        reply({
          kind: 'fileChunk',
          requestId: command.requestId,
          fileCapability: command.fileCapability,
          index: 0,
          data: bytesToBase64(open?.bytes ?? new Uint8Array(0)),
          complete: true,
        });
        return;
      default:
        if ('requestId' in command && command.requestId !== undefined) {
          reply({ kind: 'error', code: 'mobile_bridge_rejected', category: 'permanent', requestId: command.requestId });
        }
    }
  };
}
