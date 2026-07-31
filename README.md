# Truck

Fruit-truck management for three owners and their customers. Expo + React Native
+ TypeScript, backed by Supabase with row level security.

## Setup

### 1. Rotate the leaked key first

`Supabase.md` contains a `service_role` secret in plaintext. That key bypasses
every RLS policy. Rotate it in **Supabase → Project Settings → API keys**, and
keep it out of this repo — the app only ever uses the publishable key.

### 2. Apply the migration

Open **Supabase → SQL Editor → New query**, paste all of
`supabase/migrations/0001_roles_consent_warnings.sql`, and run it.

It only adds objects. `trucks`, `sales`, `payments` and `owners` keep every row
they already have. It also repairs a pre-existing bug: `owners` carried a
self-referencing policy that made every read fail with
`42P17 infinite recursion detected in policy for relation "owners"`.

### 3. Create the three owners

Add each account under **Authentication → Users**, then in the SQL editor:

```sql
select public.promote_owner('azamat@example.com', 'Azamat');
select public.promote_owner('farrux@example.com', 'Farrux');
select public.promote_owner('zafar@example.com',  'Zafar');
```

Everyone who signs up afterwards is a `customer`. Role is never taken from
client-supplied signup metadata, so nobody can register themselves as an owner.

### 4. Run it

```bash
npm install
cp .env.example .env      # fill in your project URL + publishable key
npx expo start
```

Scan the QR with the iPhone camera to open it in **Expo Go**. Everything works
there except remote push — warnings still arrive over Supabase Realtime while
the customer has the app open.

The project is pinned to **Expo SDK 54** on purpose. Expo Go on the App Store
runs exactly one SDK, and a mismatch fails with "wrong version" before the app
loads. Check which one before upgrading:

```bash
curl -s https://api.expo.dev/v2/versions/latest | grep -o '"expoGoSdkVersion":"[^"]*"'
```

`npm view expo version` is the wrong signal — it reports the newest SDK, which
Expo Go usually cannot run yet.

On macOS you can also run `npx expo run:ios`. From Windows, use EAS Build
(below) to produce an installable app.

### 5. Installing on an iPhone from Windows

iOS apps cannot be compiled on Windows. EAS builds on Apple hardware in the
cloud and hands back an installable app:

```bash
npx eas login          # free Expo account
npx eas init           # also assigns the projectId push needs
npx eas device:create  # register each iPhone's UDID, install the profile
npx eas build --platform ios --profile preview
```

The build finishes with a QR code; open it on the iPhone to install.

This requires an **Apple Developer Program membership ($99/year)** — Apple does
not issue provisioning profiles for real devices without one. For more than a
handful of devices, use `--profile production` and ship through TestFlight.

### 6. Push notifications

Warnings deliver over Supabase Realtime out of the box. To also send a real
push, run `eas init` once — that assigns the project id `registerPushToken()`
needs. Until then the WARN flow still works and logs the result as `no_device`.
No server component is needed; Expo's push endpoint is called directly from the
owner's device.

### 7. Telegram

One bot does two jobs: it announces new trucks and sales, and it chases
customers for money. Nobody types a message anywhere — every word the bot sends
is built server-side from the books. The functions live in
`supabase/functions/`.

1. Create the bot with BotFather, and add it as an **admin** of the channel.
2. In **Edge Functions → Secrets**, add:
   - `TELEGRAM_BOT_TOKEN` — shared by every function
   - `TELEGRAM_CHANNEL_ID` (e.g. `-1001234567890`)
   - `TELEGRAM_WEBHOOK_SECRET` — any long random string you choose
   - optionally `TELEGRAM_CHANNEL_LANG=ru|uz|en`
3. Deploy `announce-telegram`, `remind-telegram` and `telegram-webhook`.
   **Turn "Verify JWT" off for `telegram-webhook` only** — Telegram calls it and
   has no Supabase session, so with verification on every update is rejected
   before it reaches the code and the bot looks dead. The others keep it on;
   they run as the signed-in owner.
4. Point Telegram at the webhook, passing the same secret:

   ```bash
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
     -d "url=https://<project-ref>.supabase.co/functions/v1/telegram-webhook" \
     -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
   ```

5. Put the bot's `@username` (without the `@`) in `EXPO_PUBLIC_TELEGRAM_BOT_USERNAME`.
   Only the username — the token stays server-side. Without it the Contacts
   screen has no invite link to share and says so.

