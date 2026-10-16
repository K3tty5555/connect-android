import '@ant-design/v5-patch-for-react-19';
import { App as AntApp } from 'antd';
import { Claude, Codex } from '@lobehub/icons';
import { ThemeProvider } from '@lobehub/ui';
import { ChatItem, ChatList, type ChatMessage } from '@lobehub/ui/chat';
import { createRoot } from 'react-dom/client';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import './room-host.css';

type Sender = 'user' | 'claude' | 'codex' | 'system';
interface WireMessage {
  id: string;
  from: Sender;
  text: string;
  ts: number;
  pending?: boolean;
  queued?: boolean;
  model?: string;
  imageCount?: number;
}
interface HostConfig {
  kind: 'config';
  colorScheme: 'dark' | 'light';
  messages: WireMessage[];
  omittedMessages: number;
  userAvatar: string | null;
  language: 'zh-Hans' | 'zh-Hant' | 'en';
  /** App Store screenshot builds only: no vendor marks in the store listing. */
  neutralAvatars: boolean;
}

const COLLABORATION_AVATAR_RE = /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/;

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage(data: string): void };
  }
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function parseConfig(raw: unknown): HostConfig | null {
  if (typeof raw !== 'string' || raw.length > 1_500_000) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const config = value as Record<string, unknown>;
  if (
    !exactKeys(config, ['kind', 'colorScheme', 'messages', 'omittedMessages', 'userAvatar', 'language', 'neutralAvatars'])
    || (config.neutralAvatars !== undefined && typeof config.neutralAvatars !== 'boolean')
    || config.kind !== 'config'
    || (config.colorScheme !== 'dark' && config.colorScheme !== 'light')
    || !Array.isArray(config.messages)
    || config.messages.length > 512
    || !Number.isSafeInteger(config.omittedMessages)
    || (config.omittedMessages as number) < 0
    || (config.language !== 'zh-Hans' && config.language !== 'zh-Hant' && config.language !== 'en')
    || (config.userAvatar !== null && (
      typeof config.userAvatar !== 'string'
      || config.userAvatar.length > 800_000
      || !COLLABORATION_AVATAR_RE.test(config.userAvatar)
    ))
  ) return null;
  const messages: WireMessage[] = [];
  for (const item of config.messages) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return null;
    const message = item as Record<string, unknown>;
    if (
      !exactKeys(message, ['id', 'from', 'text', 'ts', 'pending', 'queued', 'model', 'imageCount'])
      || typeof message.id !== 'string'
      || message.id.length < 1
      || message.id.length > 64
      || typeof message.text !== 'string'
      || message.text.length > 200_000
      || !['user', 'claude', 'codex', 'system'].includes(message.from as string)
      || !Number.isSafeInteger(message.ts)
      || (message.ts as number) < 0
      || (message.pending !== undefined && typeof message.pending !== 'boolean')
      || (message.queued !== undefined && typeof message.queued !== 'boolean')
      || (message.model !== undefined && (
        typeof message.model !== 'string' || message.model.length < 1 || message.model.length > 120
      ))
      || (message.imageCount !== undefined && (
        !Number.isInteger(message.imageCount)
        || (message.imageCount as number) < 1
        || (message.imageCount as number) > 4
      ))
    ) return null;
    messages.push(message as unknown as WireMessage);
  }
  return {
    kind: 'config',
    colorScheme: config.colorScheme,
    messages,
    omittedMessages: config.omittedMessages as number,
    userAvatar: config.userAvatar as string | null,
    language: config.language,
    neutralAvatars: config.neutralAvatars === true,
  };
}

function translated(
  language: HostConfig['language'],
  zhHans: string,
  en: string,
  zhHant: string,
): string {
  if (language === 'en') return en;
  return language === 'zh-Hant' ? zhHant : zhHans;
}

function avatarFor(
  sender: Sender,
  userAvatar: string | null,
  language: HostConfig['language'],
  neutralAvatars: boolean,
): ReactNode {
  if (neutralAvatars && (sender === 'claude' || sender === 'codex')) {
    return <span aria-hidden className={`agent-dot agent-dot-${sender}`} />;
  }
  if (sender === 'claude') return <Claude.Avatar size={26} />;
  if (sender === 'codex') return <Codex.Avatar size={26} />;
  if (sender === 'user' && userAvatar !== null) {
    return <img alt={translated(language, '我的头像', 'My avatar', '我的頭像')} className="user-avatar" src={userAvatar} />;
  }
  return <span className="text-avatar">{translated(language, '我', 'Me', '我')}</span>;
}

function titleFor(message: WireMessage): string {
  if (message.from === 'user' || message.from === 'system') return '';
  return message.from === 'claude' ? 'Claude' : 'Codex';
}

// Same WeCom-style attribution as the desktop panel (dev-log/020). It rides in
// its own element so a phone-width row ellipsizes it instead of wrapping or
// pushing the timestamp off screen; the agent name always stays whole.
// 商店截图模式（neutralAvatars）不带厂商后缀：商店素材不得暗示与厂商关联（brand-review §5）。
function titleDetailFor(message: WireMessage, neutral: boolean): ReactNode {
  if (message.from === 'user' || message.from === 'system') return null;
  const vendor = neutral ? undefined : message.from === 'claude' ? '@Anthropic' : '@OpenAI';
  const detail = [message.model, vendor].filter(Boolean).map((part) => `· ${part}`).join(' ');
  return detail ? <span className="agent-title-detail">{detail}</span> : null;
}

