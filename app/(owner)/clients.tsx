import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { PressableScale } from '@/components/Button';
import { Avatar, Card } from '@/components/Card';
import { Confirm } from '@/components/Confirm';
import { EmptyState } from '@/components/EmptyState';
import { Header } from '@/components/Header';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { deleteClient, listClients } from '@/lib/api';
import type { ClientRow } from '@/lib/database.types';
import { initials } from '@/lib/format';
import { haptics } from '@/lib/haptics';
import { inviteLink } from '@/lib/invite';
import { shareOrCopy } from '@/lib/share';
import { useLoader } from '@/lib/useLoader';
import { useRealtime } from '@/lib/useRealtime';
import { usePrefs } from '@/providers/PreferencesProvider';
import { space } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

type Notice = { kind: 'ok' | 'bad'; text: string };

/**
 * The contacts a bot can reach, and nothing more.
 *
 * There is deliberately no way to type a message here. A private chat is
 * chased by pressing WARN on the customer — the wording is built server-side
 * from that customer's own unpaid sales (see `remind-telegram`), so a hand-typed
 * figure can never contradict the books. A group receives every sale by itself.
 * That leaves this screen two jobs: hand out the invite link, and delete.
 */
export default function Clients() {
  const { t, accentColors } = usePrefs();
  const theme = useTheme();
  const router = useRouter();
  const { data, loading, reload } = useLoader(useCallback(() => listClients(), []));

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
    const link = inviteLink(client.invite_code, client.kind);
    if (!link) {
      haptics.failed();
      say('bad', t('botUsernameMissing'));
      return;
    }

    void (async () => {
      const how = await shareOrCopy(
        client.kind === 'group'
          ? t('inviteGroupMessage', { link, code: client.invite_code })
          : t('inviteMessage', { link })
      );
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
          const group = item.kind === 'group';
          // A chat with nobody behind it can never be chased: WARN looks the
          // contact up by customer, so an unset one is a dead row worth naming.
          const orphan = !group && !item.customer_id;

          const status = !linked
            ? { icon: 'paper-plane-outline' as const, text: t('telegramNotLinked'), on: false }
            : group
              ? { icon: 'megaphone' as const, text: t('groupLinked'), on: true }
              : orphan
                ? { icon: 'alert-circle' as const, text: t('contactNoCustomer'), on: false }
                : { icon: 'notifications' as const, text: t('contactAuto'), on: true };

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
                  onPress={() => (linked ? askDelete(item) : invite(item))}
                  onLongPress={() => askDelete(item)}
                  to={0.99}
                  accessibilityLabel={item.name}
                >
                  <Card>
                    <View style={styles.row}>
                      <Avatar text={initials(item.name)} color={accentColors.base} />
                      <View style={styles.identity}>
                        <View style={styles.nameRow}>
                          <Ionicons
                            name={group ? 'people' : 'person'}
                            size={13}
                            color={theme.textFaint}
                          />
                          <Text variant="heading" numberOfLines={1} style={styles.name}>
                            {item.name || t('none')}
                          </Text>
                        </View>
                        {item.phone ? (
                          <Text variant="label" color={theme.textDim} numeric>
                            {item.phone}
                          </Text>
                        ) : null}
                        <View style={styles.statusRow}>
                          <Ionicons
                            name={status.icon}
                            size={13}
                            color={
                              status.on
                                ? accentColors.base
                                : orphan && linked
                                  ? theme.warning
                                  : theme.textFaint
                            }
                          />
                          <Text
                            variant="caption"
                            color={
                              status.on
                                ? accentColors.base
                                : orphan && linked
                                  ? theme.warning
                                  : theme.textFaint
                            }
                            style={styles.name}
                          >
                            {status.text}
                          </Text>
                        </View>
                        {/* Said once per connected chat, because it is the whole
                            answer to "where do I write to them?" */}
                        {linked && !group && !orphan ? (
                          <Text variant="caption" color={theme.textFaint}>
                            {t('contactAutoHint')}
                          </Text>
                        ) : null}
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
                    onPress={() => (linked ? askDelete(item) : invite(item))}
                    to={0.92}
                    haptic="none"
                    accessibilityLabel={linked ? t('deleteClient') : t('inviteClient')}
                    style={[
                      styles.actionBtn,
                      { backgroundColor: linked ? theme.dangerSoft : accentColors.soft },
                    ]}
                  >
                    <Ionicons
                      name={linked ? 'trash-outline' : 'link'}
                      size={18}
                      color={linked ? theme.danger : accentColors.base}
                    />
                  </PressableScale>
                </View>
              </View>
            </Animated.View>
          );
        }}
      />

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
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  name: { flexShrink: 1 },
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
});
