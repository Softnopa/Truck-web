import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Which language the Telegram report is written in.
 *
 * Deliberately separate from the app's own language. The two answer different
 * questions: `usePrefs().lang` is what *this owner* reads, while this is what
 * *the group* reads — and a Russian-speaking owner posting to a group of Uzbek
 * drivers wants those to differ. The app offers three languages; the report
 * offers the two the groups actually use.
 *
 * Held on the device rather than in the owner's Supabase preferences, because
 * it needs no migration and the choice is one an owner makes once.
 */

export const REPORT_LANGS = ['ru', 'uz'] as const;
export type ReportLang = (typeof REPORT_LANGS)[number];

const KEY = 'truck.report.lang';

export function isReportLang(value: string): value is ReportLang {
  return (REPORT_LANGS as readonly string[]).includes(value);
}

export async function loadReportLang(): Promise<ReportLang> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw && isReportLang(raw) ? raw : 'ru';
  } catch {
    // Storage refused: Russian is what the groups had before this was a choice.
    return 'ru';
  }
}

export async function saveReportLang(lang: ReportLang): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, lang);
  } catch {
    // The press still governs this run; only the memory of it is lost.
  }
}
