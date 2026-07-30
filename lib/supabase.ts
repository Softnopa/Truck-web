import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';
import type { Database } from './database.types';
import { armPersistenceGuard } from './faceLock';
import { sessionStorage } from './secureStorage';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY. Copy .env.example to .env and restart the bundler.'
  );
}

// Must run before the client below touches storage: with face unlock armed, no
// plaintext session may be written for the rest of this tab's life.
armPersistenceGuard();

export const supabase = createClient<Database>(url, anonKey, {
  auth: {
    // Keystore-backed on device; the tokens never sit in plain text on disk.
    storage: sessionStorage,
    persistSession: true,
    autoRefreshToken: true,
    // No URL-based session handoff on native.
    detectSessionInUrl: false,
  },
});

// Refresh tokens only while the app is in front of the user.
AppState.addEventListener('change', (state) => {
  if (state === 'active') void supabase.auth.startAutoRefresh();
  else void supabase.auth.stopAutoRefresh();
});
