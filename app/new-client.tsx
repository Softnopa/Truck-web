import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Button, PressableScale } from '@/components/Button';
import { Field } from '@/components/Field';
import { FormScroll } from '@/components/FormScroll';
import { Header } from '@/components/Header';
import { Screen } from '@/components/Screen';
import { Segmented } from '@/components/Segmented';
import { Sheet } from '@/components/Sheet';
import { Text } from '@/components/Text';
import { createClient, listAllCustomers } from '@/lib/api';
import type { ClientKind } from '@/lib/database.types';
import { haptics } from '@/lib/haptics';
import { inviteLink } from '@/lib/invite';
import { shareOrCopy } from '@/lib/share';
import { useLoader } from '@/lib/useLoader';
import { useAuth } from '@/providers/AuthProvider';
import { usePrefs } from '@/providers/PreferencesProvider';
import { radius, space } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

/**
 * A contact is a Telegram chat the bot can reach.
 *
 * A private chat is not given a name of its own — it *is* a customer, picked
 * from the customers list, and it takes that customer's name. Two reasons: the
 * reminder WARN sends is looked up by customer, so a chat without one can never
 * be chased; and a hand-typed name that drifts from the customer's own is a
 * contact nobody can match up afterwards. A group is not a customer, so that
 * one still gets a typed name.
 */
export default function NewClient() {
  const { t, accentColors } = usePrefs();
  const theme = useTheme();
  const { profile } = useAuth();
  const router = useRouter();

  const [kind, setKind] = useState<ClientKind>('chat');
  const [groupName, setGroupName] = useState('');
  const [phone, setPhone] = useState('');
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const { data: customers } = useLoader(useCallback(() => listAllCustomers(), []));

  const group = kind === 'group';
  const name = group ? groupName.trim() : customerName;
  const valid = group ? name.length > 0 : customerId !== null;

  const save = async () => {
    if (!valid || !profile) return;
    setBusy(true);
    try {
      const client = await createClient(profile.id, {
        name,
        phone: phone.trim(),
        kind,
        customerId,
      });
      haptics.saved();

      const link = inviteLink(client.invite_code, kind);
      if (!link) {
        setNotice(t('botUsernameMissing'));
        setBusy(false);
        return;
      }

      // The share sheet does not exist on desktop web, so say where the link
      // went rather than appearing to do nothing.
      const how = await shareOrCopy(
        group
          ? t('inviteGroupMessage', { link, code: client.invite_code })
          : t('inviteMessage', { link })
      );
      if (how === 'copied') {
        setNotice(t('linkCopied'));
        setBusy(false);
        return;
      }
      router.back();
    } catch {
      haptics.failed();
      setBusy(false);
    }
  };

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']} keyboard>
      <Header title={t('newClient')} onBack={() => router.back()} />

      <FormScroll>
        <Animated.View entering={FadeInDown.duration(320)} style={styles.form}>
          <View style={styles.block}>
            <Text variant="label" color={theme.textDim}>
              {t('contactKind')}
            </Text>
            <Segmented
              options={[
                { value: 'chat' as ClientKind, label: t('kindChat') },
                { value: 'group' as ClientKind, label: t('kindGroup') },
              ]}
              value={kind}
              onChange={setKind}
            />
            <Text variant="caption" color={theme.textFaint}>
              {t(group ? 'kindGroupHint' : 'kindChatHint')}
            </Text>
          </View>

          {group ? (
            <Field
              label={t('groupName')}
              value={groupName}
              onChangeText={setGroupName}
              placeholder={t('groupName')}
              autoCapitalize="words"
              maxLength={60}
              autoFocus
            />
          ) : (
            <>
              {/* The picker stands where a name field used to: choosing the
                  customer is what names the contact. */}
              <View style={styles.block}>
                <Text variant="label" color={theme.textDim}>
                  {t('linkedCustomer')}
                </Text>
                <PressableScale
                  onPress={() => setPicking(true)}
                  to={0.99}
                  accessibilityLabel={t('linkedCustomer')}
                  style={[styles.picker, { borderColor: theme.border, backgroundColor: theme.surface }]}
                >
                  <Ionicons
                    name={customerId ? 'person' : 'person-add-outline'}
                    size={18}
                    color={customerId ? accentColors.base : theme.textFaint}
                  />
                  <Text
                    variant="body"
                    color={customerId ? theme.text : theme.textFaint}
                    style={styles.pickerText}
                    numberOfLines={1}
                  >
                    {customerId ? customerName : t('linkedCustomerNone')}
                  </Text>
                  <Ionicons name="chevron-forward" size={18} color={theme.textFaint} />
                </PressableScale>
                <Text variant="caption" color={theme.textFaint}>
                  {t('linkedCustomerHint')}
                </Text>
              </View>

              <Field
                label={t('clientPhone')}
                value={phone}
                onChangeText={setPhone}
                placeholder="+998 90 123 45 67"
                keyboardType="phone-pad"
                maxLength={20}
              />
            </>
          )}

          {notice ? (
            <View style={[styles.notice, { backgroundColor: accentColors.soft }]}>
              <Text variant="label" color={accentColors.base}>
                {notice}
              </Text>
            </View>
          ) : null}
        </Animated.View>
      </FormScroll>

      <View style={styles.footer}>
        <Button
          label={busy ? t('saving') : notice ? t('close') : t('save')}
          onPress={notice ? () => router.back() : save}
          disabled={!valid}
          loading={busy}
        />
      </View>

      <Sheet visible={picking} title={t('linkedCustomer')} onClose={() => setPicking(false)}>
        <FlatList
          data={customers ?? []}
          keyExtractor={(item) => item.id}
          style={styles.pickList}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <Text variant="label" color={theme.textFaint}>
              {t('noCustomers')}
            </Text>
          }
          renderItem={({ item }) => (
            <PressableScale
              onPress={() => {
                setCustomerId(item.id);
                setCustomerName(item.name);
                setPicking(false);
              }}
              to={0.99}
              accessibilityLabel={item.name}
              style={styles.pickRow}
            >
              <Text variant="body" numberOfLines={1}>
                {item.name || t('none')}
              </Text>
            </PressableScale>
          )}
        />
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: { gap: space.lg },
  block: { gap: space.sm },
  picker: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 50,
    paddingHorizontal: space.base,
    borderWidth: 1.5,
    borderRadius: radius.md,
  },
  pickerText: { flex: 1 },
  pickList: { maxHeight: 280 },
  pickRow: { paddingVertical: space.md },
  notice: { borderRadius: radius.sm, padding: space.md },
  footer: { paddingTop: space.md },
});
