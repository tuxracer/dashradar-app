# tuxbank

**Live app: [tuxbank.app](https://tuxbank.app)**

A single-user, full-page month calendar for tracking money in and out. Every event is an all-day, date-based entry with an amount and a deposit or withdrawal direction, and the calendar keeps a running balance as the month plays out. By default everything runs in your browser with no account and no network. Cross-device sync is available as an optional, end-to-end-encrypted account, and the app stays fully usable offline and signed out.

## Features

- **Full-viewport month grid**: the calendar is the whole app, with month and year navigation.
- **Deposits and withdrawals**: each event carries an amount and a direction, and the calendar computes a running balance.
- **Recurring events**: edit or delete repeating events at three scopes (this occurrence, this and following, or the whole series).
- **Categories**: organize events with color-coded categories.
- **Backup and restore**: export the whole database to JSON and import it back, from the in-app Data dialog.
- **Optional encrypted sync**: turn on an account to keep the same calendar across devices over an end-to-end-encrypted channel. It is off by default, and the app stays fully usable offline and signed out.

## Getting started

```bash
pnpm install
pnpm dev   # http://localhost:5173
```

Other commands:

```bash
pnpm build       # Production build (vite build → dist/)
pnpm start       # Serve the production build (vite preview)
pnpm test        # Run tests once (vitest run)
pnpm test:watch  # Run tests in watch mode
pnpm check       # Verify formatting + lint + typecheck
pnpm format      # Auto-fix formatting (prettier --write)
```

## Your data

By default, all data lives in your browser's IndexedDB, on your device. With no account, nothing is sent anywhere: no sign-in, no sync, no server.

In local-only mode the browser holds the only copy, so clearing site data wipes the calendar. Use the in-app **Data** dialog to export a JSON backup periodically, and import it to restore or move to another browser.

## Sync across devices (optional)

Sync is optional and off by default. With no account, the app works exactly as described above. Turn it on to keep the same calendar on more than one device, with end-to-end encryption so the backend never sees your data in the clear.

- **End-to-end encrypted**: events and categories are encrypted in your browser, with a key derived from your password, before they upload. The backend stores only ciphertext and cannot read your calendar.
- **Account with required 2FA**: sign in with an email and password, with TOTP two-factor authentication required. Your real password never leaves the device; the server only receives a separate derived secret.
- **Recovery key**: a one-time recovery key independently unlocks your data if you forget your password.
- **Still local-first**: IndexedDB stays the source of truth, and sync runs in the background as a last-write-wins mirror. Everything keeps working offline and signed out.

The backend is a managed Supabase project (Postgres plus Auth) the browser talks to directly; authorization is enforced by Row Level Security, and this project ships no server code of its own. To enable sync, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (see `.env.example`). For step-by-step setup (creating the project, applying the schema, configuring auth), see [docs/sync.md](docs/sync.md).

## Contact

Mastodon: [@tuxracer@fosstodon.org](https://fosstodon.org/@tuxracer)

## License

[MIT](LICENSE)
