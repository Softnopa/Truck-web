import React from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { Button, PressableScale } from '@/components/Button';
import { Text } from '@/components/Text';
import { usePrefs } from '@/providers/PreferencesProvider';
import { space } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

interface Props {
  /** The plate: a face glyph for the OS prompt, a live preview for the camera. */
  visual: React.ReactNode;
  title: string;
  caption: string;
  /** True when the caption is a failure, so it turns red. */
  failed?: boolean;
  actionLabel: string;
  onAction: () => void;
  busy?: boolean;
  disabled?: boolean;
}

/**
 * The block both unlock backends share, so switching between the platform
 * authenticator and the camera does not switch the way the app looks at the
 * moment the owner is most likely to be worried about it.
 *
 * A block rather than a screen: the face check sits on the login page, above the
 * pattern, and neither of them owns that page. There is no "use password"
 * button here for the same reason — the way past this block is the pattern
 * drawn directly underneath it.
 */
export function GateLayout({
  visual,
  title,
  caption,
  failed,
  actionLabel,
  onAction,
  busy,
  disabled,
}: Props) {
  const theme = useTheme();
  const { t } = usePrefs();

  return (
    <Animated.View entering={FadeIn.duration(260)} style={styles.wrap}>
      <PressableScale
        onPress={onAction}
        to={0.96}
        accessibilityLabel={t('faceUnlock')}
        disabled={busy || disabled}
      >
        {visual}
      </PressableScale>

      <Animated.View entering={FadeInDown.delay(80).duration(320)} style={styles.copy}>
        <Text variant="heading">{title}</Text>
        <Text variant="label" color={failed ? theme.danger : theme.textDim} center>
          {caption}
        </Text>
      </Animated.View>

      <View style={styles.action}>
        <Button label={actionLabel} onPress={onAction} loading={busy} disabled={disabled} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: space.md },
  copy: { alignItems: 'center', gap: space.xs },
  action: { alignSelf: 'stretch' },
});
