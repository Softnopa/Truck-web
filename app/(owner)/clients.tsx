import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { Button, PressableScale } from '@/components/Button';
import { Avatar, Card } from '@/components/Card';
import { Confirm } from '@/components/Confirm';
import { EmptyState } from '@/components/EmptyState';
import { Field } from '@/components/Field';
import { Header } from '@/components/Header';
import { Screen } from '@/components/Screen';
import { Sheet } from '@/components/Sheet';
import { Text } from '@/components/Text';
import { deleteClient, EdgeFunctionError, listClients, sendTelegramMessage } from '@/lib/api';
import type { ClientRow } from '@/lib/database.types';
import { initials } from '@/lib/format';
import { haptics } from '@/lib/haptics';
import { shareOrCopy } from '@/lib/share';
import { useLoader } from '@/lib/useLoader';
import { useRealtime } from '@/lib/useRealtime';
import { usePrefs } from '@/providers/PreferencesProvider';
import type { StringKey } from '@/i18n/strings';
import { space } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

const BOT_USERNAME = process.env.EXPO_PUBLIC_TELEGRAM_BOT_USERNAME;

const MESSAGE_LIMIT = 900;

/** What went wrong, in the owner's language rather than the server's. */
function failureKey(error: unknown): StringKey {
  if (!(error instanceof EdgeFunctionError)) return 'somethingWrong';
  switch (error.code) {
    case 'unreachable':
      return 'sendUnreachable';
    case 'not_configured':
      return 'sendNotConfigured';
    case 'not_linked':
      return 'sendNotLinked';
    case 'not_found':
      return 'sendNotFound';
    case 'blocked':
      return 'sendBlocked';
    case 'unauthorized':
    case 'forbidden':
      return 'sendForbidden';
    case 'telegram_failed':
      return 'sendTelegramFailed';
    default:
      return 'messageFailed';
  }
}

type Notice = { kind: 'ok' | 'bad'; text: string };