Announcements fire automatically when a truck or sale is created; `telegram_posts`
(migration 0007) makes sure a retry cannot post the same sale twice.

**Contacts** are people with no app account. The owner shares
`t.me/<bot>?start=<invite_code>`; tapping it sends `/start <code>` to the
webhook, which trades the code for that chat id. Until they do, the app shows
"Not connected yet".

A contact is one of two kinds, chosen when it is added (migration 0009):

- **Chat** — one person, and always *a customer*: the contact is created by
  picking from the customers list and takes that customer's name, so the two
  can never drift apart. There is no message box in the app. Pressing **WARN**
  on that customer is the send: the bot writes the reminder itself from the
  customer's own unpaid sales — name, amount, date, and the position their
  device just answered with — and the nightly sweep sends the same wording for
  anything unpaid for three days.
- **Group** — a Telegram group. It receives every sale as it happens, with the
  buyer, who took the money, the outstanding total across all customers, and
  today's takings read against yesterday's.

Groups link with `t.me/<bot>?startgroup=<code>`, which only adds the bot —
Telegram does not reliably hand the code over afterwards, so send
`/start <code>` inside the group once. The bot says so itself when it is added.

#### Growth and drops in the group, with pictures

Every sale posted to a group carries a banner reading the day against the one
before it: **📈 Sales are up**, **📉 Sales are down**, **➖ Level with
yesterday**, or **🌅 First sale of the day** when there is nothing to compare
against yet. Give each direction a picture and the post becomes that picture
with the figures as its caption. All four secrets are optional — a direction
with no picture is posted as text, so you can set only the two that matter:

| Secret | When it is used |
| --- | --- |
| `TELEGRAM_IMAGE_UP` | the day is ahead of yesterday |
| `TELEGRAM_IMAGE_DOWN` | the day is behind yesterday |
| `TELEGRAM_IMAGE_FLAT` | within the threshold either way, or the first sale |
| `TELEGRAM_TREND_MIN` | percent that counts as a move at all — default `5` |

Each image is an `https://` URL Telegram can fetch, or a `file_id` from a photo
the bot has already sent. Supabase Storage works well for this: upload to a
public bucket and paste the public URL. If Telegram will not fetch it — dead
link, file too large, host unreachable — the post falls back to plain text, so
a broken picture never costs the group the sale.

`TELEGRAM_TREND_MIN` exists so a day landing within a few percent of the last
one is reported as level rather than as growth. Set it to `0` to have every
non-zero difference call itself up or down.

The channel keeps the plain announcement; the banner and the pictures are for
groups, where they are read by people rather than archived.

### 8. Automatic payment reminders

