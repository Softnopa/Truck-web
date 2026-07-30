import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, FlatList, StyleSheet, View } from 'react-native';
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
import { shareOrCopy } from '@/lib/share';
import { initials } from '@/lib/format';
import { useLoader } from '@/lib/useLoader';
import { useRealtime } from '@/lib/useRealtime';
import { usePrefs } from '@/providers/PreferencesProvider';
import { space } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

const BOT_USERNAME = process.env.EXPO_PUBLIC_TELEGRAM_BOT_USERNAME;

export default function Clients() {
  const { t, accentColors } = usePrefs();
  const theme = useTheme();
  const router = useRouter();
  const { data, loading, reload } = useLoader(useCallback(() => listClients(), []));
  const [composing, setComposing] = useState<ClientRow | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  useRealtime('clients', ['clients'], reload);

  const clients = data ?? [];

  const invite = (client: ClientRow) => {
    if (!BOT_USERNAME) return;
    const link = `https://t.me/${BOT_USERNAME}?start=${client.invite_code}`;
    haptics.tap();
    void (async () => {
      const how = await shareOrCopy(t('inviteMessage', { link }));
      // The share sheet does not exist on desktop web, so say plainly where the
      // link went instead of appearing to do nothing.
      setNotice(how === 'failed' ? t('somethingWrong') : how === 'copied' ? t('linkCopied') : null);
      if (how === 'failed') haptics.failed();
      else haptics.saved();
    })();
  };

  const openCompose = (client: ClientRow) => {
    haptics.tap();
    setDraft('');
    setComposing(client);
  };

  const send = async () => {
    if (!composing || !draft.trim()) return;
    setSending(true);
    setSendError(null);
    try {
      await sendTelegramMessage(composing.id, draft.trim());
      haptics.saved();
      setComposing(null);
      setNotice(t('messageSent'));
    } catch {
      // Shown inside the sheet: Alert.alert is a no-op on web, so a failure here
      // used to look exactly like nothing happening.
      haptics.failed();
      setSendError(t('messageFailed'));
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

      {notice ? (
        <Animated.View entering={FadeInDown.duration(220)}>
          <PressableScale onPress={() => setNotice(null)} to={0.99} accessibilityLabel={notice}>
            <View style={[styles.notice, { backgroundColor: accentColors.soft }]}>
              <Ionicons name="checkmark-circle" size={16} color={accentColors.base} />
              <Text variant="label" color={accentColors.base} style={styles.noticeText}>
                {notice}
              </Text>
              <Ionicons name="close" size={14} color={accentColors.base} />
            </View>
          </PressableScale>
        </Animated.View>
      ) : null}

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
                        <Text variant="label" color={theme.textDim} numeric>
                          {item.phone}
                        </Text>
                      ) : null}
                      <View style={styles.statusRow}>
                        <Ionicons
                          name={linked ? 'paper-plane' : 'paper-plane-outline'}
                          size={13}
                          color={linked ? accentColors.base : theme.textFaint}
                        />
                        <Text variant="caption" color={linked ? accentColors.base : theme.textFaint}>
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
        {sendError ? (
          <Text variant="label" color={theme.danger}>
            {sendError}
          </Text>
        ) : null}
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
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.base,
    paddingVertical: space.md,
    borderRadius: 12,
    marginBottom: space.md,
  },
  noticeText: { flex: 1 },
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
