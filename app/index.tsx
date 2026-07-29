import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { palette } from '@/theme/tokens';

/** Placeholder while the gate in _layout decides where this user belongs. */
export default function Index() {
  return (
    <View style={styles.root}>
      <ActivityIndicator color={palette.textFaint} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.bg },
});
