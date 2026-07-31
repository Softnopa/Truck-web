import { StyleSheet, View } from 'react-native';
import { NativeFaceGate, useNativeLock } from '@/components/NativeFaceGate';
import { PatternGate } from '@/components/PatternGate';
import { Screen } from '@/components/Screen';
import { space } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

/**
 * Everything standing in front of the app on a launch that is already signed in.
 *
 * The phone's own check first — Face ID, Touch ID, or the device passcode —
 * and the pattern under it, the same arrangement the login page uses when
 * signed out. Either one settles the run: the face is faster, the pattern
 * always works, and neither can be switched off.
 *
 * The face block renders nothing on the web build and on a phone with no lock
 * of its own set up, which leaves the pattern exactly where it has always been.
 */
export function ScreenLock({ onUnlocked }: { onUnlocked: () => void }) {
  const theme = useTheme();
  const native = useNativeLock();

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <View style={styles.stack}>
        {native?.ok ? (
          <>
            <NativeFaceGate auto onUnlocked={onUnlocked} size={148} />
            <View style={[styles.rule, { backgroundColor: theme.border }]} />
          </>
        ) : null}

        <PatternGate embedded onUnlocked={onUnlocked} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { flex: 1, justifyContent: 'center', gap: space.lg },
  rule: { height: StyleSheet.hairlineWidth, alignSelf: 'stretch' },
});
