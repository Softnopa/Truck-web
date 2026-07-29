import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, FlatList, Share, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { PressableScale } from '@/components/Button';
import { Avatar, Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { Field } from '@/components/Field';
import { Header } from '@/components/Header';
import { Screen } from '@/components/Screen';
import { Sheet } from '@/components/Sheet';
import { Text } from '@/components/Text';
import { deleteClient, listClients, sendTelegramMessage } from '@/lib/api';
import type { ClientRow } from '@/lib/database.types';
import { haptics } from '@/lib/haptics';
import { initials } from '@/lib/format';
import { useLoader } from '@/lib/useLoader';
import { useRealtime } from '@/lib/useRealtime';
import { usePrefs } from '@/providers/PreferencesProvider';
import { palette, space } from '@/theme/tokens';

const BOT_USERNAME = process.env.EXPO_PUBLIC_TELEGRAM_BOT_USERNAME;

export default function Clients() {
  const { t, accentColors } = usePrefs();
  const router = useRouter();
  const { data, loading, reload } = useLoader(useCallback(() => listClients(), []));
  const [composing, setComposing] = useState<ClientRow | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  useRealtime('clients', ['clients'], reload);

  const clients = data ?? [];

  const invite = (client: ClientRow) => {
    if (!BOT_USERNAME) return;
    const link = `https://t.me/${BOT_USERNAME}?start=${client.invite_code}`;
    haptics.tap();
    void Share.share({ message: t('inviteMessage', { link }) });
  };

  const openCompose = (client: ClientRow) => {
    haptics.tap();
    setDraft('');
    setComposing(client);
  };

  const send = async () => {
    if (!composing || !draft.trim()) return;
    setSending(true);
    try {
      await sendTelegramMessage(composing.id, draft.trim());
      haptics.saved();
      setComposing(null);
    } catch {
      haptics.failed();
      Alert.alert(t('messageFailed'));
    } finally {
      setSending(false);
    }
  };

  const confirmDelete = (client: ClientRow) => {
    haptics.warn();
    Alert.alert(t('deleteClient'), t('deleteClientConfirm'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('delete'),
        style: 'destructive',
        onPress: () => {
          void (async () => {
            await deleteClient(client.id);
            haptics.saved();
            await reload();
          })();
        },
      },
    ]);
  };

  return (
    <Screen edges={['top', 'left', 'right']}>
      <Header
        title={t('clients')}
        actionIcon="add"
        actionLabel={t('addClient')}
        onAction={() => router.push('/new-client')}
      />

      <FlatList
        data={clients}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshing={loading && clients.length > 0}
        onRefresh={() => void reload()}
        ListEmptyComponent={
          loading ? null : (
            <EmptyState icon="paper-plane-outline" title={t('noClients')} hint={t('noClientsHint')} />
          )
        }
        renderItem={({ item, index }) => {
          const linked = Boolean(item.telegram_chat_id);
          return (
            <Animated.View
              layout={LinearTransition.springify().damping(20)}
              entering={FadeInDown.delay(Math.min(index, 8) * 45).springify().damping(18)}
            >
              <PressableScale onLongPress={() => confirmDelete(item)} to={0.99} accessibilityLabel={item.name}>
                <Card>
                  <View style={styles.row}>
                    <Avatar text={initials(item.name)} color={accentColors.base} />
                    <View style={styles.identity}>
                      <Text variant="heading" numberOfLines={1}>
                        {item.name || t('none')}
                      </Text>
                      {item.phone ? (
                        <Text variant="label" color={palette.textDim} numeric>
                          {item.phone}
                        </Text>
                      ) : null}
                      <View style={styles.statusRow}>
                        <Ionicons
                          name={linked ? 'paper-plane' : 'paper-plane-outline'}
                          size={13}
                          color={linked ? accentColors.base : palette.textFaint}
                        />
                        <Text variant="caption" color={linked ? accentColors.base : palette.textFaint}>
                          {linked ? t('telegramLinked') : t('telegramNotLinked')}
                        </Text>
                      </View>
                    </View>
                    <PressableScale
                      onPress={() => (linked ? openCompose(item) : invite(item))}
                      to={0.92}
                      accessibilityLabel={linked ? t('message') : t('inviteClient')}
                      style={[styles.actionBtn, { backgroundColor: accentColors.soft }]}
                    >
                      <Ionicons
                        name={linked ? 'chatbubble-ellipses' : 'link'}
                        size={18}
                        color={accentColors.base}
                      />
                    </PressableScale>
                  </View>
                </Card>
              </PressableScale>
            </Animated.View>
          );
        }}
      />

      <Sheet
        visible={composing !== null}
        title={composing ? `${t('messageSheetTitle')} · ${composing.name}` : ''}
        onClose={() => setComposing(null)}
      >
        <Field
          label={t('message')}
          value={draft}
          onChangeText={setDraft}
          placeholder={t('messagePlaceholder')}
          autoCapitalize="sentences"
          maxLength={500}
          autoFocus
        />
        <PressableScale
          onPress={() => void send()}
          disabled={!draft.trim() || sending}
          to={0.97}
          accessibilityLabel={t('sendMessage')}
          style={[styles.sendBtn, { backgroundColor: accentColors.base }]}
        >
          <Text variant="heading" color={accentColors.on}>
            {sending ? t('saving') : t('sendMessage')}
          </Text>
        </PressableScale>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.md, paddingBottom: space.xxl },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  identity: { flex: 1, gap: 2 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  actionBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtn: {
    minHeight: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
