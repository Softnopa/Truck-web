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
