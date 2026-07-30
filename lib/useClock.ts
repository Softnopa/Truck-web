import { useEffect, useState } from 'react';
import type { Lang } from '@/i18n/strings';
import { formatClock } from './format';

/**
 * The current time, formatted, refreshed as it changes.
 *
 * State holds the formatted string rather than a Date so React bails out of the
 * re-render whenever the new string matches the old one. That is what keeps the
 * cost proportional to the precision actually shown: at HH:MM:SS this renders
 * once a second, but drop the seconds from `formatClock` and the same interval
 * costs one render a minute, with no change here.
 */
export function useClock(lang: Lang): string {
  const [now, setNow] = useState(() => formatClock(new Date(), lang));

  useEffect(() => {
    setNow(formatClock(new Date(), lang));
    const id = setInterval(() => setNow(formatClock(new Date(), lang)), 1000);
    return () => clearInterval(id);
  }, [lang]);

  return now;
}
