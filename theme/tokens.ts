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

export const palette = {
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
} as const;

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
 * Type ramp. `size` is multiplied by the user's text-size preference at render
 * time; `lineHeight` is expressed as a ratio so it scales with it.
 */
export const type = {
  display: { size: 34, ratio: 1.15, weight: '700' },
  title: { size: 24, ratio: 1.2, weight: '700' },
  heading: { size: 18, ratio: 1.3, weight: '600' },
  body: { size: 16, ratio: 1.4, weight: '400' },
  label: { size: 14, ratio: 1.35, weight: '500' },
  caption: { size: 12, ratio: 1.35, weight: '500' },
  /** Tabular figures for money and counts. */
  numeric: { size: 28, ratio: 1.1, weight: '700' },
} as const;

export type TypeVariant = keyof typeof type;

export function typeStyle(variant: TypeVariant, scale: number): TextStyle {
  const t = type[variant];
  const size = Math.round(t.size * scale);
  return {
    fontSize: size,
    lineHeight: Math.round(size * t.ratio),
    fontWeight: t.weight as TextStyle['fontWeight'],
    letterSpacing: t.size >= 24 ? -0.5 : t.size >= 18 ? -0.2 : 0,
  };
}

/** Subtle depth — a lift, never a drop-shadow slab. */
export const elevation: Record<'card' | 'raised' | 'sheet', ViewStyle> = {
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
