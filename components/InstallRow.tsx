import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button } from '@/components/Button';
import { Divider } from '@/components/Card';
import { SettingRow } from '@/components/SettingRow';
import { Text } from '@/components/Text';
import { haptics } from '@/lib/haptics';
import { installState, promptInstall, subscribe, type InstallState } from '@/lib/install';
import { usePrefs } from '@/providers/PreferencesProvider';
import { radius, space } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

/**
 * Puts the site on a desktop, as an app in its own window.
 *
 * The button is only ever shown when the browser has actually offered — an
 * install button that does nothing because the browser is not interested is
 * worse than no button. Where installing is possible but not promptable (iOS,
 * which has no API for it) the row says which menu item does it instead.
 */
export function InstallRow() {
  const { t, accentColors } = usePrefs();
  const theme = useTheme();

  const [state, setState] = useState<InstallState>(() => installState());
  const [busy, setBusy] = useState(false);

  // The browser decides when it is willing, and can change its mind after the
  // screen is already up — so this follows it rather than reading once.
  useEffect(() => subscribe(() => setState(installState())), []);

  const install = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await promptInstall();
      if (result === 'installed') haptics.saved();
      setState(installState());
    } finally {
      setBusy(false);
    }
  }, [busy]);

  // A phone app is already installed, and a browser that will not have it
  // should not be nagged about it.
  if (state === 'native' || state === 'unsupported') return null;

  const body =
    state === 'installed' ? (
      <SettingRow label={t('installApp')} description={t('installDone')}>
        <View style={[styles.pill, { backgroundColor: accentColors.soft }]}>
          <Ionicons name="checkmark-circle" size={13} color={accentColors.base} />
          <Text variant="caption" color={accentColors.base}>
            {t('installedBadge')}
          </Text>
        </View>
      </SettingRow>
    ) : state === 'manual' ? (
      // iOS has no prompt to fire, so name the menu instead of offering a
      // button that cannot do anything.
      <SettingRow label={t('installApp')} description={t('installManualIos')} />
    ) : (
      <SettingRow label={t('installApp')} description={t('installHint')}>
        <Button
          label={t('installAction')}
          variant="secondary"
          onPress={() => void install()}
          loading={busy}
          style={styles.button}
          icon={<Ionicons name="download-outline" size={16} color={theme.text} />}
        />
      </SettingRow>
    );

  // The rule belongs to this row rather than to the card around it: this is the
  // one row that can vanish entirely, and a divider left behind by it would
  // hang under the last visible row with nothing beneath.
  return (
    <>
      <Divider />
      {body}
    </>
  );
}

const styles = StyleSheet.create({
  button: { paddingHorizontal: space.base, minWidth: 120 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: space.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
});
