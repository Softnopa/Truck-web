import type { TextStyle, ViewStyle } from 'react-native';

/**
 * One spacing rhythm (4pt), one radius family, one accent at a time.
 * Everything visual in the app resolves through these tokens.
 */

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 40,
} as const;

export const radius = {
  sm: 10,
  md: 14,
  lg: 20,
  xl: 28,
  pill: 999,
} as const;

/** Minimum iOS touch target. Never ship a tappable smaller than this. */
export const HIT = 44;

/**
 * Two grounds, one hue family. Both are slate-biased rather than neutral grey so
 * the accents sit in the same world in either mode.
 *
 * Nothing imports a palette directly — `useTheme()` resolves the active one, so
 * a mode change reaches the whole app from one place. Colours that live inside a
 * module-scope `StyleSheet.create` would be frozen at import time, so anything
 * theme-dependent is applied inline at render.
 */
export type Palette = {
  bg: string;
  surface: string;
  surfaceHi: string;
  surfacePress: string;
  border: string;
  borderHi: string;
  text: string;
  textDim: string;
  textFaint: string;
  danger: string;
  dangerSoft: string;
  warning: string;
  success: string;
  overlay: string;
};

export const darkPalette: Palette = {
  bg: '#0B0F14',
  surface: '#141A22',
  surfaceHi: '#1B232D',
  surfacePress: '#212B37',
  border: '#26303D',
  borderHi: '#33404F',
  text: '#F1F5F9',
  textDim: '#93A1B2',
  textFaint: '#5D6B7C',
  danger: '#F04438',
  dangerSoft: '#3A1714',
  warning: '#F79009',
  success: '#12B76A',
  overlay: 'rgba(6,9,13,0.72)',
};

/**
 * Not an inversion of the dark set: the status colours are darkened so they stay
 * legible as text on a light ground, where the dark mode's brighter versions
 * would fall below contrast.
 */
export const lightPalette: Palette = {
  bg: '#F5F8FB',
  surface: '#FFFFFF',
  surfaceHi: '#EDF2F7',
  surfacePress: '#DFE7EF',
  border: '#DCE3EB',
  borderHi: '#C2CDDA',
  text: '#0D1520',
  textDim: '#51606F',
  textFaint: '#7E8B9A',
  danger: '#D92D20',
  dangerSoft: '#FDECEA',
  warning: '#B54708',
  success: '#027A48',
  overlay: 'rgba(13,21,32,0.45)',
};

export type ThemeMode = 'dark' | 'light' | 'system';

export const PALETTES: Record<'dark' | 'light', Palette> = {
  dark: darkPalette,
  light: lightPalette,
};

export function isThemeMode(value: string): value is ThemeMode {
  return value === 'dark' || value === 'light' || value === 'system';
}

export type AccentName = 'emerald' | 'blue' | 'violet' | 'amber' | 'rose';

export const ACCENTS: Record<AccentName, { base: string; soft: string; on: string }> = {
  emerald: { base: '#10B981', soft: 'rgba(16,185,129,0.14)', on: '#04150F' },
  blue: { base: '#3B82F6', soft: 'rgba(59,130,246,0.14)', on: '#04101F' },
  violet: { base: '#8B5CF6', soft: 'rgba(139,92,246,0.14)', on: '#120A22' },
  amber: { base: '#F59E0B', soft: 'rgba(245,158,11,0.14)', on: '#1A1002' },
  rose: { base: '#F43F5E', soft: 'rgba(244,63,94,0.14)', on: '#1F050B' },
};

export const ACCENT_NAMES = Object.keys(ACCENTS) as AccentName[];

export function isAccentName(value: string): value is AccentName {
  return value in ACCENTS;
}

/**
 * Manrope, in five weights.
 *
 * React Native resolves a weight by picking a *named family*, not by synthesising
 * one from `fontWeight` — asking for '700' on a family that only has Regular
 * loaded silently gives you Regular. So every weight is its own family name and
 * `typeStyle` maps to it explicitly.
 */
export const FONTS = {
  400: 'Manrope_400Regular',
  500: 'Manrope_500Medium',
  600: 'Manrope_600SemiBold',
  700: 'Manrope_700Bold',
  800: 'Manrope_800ExtraBold',
} as const;

export type FontWeightKey = keyof typeof FONTS;

