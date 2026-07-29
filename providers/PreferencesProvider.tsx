import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Localization from 'expo-localization';
import * as Updates from 'expo-updates';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { DevSettings, Platform } from 'react-native';
import { DICTIONARIES, isLang, type Lang, type StringKey } from '@/i18n/strings';
import { supabase } from '@/lib/supabase';
import type { UserSettingsRow } from '@/lib/database.types';
import { ACCENTS, isAccentName, type AccentName } from '@/theme/tokens';

const KEY = 'truck.prefs.v1';

interface Prefs {
  lang: Lang;
  accent: AccentName;
  textScale: number;
  /** Fun skin: rounder, bouncier, gradients and produce emoji. */
  fun: boolean;
}

const FALLBACK: Prefs = { lang: 'ru', accent: 'emerald', textScale: 1, fun: false };

function deviceDefault(): Prefs {
  const tag = Localization.getLocales()[0]?.languageCode ?? 'ru';
  return { ...FALLBACK, lang: isLang(tag) ? tag : 'ru' };
}

interface PrefsContext extends Prefs {
  ready: boolean;
  accentColors: (typeof ACCENTS)[AccentName];
  t: (key: StringKey, vars?: Record<string, string | number>) => string;
  setLanguage: (lang: Lang) => Promise<void>;
  setAccent: (accent: AccentName) => Promise<void>;
  setTextScale: (scale: number) => Promise<void>;
  setFun: (fun: boolean) => Promise<void>;
  hydrateFromRemote: (row: UserSettingsRow) => Promise<void>;
}

const Ctx = createContext<PrefsContext | null>(null);

async function persistLocal(prefs: Prefs): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(prefs));
}

async function persistRemote(patch: Partial<UserSettingsRow>): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user.id;
  if (!userId) return;
  await supabase.from('user_settings').upsert({ user_id: userId, ...patch }, { onConflict: 'user_id' });
}

/**
 * A language change must re-render every screen, including ones already deep in
 * a navigation stack, so the app is restarted rather than re-rendered in place.
 * Preferences are written before the restart so the choice survives it.
 */
async function restart(): Promise<void> {
  // `DevSettings` and `expo-updates` are both native-only — neither exists on
  // web, so a full page reload is the equivalent there.
  if (Platform.OS === 'web') {
    window.location.reload();
    return;
  }
  if (__DEV__) {
    DevSettings.reload();
    return;
  }
  try {
    await Updates.reloadAsync();
  } catch {
    // Falls through: context state already changed, so the tree re-renders.
  }
}

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(FALLBACK);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      let next = deviceDefault();
      try {
        const raw = await AsyncStorage.getItem(KEY);
        if (raw) {
          const saved = JSON.parse(raw) as Partial<Prefs>;
          next = {
            lang: typeof saved.lang === 'string' && isLang(saved.lang) ? saved.lang : next.lang,
            accent:
              typeof saved.accent === 'string' && isAccentName(saved.accent) ? saved.accent : next.accent,
            textScale: typeof saved.textScale === 'number' ? saved.textScale : next.textScale,
            fun: typeof saved.fun === 'boolean' ? saved.fun : next.fun,
          };
        }
      } catch {
        // Corrupt cache falls back to device defaults.
      }
      if (!alive) return;
      setPrefs(next);
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const t = useCallback(
    (key: StringKey, vars?: Record<string, string | number>) => {
      const template = DICTIONARIES[prefs.lang][key];
      if (!vars) return template;
      return Object.entries(vars).reduce(
        (acc, [name, value]) => acc.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value)),
        template
      );
    },
    [prefs.lang]
  );

  const setLanguage = useCallback(
    async (lang: Lang) => {
      const next = { ...prefs, lang };
      setPrefs(next);
      await persistLocal(next);
      await persistRemote({ language: lang });
      await restart();
    },
    [prefs]
  );

  const setAccent = useCallback(
    async (accent: AccentName) => {
      const next = { ...prefs, accent };
      setPrefs(next);
      await persistLocal(next);
      await persistRemote({ accent });
    },
    [prefs]
  );

  const setTextScale = useCallback(
    async (textScale: number) => {
      const next = { ...prefs, textScale };
      setPrefs(next);
      await persistLocal(next);
      await persistRemote({ text_scale: textScale });
    },
    [prefs]
  );

  const setFun = useCallback(
    async (fun: boolean) => {
      const next = { ...prefs, fun };
      setPrefs(next);
      await persistLocal(next);
      await persistRemote({ fun_mode: fun });
    },
    [prefs]
  );

  /** Applies the row stored server-side after sign-in, without restarting. */
  const hydrateFromRemote = useCallback(async (row: UserSettingsRow) => {
    const next: Prefs = {
      lang: isLang(row.language) ? row.language : FALLBACK.lang,
      accent: isAccentName(row.accent) ? row.accent : FALLBACK.accent,
      textScale: Number(row.text_scale) || FALLBACK.textScale,
      fun: Boolean(row.fun_mode),
    };
    setPrefs(next);
    await persistLocal(next);
  }, []);

  const value = useMemo<PrefsContext>(
    () => ({
      ...prefs,
      ready,
      accentColors: ACCENTS[prefs.accent],
      t,
      setLanguage,
      setAccent,
      setTextScale,
      setFun,
      hydrateFromRemote,
    }),
    [prefs, ready, t, setLanguage, setAccent, setTextScale, setFun, hydrateFromRemote]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePrefs(): PrefsContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('usePrefs must be used inside PreferencesProvider');
  return ctx;
}
