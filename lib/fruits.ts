import type { StringKey } from '@/i18n/strings';

/**
 * Ten quick-pick keys replace the old 47-entry dropdown. Anything not on the
 * list is still accepted as free text — it is simply shown verbatim.
 */
export const FRUITS = [
  'apple',
  'pear',
  'grape',
  'melon',
  'watermelon',
  'peach',
  'apricot',
  'cherry',
  'pomegranate',
  'persimmon',
] as const;

export type FruitKey = (typeof FRUITS)[number];

export function fruitLabelKey(fruit: FruitKey): StringKey {
  return `fruit_${fruit}` as StringKey;
}

/** Old rows stored "Apple"; new rows store "apple". Both resolve. */
export function displayFruit(value: string, t: (key: StringKey) => string): string {
  const key = value.trim().toLowerCase();
  return (FRUITS as readonly string[]).includes(key) ? t(`fruit_${key}` as StringKey) : value;
}
