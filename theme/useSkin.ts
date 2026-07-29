import { usePrefs } from '@/providers/PreferencesProvider';
import { radius, radiusFun, spring, springFun, type Skin } from './tokens';

/**
 * Resolves the active skin. Every component reads corner radius and motion from
 * here rather than importing the tokens directly, so the Fun/Calm switch reaches
 * the whole app from one place.
 */
export function useSkin(): Skin {
  const { fun } = usePrefs();
  return {
    fun,
    radius: fun ? radiusFun : radius,
    spring: fun ? springFun : spring,
  };
}