`remind-telegram` chases overdue debts. Add a `CRON_SECRET` secret (any long
random string) alongside the bot token, then schedule the sweep — **Dashboard →
Integrations → Cron**, or in the SQL editor with pg_cron and pg_net:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'telegram-payment-reminders',
  '0 4 * * *',                             -- 04:00 UTC = 09:00 in Tashkent
  $$
  select net.http_post(
    url     := 'https://euvmtcfioafwafudpcda.supabase.co/functions/v1/remind-telegram',
    headers := '{"Content-Type":"application/json","X-Cron-Secret":"<CRON_SECRET>"}'::jsonb,
    body    := '{"sweep":true}'::jsonb
  );
  $$
);
```

Check it with `select jobid, schedule, jobname from cron.job;`, and undo it with
`select cron.unschedule('telegram-payment-reminders');`. The secret sits in the
job definition, so anyone with database access can read it — that is the usual
trade for pg_cron; move it into Supabase Vault if that matters.

It nudges a customer whose oldest unpaid sale is at least three days old, and
never more than once every three days — both constants sit at the top of
`supabase/functions/remind-telegram/index.ts`. Run it as often as you like; the
quiet period is what stops it repeating, not the schedule.

If invite links were created before migration 0008, run it — codes minted
before it could contain a `+`, which a Telegram deep link cannot carry.

### 9. The Growth button

The **Growth** tab is one button covering most of the screen. Pressing it posts
the day's figures to every connected group and **pins** the result, so the
current state of trade sits at the top of the chat instead of scrolling away
under the next sale.

The report carries the same up/down banner and pictures the per-sale posts do,
plus the day against yesterday, how many sales there have been, the best
customer so far, and the outstanding total. The figures above the button are
what is about to be sent — an owner should see the numbers before publishing
them.

To turn it on:

1. Run migration `0010_growth_reports.sql`. It widens one check constraint so
   `telegram_posts` can remember which message is pinned in each group; without
   it the post still goes out but every report stacks another pin.
2. Deploy `growth-telegram`, with "Verify JWT" left **on** — it runs as the
   signed-in owner and refuses anyone who is not one.
3. Make the bot an **admin** of each group with the **Pin messages** right.

That last step is the one that catches people. Without it the report is posted
and only the pin is skipped, and the app says so — *"Posted, but not pinned"* —
rather than reporting a success that did not happen. Everything else it needs
(`TELEGRAM_BOT_TOKEN`, the `TELEGRAM_IMAGE_*` pictures, `TELEGRAM_TREND_MIN`,
`REPORT_UTC_OFFSET`) it shares with `announce-telegram`, so a working group
announcement means this is already configured.

Each press replaces the previous pin rather than adding to it, so a group ends
up with exactly one report pinned: the latest.

## Screen lock

The app is locked on every launch, and none of it can be switched off from
inside Settings — a lock an owner can disable is one a stranger holding the
phone can disable too. Settings states what is on rather than offering it.

- **The pattern** runs everywhere: phone, browser, signed in or out. Signed out
  it sits on the login page and drawing it reveals the email and password form;
  signed in it stands in front of the app itself. Five wrong patterns drop the
  session. It is a screen lock, not a credential — `lib/patternLock.ts` is
  explicit about what that does and does not buy.
- **Face ID / Touch ID** (`lib/faceNative.ts`) runs in front of the pattern on a
  phone, through the OS. Nothing is enrolled and nothing is sealed, because the
  session already lives in the Keychain rather than in readable storage; a face
  here buys the same thing the pattern does, faster. It appears only where the
  device has Face ID, Touch ID or a passcode set up, and cancelling it simply
  leaves the pattern.
- **Face unlock / Face ID on the web** are different animals and stay opt-in,
  because a browser has no keystore: they encrypt the Supabase session with a
  key that does not exist until a face releases it. `lib/faceLock.ts` (WebAuthn,
  Windows Hello / Touch ID) and `lib/faceId.ts` (a camera plus the local service
  in `face-id/`) each explain themselves at the top. Turning either off never
  leaves the app unlocked; the pattern is still there.

iOS needs `NSFaceIDUsageDescription`, which `app.json` sets through the
`expo-local-authentication` plugin. Without it iOS silently downgrades the
prompt to the device passcode, so a build that has lost that key looks like
Face ID "not working" rather than like a missing permission.

## Troubleshooting

**`EPERM: operation not permitted, mkdir 'C:\Users\<you>\.expo'`**

The Expo CLI writes an anonymous telemetry id to `~/.expo` and exits if it
cannot. On a profile whose root denies directory creation, redirect it:

```powershell
[Environment]::SetEnvironmentVariable('__UNSAFE_EXPO_HOME_DIRECTORY', "$env:LOCALAPPDATA\.expo", 'User')
```

Reopen the terminal afterwards. `EXPO_NO_TELEMETRY=1` alone is not enough —
other CLI state lands in the same directory.

## Roles

|          | Owner                        | Customer                   |
| -------- | ---------------------------- | -------------------------- |
| Trucks   | full                         | no access                  |
| Sales    | full                         | own only                   |
| Warn     | send                         | receive                    |
| Map      | all pins                     | —                          |
| Settings | language, accent, text size  | language + consent only    |

Enforcement is in RLS, not in the client. `public.is_owner()` is
`SECURITY DEFINER` so policies can call it without re-entering the policy they
guard.

## Layout

```
app/             expo-router screens, grouped (owner) / (customer)
components/      design system primitives
theme/tokens.ts  spacing, radii, type ramp, accents, springs
i18n/strings.ts  RU / UZ / EN — English is the source of truth
lib/             supabase client, typed schema, data access, hooks
supabase/        the migration
```

`i18n/strings.ts` types `ru` and `uz` as `Record<StringKey, string>`, so a
missing translation is a compile error rather than an English string leaking
into a Russian screen.

## What was removed

Custom inputs, the Electron/Vite desktop shell, the IndexedDB offline layer,
dual USD/UZS currency, PDF/Excel export, plaintext passwords, and six of the ten
fields on the truck form.
# Truck-web
