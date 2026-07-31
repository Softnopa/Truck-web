import { Ionicons } from '@expo/vector-icons';
import { Platform, StyleSheet, View } from 'react-native';
import { useNativeLock } from '@/components/NativeFaceGate';
import { SettingRow } from '@/components/SettingRow';
import { Text } from '@/components/Text';
import { usePrefs } from '@/providers/PreferencesProvider';
import { radius, space } from '@/theme/tokens';

/**
 * What guards the app, stated rather than offered.
 *
 * Deliberately not a toggle. The pattern runs on every launch on every
 * platform, and on a phone the OS check runs in front of it — neither is
 * something an owner should be able to switch off from inside the app they are
 * protecting. The two rows below this one on web arm an *extra* face check;
 * turning those off never leaves the app unlocked.
 */
export function ScreenLockRow() {
  const { t, accentColors } = usePrefs();
  const native = useNativeLock();

  const description =
    Platform.OS === 'web'
      ? t('screenLockPattern')
      : native === null
        ? t('screenLockPattern')
        : native.ok
          ? t('screenLockNative')
          : t('screenLockNativeUnavailable');

  return (
    <SettingRow label={t('screenLock')} description={description}>
      <View style={[styles.pill, { backgroundColor: accentColors.soft }]}>
        <Ionicons name="lock-closed" size={13} color={accentColors.base} />
        <Text variant="caption" color={accentColors.base}>
          {t('screenLockAlwaysOn')}
        </Text>
      </View>
    </SettingRow>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: space.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
});
