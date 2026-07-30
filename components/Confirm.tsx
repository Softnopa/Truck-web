import React from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { Button } from '@/components/Button';
import { Text } from '@/components/Text';
import { space } from '@/theme/tokens';
import { useSkin } from '@/theme/useSkin';
import { useElevation, useTheme } from '@/theme/useTheme';

interface Props {
  visible: boolean;
  title: string;
  /** The consequence, in one sentence. Omitted when the title says it all. */
  message?: string;
  confirmLabel: string;
  cancelLabel: string;
  /** Paints the confirm button red — deletes, warnings, anything unrecoverable. */
  destructive?: boolean;
  /** Keeps the dialog up with a spinner while the action runs. */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * The app's confirmation dialog, replacing `Alert.alert`.
 *
 * `Alert` exists on react-native-web only as an empty stub — literally
 * `static alert() {}` — so every confirm built on it did nothing at all on the
 * web build: no dialog, no error, no console line. Pressing WARN or holding a
 * card to delete simply had no effect, which is indistinguishable from a broken
 * button. This is plain RN, so it behaves the same on web and on device.
 */
export function Confirm({
  visible,
  title,
  message,
  confirmLabel,
  cancelLabel,
  destructive,
  busy,
  onConfirm,
  onCancel,
}: Props) {
  const theme = useTheme();
  const elevation = useElevation();
  const { radius } = useSkin();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      // Android back button and the browser's Escape key both land here.
      onRequestClose={busy ? () => undefined : onCancel}
    >
      <Animated.View
        entering={FadeIn.duration(160)}
        style={[styles.backdrop, { backgroundColor: theme.overlay }]}
      >
        {/* Tapping the dim area is a cancel, never a confirm. */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={busy ? undefined : onCancel}
          accessibilityLabel={cancelLabel}
        />

        <Animated.View
          entering={FadeInDown.springify().damping(20).stiffness(200)}
          style={[
            styles.card,
            {
              backgroundColor: theme.surface,
              borderColor: theme.border,
              borderRadius: radius.lg,
            },
            elevation.sheet,
          ]}
        >
          <Text variant="title">{title}</Text>
          {message ? (
            <Text variant="body" color={theme.textDim}>
              {message}
            </Text>
          ) : null}

          <View style={styles.actions}>
            <Button
              label={confirmLabel}
              variant={destructive ? 'danger' : 'primary'}
              haptic={destructive ? 'heavy' : 'tap'}
              loading={busy}
              onPress={onConfirm}
            />
            <Button
              label={cancelLabel}
              variant="secondary"
              disabled={busy}
              onPress={onCancel}
            />
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.lg,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    borderWidth: 1,
    padding: space.lg,
    gap: space.md,
  },
  actions: { gap: space.md, marginTop: space.sm },
});
