import React from 'react';
import { ScrollView, StyleSheet, type ViewStyle } from 'react-native';
import { space } from '@/theme/tokens';

/**
 * The scroll container every form uses.
 *
 * `automaticallyAdjustKeyboardInsets` is what actually keeps a focused input
 * above the keyboard: iOS insets the scroll content by the keyboard height and
 * scrolls the focused field into view. A KeyboardAvoidingView alone only shifts
 * the whole screen, which left the lower fields hidden behind the keyboard.
 */
export function FormScroll({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.content, style]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      automaticallyAdjustKeyboardInsets
      contentInsetAdjustmentBehavior="always"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  // Room to scroll the last field clear of the keyboard.
  content: { paddingBottom: space.xxxl },
});
