import type { Lang } from '@/i18n/strings';

const LOCALE: Record<Lang, string> = { ru: 'ru-RU', uz: 'uz-UZ', en: 'en-US' };

/** Grouped digits, no currency word. */
export function num(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/**
 * The app never prints a bare `0` as if it were data. Anything that is zero,
 * empty or unparseable comes back as null so the caller renders placeholder
 * text instead.
 */
export function blankIfZero(value: number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value === 0) return null;
  return num(value);
}

/** Parses what the user typed. Empty stays empty — it never becomes 0. */
export function parseAmount(input: string): number | null {
  const cleaned = input.replace(/[^\d]/g, '');
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function formatDate(iso: string, lang: Lang): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(LOCALE[lang], { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateTime(iso: string, lang: Lang): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(LOCALE[lang], {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function todayISODate(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Wall clock, always 24-hour. `ru` and `uz` are 24-hour natively and the market
 * runs on it, so `en` is pinned to match rather than drifting to AM/PM — that
 * also keeps the header width from jumping between languages.
 */
export function formatClock(date: Date, lang: Lang): string {
  return date.toLocaleTimeString(LOCALE[lang], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

/**
 * Uzbek plates are `01 A123AA`. Accepts sloppy input and normalises spacing and
 * case so the list stays scannable.
 */
export function formatPlate(input: string): string {
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (raw.length <= 2) return raw;
  return `${raw.slice(0, 2)} ${raw.slice(2, 9)}`.trim();
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0] ?? '';
  const second = parts.length > 1 ? parts[parts.length - 1] : undefined;
  const a = first.charAt(0);
  const b = second ? second.charAt(0) : '';
  return (a + b).toUpperCase() || '?';
}
