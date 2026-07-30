import React from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/components/Text';
import { radius, space } from '@/theme/tokens';
import { useElevation, useTheme } from '@/theme/useTheme';

interface Props {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

/** Bottom sheet: dim, spring up, dismiss by tapping the dim area. */
export function Sheet({ visible, title, onClose, children }: Props) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const elevation = useElevation();

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Animated.View
        entering={FadeIn.duration(180)}
        style={[styles.backdrop, { backgroundColor: theme.overlay }]}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={title} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Animated.View
            entering={SlideInDown.springify().damping(20).stiffness(180)}
            exiting={SlideOutDown.duration(180)}
            style={[
              styles.sheet,
              {
                paddingBottom: insets.bottom + space.lg,
                backgroundColor: theme.surface,
                borderColor: theme.border,
              },
              elevation.sheet,
            ]}
          >
            <View style={[styles.grabber, { backgroundColor: theme.borderHi }]} />
            <Text variant="heading">{title}</Text>
            <View style={styles.body}>{children}</View>
          </Animated.View>
        </KeyboardAvoidingView>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderTopWidth: 1,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    gap: space.base,
  },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: radius.pill,
    alignSelf: 'center',
    marginBottom: space.sm,
  },
  body: { gap: space.base },
});
