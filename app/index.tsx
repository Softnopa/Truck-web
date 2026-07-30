import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useTheme } from '@/theme/useTheme';

/** Placeholder while the gate in _layout decides where this user belongs. */
export default function Index() {
  const theme = useTheme();
  return (
    <View style={[styles.root, { backgroundColor: theme.bg }]}>
      <ActivityIndicator color={theme.textFaint} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