function MessageDetails({ editableContent, extra, language }: {
  editableContent: ReactNode;
  extra?: WireMessage;
  language: HostConfig['language'];
}): ReactNode {
  const sender = extra?.from ?? 'system';
  return (
    <div className={`message-content message-${sender}`}>
      {editableContent}
      {extra?.imageCount ? (
        <div aria-label={translated(language, `${extra.imageCount} 张图片`, `${extra.imageCount} images`, `${extra.imageCount} 張圖片`)} className="message-images">
          {Array.from({ length: extra.imageCount }, (_, index) => (
            <button
              aria-label={translated(language, `查看图片 ${index + 1}`, `View image ${index + 1}`, `查看圖片 ${index + 1}`)}
              className="message-image"
              key={index}
              onClick={() => window.ReactNativeWebView?.postMessage(JSON.stringify({
                kind: 'imagePress', messageId: extra.id, imageIndex: index,
              }))}
              type="button"
            >
              {translated(language, `图片 ${index + 1}`, `Image ${index + 1}`, `圖片 ${index + 1}`)}
            </button>
          ))}
        </div>
      ) : null}
      {extra?.pending || extra?.queued ? (
        <div className="message-status">{extra.queued
          ? translated(language, '排队中', 'Queued', '排隊中')
          : translated(language, '处理中', 'Working', '處理中')}</div>
      ) : null}
    </div>
  );
}

function RoomChatItem(message: ChatMessage, language: HostConfig['language'], neutral: boolean): ReactNode {
  const wire = message.extra as WireMessage | undefined;
  if (!wire) return null;
  if (wire.from === 'system') {
    return (
      <div className="system-message" role="status">
        <span>{message.content}</span>
      </div>
    );
  }
  const isUser = wire.from === 'user';
  return (
    <ChatItem
      avatar={message.meta ?? {}}
      className={`chat-message chat-message-${wire.from}`}
      message={message.content}
      placement={isUser ? 'right' : 'left'}
      primary={isUser}
      showAvatar
      showTitle={!isUser}
      titleAddon={titleDetailFor(wire, neutral)}
      time={message.updateAt ?? message.createAt}
      variant="bubble"
      renderMessage={(editableContent) => (
        <MessageDetails editableContent={editableContent} extra={wire} language={language} />
      )}
    />
  );
}

function RoomHost(): ReactNode {
  const [config, setConfig] = useState<HostConfig>({
    kind: 'config', colorScheme: 'dark', messages: [], omittedMessages: 0, userAvatar: null, language: 'zh-Hans', neutralAvatars: false,
  });

  useEffect(() => {
    const receive = (event: MessageEvent<unknown>): void => {
      const next = parseConfig(event.data);
      if (next !== null) setConfig(next);
    };
    window.addEventListener('message', receive);
    document.addEventListener('message', receive as EventListener);
    window.ReactNativeWebView?.postMessage(JSON.stringify({ kind: 'ready' }));
    return () => {
      window.removeEventListener('message', receive);
      document.removeEventListener('message', receive as EventListener);
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = config.colorScheme;
    requestAnimationFrame(() => window.scrollTo({ top: document.body.scrollHeight }));
  }, [config]);

  const data = useMemo<ChatMessage[]>(() => config.messages.map((message) => ({
    id: message.id,
    content: message.text,
    role: message.from === 'user' ? 'user' : message.from === 'system' ? 'system' : 'assistant',
    createAt: message.ts,
    updateAt: message.ts,
    meta: {
      avatar: avatarFor(message.from, config.userAvatar, config.language, config.neutralAvatars),
      title: titleFor(message),
    },
    extra: message,
  })), [config.language, config.messages, config.neutralAvatars, config.userAvatar]);

  return (
    <ThemeProvider
      enableCustomFonts={false}
      themeMode={config.colorScheme}
    >
      <AntApp component={false}>
        <main aria-label={translated(config.language, '协作消息', 'Collaboration messages', '協作訊息')} className="room-root">
          {config.omittedMessages > 0 ? (
            <div className="omitted">{translated(
              config.language,
              `更早的 ${config.omittedMessages} 条消息未加载`,
              `${config.omittedMessages} earlier messages were not loaded`,
              `更早的 ${config.omittedMessages} 條訊息未載入`,
            )}</div>
          ) : null}
          {data.length === 0 ? <div className="empty">{translated(config.language, '暂无消息', 'No messages', '暫無訊息')}</div> : (
            <ChatList
              data={data}
              renderItems={{ default: (message) => RoomChatItem(message, config.language, config.neutralAvatars) }}
              showAvatar
              showTitle
              variant="bubble"
            />
          )}
        </main>
      </AntApp>
    </ThemeProvider>
  );
}

createRoot(document.getElementById('root')!).render(<RoomHost />);