/**
 * Type ramp. `size` is multiplied by the user's text-size preference at render
 * time; `lineHeight` is expressed as a ratio so it scales with it.
 *
 * `track` is letter-spacing in ems: display sizes are tightened so large text
 * does not read as loose, and the smallest label is opened up so it stays
 * legible once it is set in caps.
 */
export const type = {
  display: { size: 34, ratio: 1.12, weight: 800, track: -0.022 },
  title: { size: 24, ratio: 1.2, weight: 700, track: -0.016 },
  heading: { size: 18, ratio: 1.3, weight: 600, track: -0.008 },
  body: { size: 16, ratio: 1.45, weight: 400, track: 0 },
  label: { size: 14, ratio: 1.35, weight: 500, track: 0 },
  caption: { size: 12, ratio: 1.35, weight: 600, track: 0.02 },
  /** Tabular figures for money and counts. */
  numeric: { size: 28, ratio: 1.1, weight: 800, track: -0.02 },
} as const;

export type TypeVariant = keyof typeof type;

export function typeStyle(variant: TypeVariant, scale: number): TextStyle {
  const t = type[variant];
  const size = Math.round(t.size * scale);
  return {
    fontFamily: FONTS[t.weight as FontWeightKey],
    fontSize: size,
    lineHeight: Math.round(size * t.ratio),
    // Kept alongside fontFamily so the system fallback still renders at roughly
    // the right weight during the first frames, before the faces are ready.
    fontWeight: String(t.weight) as TextStyle['fontWeight'],
    letterSpacing: Math.round(size * t.track * 100) / 100,
  };
}

export type ElevationLevel = 'card' | 'raised' | 'sheet';

/**
 * Subtle depth — a lift, never a drop-shadow slab.
 *
 * Tuned per theme rather than shared. On a dark ground a shadow reads as absence
 * of light and can be deep; on a light one the same values look like dirt under
 * the card, so light mode uses a shorter, much softer shadow tinted toward the
 * slate neutrals instead of pure black.
 */
const darkElevation: Record<ElevationLevel, ViewStyle> = {
  card: {
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  raised: {
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  sheet: {
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 32,
    shadowOffset: { width: 0, height: -8 },
    elevation: 16,
  },
};

const lightElevation: Record<ElevationLevel, ViewStyle> = {
  card: {
    shadowColor: '#1B2836',
    shadowOpacity: 0.07,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  raised: {
    shadowColor: '#1B2836',
    shadowOpacity: 0.11,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  sheet: {
    shadowColor: '#1B2836',
    shadowOpacity: 0.16,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: -6 },
    elevation: 14,
  },
};

export const ELEVATIONS: Record<'dark' | 'light', Record<ElevationLevel, ViewStyle>> = {
  dark: darkElevation,
  light: lightElevation,
};

/** Dark set, for the few places that render above the theme provider. */
export const elevation = darkElevation;

/** One spring, used by every animation in the app so motion feels uniform. */
export const spring = { damping: 18, stiffness: 220, mass: 0.6 } as const;
export const springSoft = { damping: 22, stiffness: 140, mass: 0.9 } as const;

export const TEXT_SCALES = [0.9, 1.0, 1.15, 1.3] as const;

// ---------------------------------------------------------------------------
// Fun skin
//
// The same layout and the same spacing rhythm, re-dressed: rounder corners, a
// spring that overshoots instead of settling flat, gradient fills and produce
// emoji. Calm stays the default because it is faster to read at a market stall.
// ---------------------------------------------------------------------------

export const radiusFun = {
  sm: 14,
  md: 20,
  lg: 28,
  xl: 36,
  pill: 999,
} as const;

/** Low damping so cards and thumbs bounce past their mark and come back. */
export const springFun = { damping: 10, stiffness: 190, mass: 0.7 } as const;

/** Widened from the `as const` literals so Calm and Fun are interchangeable. */
export type RadiusScale = { sm: number; md: number; lg: number; xl: number; pill: number };
export type SpringConfig = { damping: number; stiffness: number; mass: number };

export type Skin = {
  fun: boolean;
  radius: RadiusScale;
  spring: SpringConfig;
};

export const FRUIT_EMOJI: Record<string, string> = {
  apple: '🍎',
  pear: '🍐',
  grape: '🍇',
  melon: '🍈',
  watermelon: '🍉',
  peach: '🍑',
  apricot: '🍑',
  cherry: '🍒',
  pomegranate: '🍎',
  persimmon: '🟠',
};

export function fruitEmoji(value: string): string {
  return FRUIT_EMOJI[value.trim().toLowerCase()] ?? '📦';
}
