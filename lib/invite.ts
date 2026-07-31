import type { ClientKind } from './database.types';

const BOT_USERNAME = process.env.EXPO_PUBLIC_TELEGRAM_BOT_USERNAME;

export function hasBot(): boolean {
  return Boolean(BOT_USERNAME);
}

/**
 * The link that connects a contact to this app.
 *
 * A private chat uses `?start=`, which opens a conversation with the bot and
 * sends `/start <code>` straight away. A group uses `?startgroup=`, which asks
 * which group to add the bot to.
 *
 * The two are not equivalent: `startgroup` is not guaranteed to deliver the
 * payload once the bot lands in the group, so the group flow also tells the
 * owner to send `/start <code>` there. The webhook accepts that in either
 * place, including Telegram's `@botname` suffix on commands sent in groups.
 *
 * Returns null when no bot username is configured, so callers can say so
 * rather than share a broken link.
 */
export function inviteLink(code: string, kind: ClientKind): string | null {
  if (!BOT_USERNAME) return null;
  const param = kind === 'group' ? 'startgroup' : 'start';
  return `https://t.me/${BOT_USERNAME}?${param}=${code}`;
}
