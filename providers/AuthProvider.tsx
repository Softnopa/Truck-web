import type { Session } from '@supabase/supabase-js';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ConsentRow, ProfileRow } from '@/lib/database.types';
import { disable as disableFaceLock, reseal } from '@/lib/faceLock';
import { CURRENT_CONSENT_VERSION, startTracking, stopTracking } from '@/lib/location';
import { clearPushTokens, registerPushToken } from '@/lib/push';
import { supabase } from '@/lib/supabase';
import { usePrefs } from './PreferencesProvider';

interface AuthContext {
  loading: boolean;
  session: Session | null;
  profile: ProfileRow | null;
  consent: ConsentRow | null;
  isOwner: boolean;
  /** A customer must answer the permissions screen before entering the app. */
  hasAnswered: boolean;
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  saveConsent: (patch: {
    location_granted: boolean;
    notifications_granted: boolean;
    terms_accepted: boolean;
  }) => Promise<void>;
  revokeLocation: (revoked: boolean) => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthContext | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { hydrateFromRemote } = usePrefs();
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [consent, setConsent] = useState<ConsentRow | null>(null);
  const [loading, setLoading] = useState(true);
  const hydrated = useRef(false);

  const load = useCallback(
    async (userId: string) => {
      const [profileRes, consentRes, settingsRes] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
        supabase.from('consents').select('*').eq('user_id', userId).maybeSingle(),
        supabase.from('user_settings').select('*').eq('user_id', userId).maybeSingle(),
      ]);

      setProfile(profileRes.data ?? null);
      setConsent(consentRes.data ?? null);

      // Server preferences win once, at sign-in, then the device stays authoritative
      // for the rest of the session so a change never fights the user mid-edit.
      if (settingsRes.data && !hydrated.current) {
        hydrated.current = true;
        await hydrateFromRemote(settingsRes.data);
      }
    },
    [hydrateFromRemote]
  );

  useEffect(() => {
    let alive = true;

    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (!alive) return;
      setSession(data.session);
      if (data.session) await load(data.session.user.id);
      if (alive) setLoading(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      if (!next) {
        hydrated.current = false;
        setProfile(null);
        setConsent(null);
        return;
      }

      // Supabase rotates the refresh token roughly hourly. Without re-sealing,
      // the face-unlock vault would still hold the retired one and the next
      // launch would fail to restore a session. Silent — see faceLock.reseal.
      if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') {
        void reseal({ access_token: next.access_token, refresh_token: next.refresh_token });
      }

      void load(next.user.id);
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [load]);

  // Keep the push token current for anyone who agreed to notifications.
  useEffect(() => {
    const userId = session?.user.id;
    if (!userId || !consent?.notifications_granted) return;
    void registerPushToken(userId);
  }, [session?.user.id, consent?.notifications_granted]);

  // Background tracking follows consent, and only under the current terms —
  // a customer who agreed to v1 is never tracked before re-answering.
  useEffect(() => {
    const userId = session?.user.id;
    if (!userId || profile?.role !== 'customer') return;

    const sharing =
      Boolean(consent?.location_granted) &&
      !consent?.revoked_at &&
      consent?.consent_version === CURRENT_CONSENT_VERSION;

    if (sharing) void startTracking(userId);
    else void stopTracking(userId);
  }, [
    session?.user.id,
    profile?.role,
    consent?.location_granted,
    consent?.revoked_at,
    consent?.consent_version,
  ]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    return error ? error.message : null;
  }, []);

  const signOut = useCallback(async () => {
    const userId = session?.user.id;
    if (userId) {
      await stopTracking(userId);
      await clearPushTokens(userId);
    }
    // Signing out revokes the refresh token, which is exactly the one sealed in
    // the face-unlock vault. Leaving the enrolment behind would strand the next
    // launch at a lock screen that can only ever fail.
    disableFaceLock();
    await supabase.auth.signOut();
  }, [session?.user.id]);

  const saveConsent = useCallback(
    async (patch: {
      location_granted: boolean;
      notifications_granted: boolean;
      terms_accepted: boolean;
    }) => {
      const userId = session?.user.id;
      if (!userId) return;
      const { data, error } = await supabase
        .from('consents')
        .upsert(
          {
            user_id: userId,
            ...patch,
            consent_version: CURRENT_CONSENT_VERSION,
            decided_at: new Date().toISOString(),
            revoked_at: null,
          },
          { onConflict: 'user_id' }
        )
        .select()
        .maybeSingle();

      // Must throw, not swallow: this write is what releases the customer from
      // the permissions gate, so a silent failure strands them on that screen
      // pressing a button that appears to do nothing.
      if (error) throw error;
      if (data) setConsent(data);
    },
    [session?.user.id]
  );

  /** Consent stays revocable for the life of the account. */
  const revokeLocation = useCallback(
    async (revoked: boolean) => {
      const userId = session?.user.id;
      if (!userId) return;
      const { data, error } = await supabase
        .from('consents')
        .update({
          location_granted: !revoked,
          revoked_at: revoked ? new Date().toISOString() : null,
        })
        .eq('user_id', userId)
        .select()
        .maybeSingle();
      if (error) throw error;
      if (data) setConsent(data);
    },
    [session?.user.id]
  );

  const refresh = useCallback(async () => {
    const userId = session?.user.id;
    if (userId) await load(userId);
  }, [session?.user.id, load]);

  const value = useMemo<AuthContext>(
    () => ({
      loading,
      session,
      profile,
      consent,
      isOwner: profile?.role === 'owner',
      hasAnswered:
        profile?.role === 'owner' ||
        (Boolean(consent?.decided_at) && consent?.consent_version === CURRENT_CONSENT_VERSION),
      signIn,
      signOut,
      saveConsent,
      revokeLocation,
      refresh,
    }),
    [loading, session, profile, consent, signIn, signOut, saveConsent, revokeLocation, refresh]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
