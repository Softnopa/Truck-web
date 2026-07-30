import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { space } from '@/theme/tokens';
import { useIsDark, useTheme } from '@/theme/useTheme';

interface Props {
  children: React.ReactNode;
  /** Omit 'bottom' on tab screens — the tab bar already owns the home indicator. */
  edges?: readonly Edge[];
  padded?: boolean;
  keyboard?: boolean;
  style?: ViewStyle;
}

export function Screen({
  children,
  edges = ['top', 'left', 'right'],
  padded = true,
  keyboard = false,
  style,
}: Props) {
  const theme = useTheme();
  const isDark = useIsDark();

  const body = (
    <View style={[styles.body, padded && { paddingHorizontal: space.lg }, style]}>{children}</View>
  );

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.bg }]} edges={edges}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      {keyboard ? (
        <KeyboardAvoidingView
          style={styles.body}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          {body}
        </KeyboardAvoidingView>
      ) : (
        body
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { flex: 1 },
});