export default function Clients() {
  const { t, accentColors } = usePrefs();
  const theme = useTheme();
  const router = useRouter();
  const { data, loading, reload } = useLoader(useCallback(() => listClients(), []));

  const [composing, setComposing] = useState<ClientRow | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ClientRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  useRealtime('clients', ['clients'], reload);

  const clients = data ?? [];

  const say = (kind: Notice['kind'], text: string) => setNotice({ kind, text });

  const invite = (client: ClientRow) => {
    haptics.tap();
    // Without the bot's @username there is no link to build. Saying so beats a
    // button that quietly does nothing, which is what this used to do.
    if (!BOT_USERNAME) {
      haptics.failed();
      say('bad', t('botUsernameMissing'));
      return;
    }

    const link = `https://t.me/${BOT_USERNAME}?start=${client.invite_code}`;
    void (async () => {
      const how = await shareOrCopy(t('inviteMessage', { link }));
      // The share sheet does not exist on desktop web, so say plainly where the
      // link went instead of appearing to do nothing.
      if (how === 'failed') {
        haptics.failed();
        say('bad', t('somethingWrong'));
      } else {
        haptics.saved();
        if (how === 'copied') say('ok', t('linkCopied'));
      }
    })();
  };

  const openCompose = (client: ClientRow) => {
    haptics.tap();
    setDraft('');
    setSendError(null);
    setNotice(null);
    setComposing(client);
  };

  const send = async () => {
    const client = composing;
    const text = draft.trim();
    if (!client || !text || sending) return;

    setSending(true);
    setSendError(null);
    try {
      await sendTelegramMessage(client.id, text);
      haptics.saved();
      setComposing(null);
      setDraft('');
      say('ok', t('messageSent'));
    } catch (error) {
      // Stays inside the sheet with the text intact, so the owner can fix the
      // cause and press send again without retyping.
      haptics.failed();
      setSendError(t(failureKey(error)));
      if (error instanceof EdgeFunctionError) {
        console.warn('send-telegram failed', error.code, error.status, error.detail);
      }
    } finally {
      setSending(false);
    }
  };

  const askDelete = (client: ClientRow) => {
    haptics.warn();
    setPendingDelete(client);
  };

  const runDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deleteClient(pendingDelete.id);
      haptics.saved();
      await reload();
    } catch {
      haptics.failed();
      say('bad', t('somethingWrong'));
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
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
          <PressableScale onPress={() => setNotice(null)} to={0.99} accessibilityLabel={notice.text}>
            <View
              style={[
                styles.notice,
                { backgroundColor: notice.kind === 'ok' ? accentColors.soft : theme.dangerSoft },
              ]}
            >
              <Ionicons
                name={notice.kind === 'ok' ? 'checkmark-circle' : 'alert-circle'}
                size={16}
                color={notice.kind === 'ok' ? accentColors.base : theme.danger}
              />
              <Text
                variant="label"
                color={notice.kind === 'ok' ? accentColors.base : theme.danger}
                style={styles.noticeText}
              >
                {notice.text}
              </Text>
              <Ionicons
                name="close"
                size={14}
                color={notice.kind === 'ok' ? accentColors.base : theme.danger}
              />
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
              {/* The action button is a sibling of the card's pressable, never a
                  child of it: a button nested inside another pressable fires
                  both on web. */}
              <View>
                <PressableScale
                  onPress={() => (linked ? openCompose(item) : invite(item))}
                  onLongPress={() => askDelete(item)}
                  to={0.99}
                  accessibilityLabel={item.name}
                >
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
                      {/* Reserves the space the round button floats over. */}
                      <View style={styles.actionSlot} />
                    </View>
                  </Card>
                </PressableScale>

                {/* box-none: the strip itself passes touches through to the
                    card, only the round button below catches them. */}
                <View style={styles.actionLayer} pointerEvents="box-none">
                  <PressableScale
                    onPress={() => (linked ? openCompose(item) : invite(item))}
                    to={0.92}
                    accessibilityLabel={linked ? t('sendMessage') : t('inviteClient')}
                    style={[styles.actionBtn, { backgroundColor: accentColors.soft }]}
                  >
                    <Ionicons
                      name={linked ? 'chatbubble-ellipses' : 'link'}
                      size={18}
                      color={accentColors.base}
                    />
                  </PressableScale>
                </View>
              </View>
            </Animated.View>
          );
        }}
      />

      <Sheet
        visible={composing !== null}
        title={composing ? `${t('messageSheetTitle')} · ${composing.name}` : ''}
        onClose={() => {
          if (!sending) setComposing(null);
        }}
      >
        <Field
          label={t('message')}
          value={draft}
          onChangeText={(v) => {
            setDraft(v);
            if (sendError) setSendError(null);
          }}
          placeholder={t('messagePlaceholder')}
          autoCapitalize="sentences"
          maxLength={MESSAGE_LIMIT}
          multiline
          autoFocus
        />

        {sendError ? (
          <View style={[styles.error, { backgroundColor: theme.dangerSoft }]}>
            <Ionicons name="alert-circle" size={16} color={theme.danger} />
            <Text variant="label" color={theme.danger} style={styles.errorText}>
              {sendError}
            </Text>
          </View>
        ) : (
          <Text variant="caption" color={theme.textFaint}>
            {t('messageDeliveredVia')}
          </Text>
        )}

        <Button
          label={sending ? t('sending') : t('sendMessage')}
          onPress={() => void send()}
          disabled={draft.trim().length === 0}
          loading={sending}
          icon={<Ionicons name="paper-plane" size={18} color={accentColors.on} />}
        />
      </Sheet>

      <Confirm
        visible={pendingDelete !== null}
        title={t('deleteClient')}
        message={
          pendingDelete
            ? `${pendingDelete.name || t('none')} · ${t('deleteClientConfirm')}`
            : t('deleteClientConfirm')
        }
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        destructive
        busy={deleting}
        onConfirm={() => void runDelete()}
        onCancel={() => setPendingDelete(null)}
      />
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
  actionSlot: { width: 40, height: 40 },
  actionLayer: {
    position: 'absolute',
    right: space.base,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  actionBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    padding: space.md,
    borderRadius: 12,
  },
  errorText: { flex: 1 },
});
