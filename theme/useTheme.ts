import { useColorScheme } from 'react-native';
import { usePrefs } from '@/providers/PreferencesProvider';
import {
  ELEVATIONS,
  PALETTES,
  type ElevationLevel,
  type Palette,
} from './tokens';
import type { ViewStyle } from 'react-native';

/**
 * Resolves the active palette. Every component reads colour from here rather
 * than importing a palette directly, so the light/dark switch reaches the whole
 * app from one place — the same arrangement `useSkin()` uses for shape and
 * motion.
 *
 * On 'system' this follows the OS, and `useColorScheme` re-renders on its own
 * when the phone flips at sunset.
 */
export function useTheme(): Palette {
  return PALETTES[useIsDark() ? 'dark' : 'light'];
}

/** Depth for the active theme. Same three levels, retuned per ground. */
export function useElevation(): Record<ElevationLevel, ViewStyle> {
  return ELEVATIONS[useIsDark() ? 'dark' : 'light'];
}

/** For the few places that need the mode itself, not a colour — e.g. the status bar. */
export function useIsDark(): boolean {
  const { theme } = usePrefs();
  const system = useColorScheme();
  if (theme === 'system') return system !== 'light';
  return theme === 'dark';
}
