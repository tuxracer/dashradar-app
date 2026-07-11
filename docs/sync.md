# Enabling account sync

Sync is off by default: with no Supabase config the app is local-only and
offline. Setting the two `VITE_SUPABASE_*` env vars turns on the in-app SYNC
controls. The browser talks to your Supabase project directly with a public
publishable key, and Row Level Security does all authorization, so there is no
server code to deploy. For the design and security model, see the
[Optional account sync section in docs/TRD.md](TRD.md#optional-account-sync-end-to-end-encrypted).

Prerequisites: a [Supabase](https://supabase.com) account (free plan is enough
for one user) and this repo checked out with `pnpm install` run.

## 1. Create a Supabase project

Create a project in the dashboard and wait for it to provision. The app only uses
the public API, so the database password does not matter here.

## 2. Apply the schema

Run [`supabase/migrations/0001_e2ee_sync.sql`](../supabase/migrations/0001_e2ee_sync.sql).
It creates the `events`, `categories`, and `key_material` tables plus the RLS
policies that enforce per-user isolation and require TOTP.

- **Dashboard:** open the SQL Editor, paste the file's contents, and run it.
- **CLI:** `supabase link --project-ref YOUR-PROJECT-REF && supabase db push`

## 3. Configure authentication

Under Authentication in the dashboard:

- **Enable TOTP (authenticator-app) MFA.** Required: the database rejects all
  reads and writes until the session passes the TOTP challenge.
- **Set the Site URL** (URL Configuration) to where the app runs so emails link
  back: `http://localhost:5173` for dev, your real origin in production. Add both
  to the allowed redirect URLs if you use more than one.
- **Email confirmation** can stay on (recommended) or off; with it off, setup
  finishes without the email round-trip (convenient for local testing).

## 4. Copy the project URL and publishable key

In Project Settings under API / API Keys, copy the **Project URL** (for example
`https://abcdefgh.supabase.co`) and the **publishable** key (starts with
`sb_publishable_`). Both are public and safe to ship in the client bundle; never
use a secret key in the browser.

## 5. Set the environment variables

Template in [`.env.example`](../.env.example):

```bash
VITE_SUPABASE_URL=https://YOUR-PROJECT-ref.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxx
```

- **Local dev:** put both in a `.env.local` file at the repo root (gitignored),
  then restart `pnpm dev`.
- **Production:** set both in your host's environment and redeploy. Vite inlines
  `VITE_*` at build time, so a build made before the variables existed lacks them.

If both are absent, the app stays in local-only mode with the SYNC controls
inert. That is the intended fallback, not an error.

## 6. Create your account in the app

1. Open the SYNC dialog (SYNC button in the toolbar, or the overflow menu on
   narrow screens) and choose Create account.
2. Set a strong password. It is the root of your encryption: without it (and
   without the recovery key) the cloud data cannot be recovered.
3. If email confirmation is on, click the emailed link, then sign in.
4. Scan the TOTP QR code with an authenticator app and enter a code.
5. Save the one-time recovery key when shown. It is the only way back in if you
   forget your password.

Your local events and categories upload on first sign-in. On another device,
choose Sign in, pass the TOTP challenge, and the data pulls down and merges.

## Verify it worked

The SYNC button settles into a synced state (no OFFLINE, LOCKED, or ERROR badge),
and in the Table Editor `events` and `categories` hold rows whose `ciphertext` is
unreadable base64. Seeing only ciphertext confirms the server never receives your
plaintext.

## Troubleshooting

- **SYNC does nothing / no account UI:** env vars missing or the build predates
  them. Set both, then restart the dev server or redeploy.
- **Account creation fails at two-factor:** TOTP MFA is not enabled. Enable it
  under Authentication and retry.
- **Sign-in reports email not confirmed:** open the confirmation email, or toggle
  confirmation off for local testing.
- **Sync errors with RLS / `42501`, or no rows sync:** the schema or its policies
  did not apply, or the session has not reached `aal2`. Re-run the migration and
  complete the TOTP challenge this session.
