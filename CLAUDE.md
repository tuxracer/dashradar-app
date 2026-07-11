# tuxbank

A single-user, full-page **month calendar** web app with a **cyberpunk-inspired** UI. All-day, date-based events, each with an amount and a deposit/withdrawal direction, are created, edited, and deleted entirely in the browser and persist in **IndexedDB** (via the `idb` library). Local-only with no account is the default; an **optional, end-to-end-encrypted account sync** (managed Supabase backend, required TOTP 2FA) can be turned on to sync across devices, and the app stays fully usable offline and signed out. Events can recur, and recurring events edit/delete at three scopes (this occurrence / this and following / the whole series).

See [docs/TRD.md](docs/TRD.md) for the full technical reference.

**Repository URL**: https://github.com/tuxracer/tuxbank

## Architecture

Client-only **Vite 8 React SPA** with **no backend or server runtime of its own** (the build is a static `dist/`). Data flows `src/App.tsx` → `CalendarProvider` → `src/lib/*` → IndexedDB (via `idb`). Optional account sync is an additive second path: a `SyncProvider` drives `src/lib/{crypto,account,sync,supabase}` against a managed Supabase backend the browser talks to directly (RLS does authorization; there is no server code of ours). IndexedDB stays the source of truth and local-only use is unchanged when signed out. See [the optional account sync section in docs/TRD.md](docs/TRD.md) for the full design.

- **`index.html` + `src/main.tsx`** — Vite entry: mounts `<App />` under `StrictMode`, imports the `@fontsource` fonts and `src/globals.css` (Tailwind + cyberpunk theme), and registers the PWA service worker (`virtual:pwa-register`, silent auto-update).
- **`src/App.tsx`** — top-level calendar screen composition.
- **`src/context/CalendarContext/`** — app-wide state via React context; consume with the `useCalendar()` hook (events, categories, CRUD, recurrence-scope handling).
- **`src/context/SyncContext/`** — optional account-sync state via React context; consume with the `useSync()` hook (status machine, create-account / sign-in / unlock / sign-out, change password, recovery). The in-memory data key lives only in a ref; the provider is inert unless Supabase is configured.
- **`src/components/`** — UI: `MonthGrid`, `DayCell`, `EventChip`, `EventDialog`, `CategoryCombobox`, `ManageCategoriesDialog`, `RecurrenceScopeDialog`, `CalendarToolbar` (month/year nav), `DataDialog` (JSON backup export/import), `SyncDialog` (optional account sync: create / sign-in / TOTP / recovery-key / change-password), `DayEventsPopover`, `DraggableEventChip` (drag events between days), `CyberFrame`, `CyControlFrame`, … · shadcn primitives in `src/components/ui/`.
- **`src/lib/`** — React-free domain logic: `storage` (IndexedDB via `idb`; CRUD + JSON backup export/import; per-row `updatedAt` + tombstones + a sync cursor for sync; broadcasts a cross-tab signal after successful writes), `tabSync` (cross-tab change notifications over `BroadcastChannel`: `notifyDataChanged` + `subscribeToDataChanges`), `recurrence` (expand/edit/delete series + occurrence overrides), `dateGrid` (month-grid construction), `balance` (running balance from deposits/withdrawals). Optional-sync modules: `crypto` (libsodium: Argon2id key derivation, XChaCha20-Poly1305 encryption, recovery keys), `account` (Supabase auth + TOTP + key-material orchestration, plus pure key-wrapping helpers), `sync` (last-write-wins push/pull merge engine over a mockable `SyncRemote`), `supabase` (client init + base64 row serialization).
- **`src/types/`** — shared types + guards (`CalendarEvent`, `Category`, `Recurrence`, `isCalendarEvent`, …).
- **`src/utils/`** — small shared helpers (e.g. `formatCurrency`).

Each module is a directory named after its primary export, containing `index.ts` and optionally `consts.ts` (constants), `types.ts` (types + guards), and `tests.ts`.

**Rendering**: pure client-side SPA — there is no server rendering of any kind. IndexedDB is browser-only; never introduce SSR/SSG or anything that renders app state outside the browser.

**Bundling**: ship all application code in the initial load. Do not lazy-load scripts, use dynamic `import()`, or set up route/feature code-splitting. Runtime chunk fetches break offline use, and offline support is a goal for this client-only app. A larger initial bundle (for example, including the crypto/sync libraries even for logged-out users) is an accepted trade for an app that always works offline. Optimize bundle size by other means (drop unused deps, prefer smaller libraries) rather than deferring loads.

## Commands

```bash
pnpm dev         # Vite dev server — http://localhost:5173
pnpm build       # Production build (vite build → dist/)
pnpm start       # Serve the production build (vite preview)
pnpm test        # Run tests once (vitest run)
pnpm test:watch  # Run tests in watch mode
pnpm check       # Verify formatting + lint + typecheck (run before commits)
pnpm format      # Auto-fix formatting (prettier --write)
```

**Important**: Always run `pnpm run check` before commits to ensure code is properly formatted, linted, and type-safe. Do not run formatting, linting, or typechecking separately. `check` only *verifies* formatting (`prettier --check`); if it flags formatting issues, run `pnpm format` to auto-fix.

**Documentation**: When making major changes (architecture, new modules, API changes, file structure), update [docs/TRD.md](docs/TRD.md) to keep the technical reference accurate.

## Git Workflow

- **Always rebase when integrating to `main`, never create merge commits**: Bring a branch up to date with `git rebase main`, and land it with a fast-forward (`git merge --ff-only` or `git rebase`). Never run `git merge` in a way that produces a merge commit on `main` — keep history linear.

## Tech Stack

- **Vite 8** (Rolldown) + **React 19** + **TypeScript** (ESM) · **vite-plugin-pwa** (Workbox service worker precaches the build for offline cold-loads; installable PWA manifest + icons in `public/`)
- **Tailwind CSS v4** + **shadcn/ui** (Radix); shadcn primitives live in `src/components/ui/`
- **react-hook-form** + **zod** (event editor) · **date-fns** · **react-day-picker** (calendar) · **@dnd-kit/core** (drag events between days) · **remeda** (array/object utils) · **sonner** (toasts) · client-side **IndexedDB** via **idb**
- **Optional account sync**: **Supabase** (Postgres + Auth + Row Level Security) via `@supabase/supabase-js`; client-side crypto via **libsodium** (`libsodium-wrappers-sumo`: Argon2id + XChaCha20-Poly1305). Public config in `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY`
- Tests: **vitest** + **@testing-library/react**; storage tests run against **fake-indexeddb** (fresh in-memory DB per test)

## Gotchas

- **Cyberpunk styles are unlayered**: `.cy-*` classes in `src/globals.css` sit outside `@layer`, so they override Tailwind utilities. Keep them to visual props — never set `position` on `.cy-dialog` (it overrides shadcn's `fixed` centering and renders the dialog off-screen).
- **jsdom has no layout engine**: vitest can't catch CSS positioning/visibility bugs. Verify dialogs/layout in a real browser (chrome-devtools) and screenshot the render — the a11y tree reports off-screen elements as "present."
- **Storage tests use fake-indexeddb**: `resetDbForTests()` (`src/lib/storage/testing.ts`) swaps in a fresh in-memory `IDBFactory` per test — import it only from test files so fake-indexeddb stays out of the production bundle.

## Coding Standards

- **Never log sensitive data**: Do not log API keys, tokens, passwords, or other secrets. Use placeholder text like `[REDACTED]` if you need to indicate a value exists without revealing it
- **No accessibility (a11y) lint**: jsx-a11y is intentionally absent from the ESLint setup, and there is no need to add ARIA attributes, roles, or other markup purely for accessibility conventions — we expect AI-based accessibility tools to handle this app without them. Don't re-introduce jsx-a11y rules or flag missing aria tags in reviews
- **No em dashes or AI-isms in docs**: Write documentation in a plain, direct voice. Don't use em dashes; restructure the sentence or use commas, colons, or parentheses instead. Avoid telltale LLM phrasing: "delve", "seamless", "robust", "leverage", "elevate", "It's not just X, it's Y", adjective triads ("fast, simple, and powerful"), emoji headings, and "In summary" wrap-ups. Prefer concrete, specific statements
- **Package manager**: Use `pnpm` for all package management (install, add, remove, etc.)
- **ESM imports only**: Always use `import` syntax, never `require()`. This is an ESM project and `require` will throw `ReferenceError: require is not defined`
- **Arrow functions**: Use `const foo = () => { ... }` (enforced by ESLint, auto-fixable)
- **Reserve `use` prefix for React hooks**: The `useFoo` naming convention is reserved for React hooks. For boolean options or flags, use names like `systemFont`, `enableCache`, or `withValidation` instead of `useSystemFont`, `useCache`, or `useValidation`
- **Named imports**: Use `import { pipe, filter } from 'remeda'` not `import * as R` (tree-shaking)
- **Import paths — use the `@/` alias**: Import across modules with the `@/` alias (`@/lib/recurrence`, `@/utils/formatCurrency`), which maps to `src/` (see `tsconfig.json`). Reserve relative paths for files within the same module (`./types`, `./consts`); don't reach across modules with `../`.
- **React context over prop drilling**: For app-wide state that's needed across many components (e.g., events, categories, settings), use React context instead of passing props through multiple levels. See `src/context/CalendarContext` for an example, consumed via the `useCalendar()` hook. This keeps component interfaces clean and avoids threading props through intermediate components that don't use them.
- **Remeda utilities**: Prefer for array/object manipulation over manual loops where it improves readability without hurting performance (e.g., `flatMap` to flatten nested loops, `find` for searching, `sortBy` for sorting)
- **Named constants**: Use `const HEADER_SIZE = 16` not magic numbers
- **Numeric separators**: Use underscore separators for numbers 1000 and above for readability (`1_500`, `44_100`, `100_000`)
- **Local dates, not UTC**: derive "today" / all-day calendar dates with date-fns `format(new Date(), "yyyy-MM-dd")`. Never `new Date().toISOString()` for a calendar date (UTC → off-by-one in behind-UTC zones)
- **DRY (Don't Repeat Yourself)**: When a pattern appears 3+ times, extract it into a helper function. Place shared utilities in `src/utils/` (e.g., `src/utils/formatCurrency/index.ts`). This improves readability and maintainability without impacting performance
- **Module structure**: Always create modules as directories with `index.ts`, never as single `moduleName.ts` files. Name the directory after the primary export (class, function, or concept). This provides a consistent location for related files:

  ```
  # GOOD - directory structure allows for growth
  src/lib/
    storage/
      index.ts       # exports getAllEvents(), putEvent(), …
      tests.ts       # tests for the module
      types.ts       # storage-specific types + guards
    recurrence/
      index.ts       # exports expandEvent(), expandEvents(), …
      consts.ts      # RECURRENCE_LABELS, etc.
      types.ts       # CategoryResolver, etc.
      tests.ts

  # BAD - single files have nowhere for related code to go
  src/lib/
    storage.ts
    recurrence.ts
  ```

  Standard files within a module directory:

  - `index.ts` - Main module implementation, exports, and re-exports types/consts
  - `tests.ts` - Tests for the module (`tests.tsx` when the tests render JSX, as in components and contexts)
  - `consts.ts` - Module-specific constants
  - `types.ts` - Module-specific type definitions and their type guards (if needed)

- **Re-export types and consts from index.ts**: Each module's `index.ts` should re-export all types and consts from `types.ts` and `consts.ts`. External code should import from the module, not directly from internal files:

  ```typescript
  // GOOD - import from the module
  import { expandEvent, RECURRENCE_LABELS } from "@/lib/recurrence";

  // BAD - importing directly from internal module files
  import { expandEvent } from "@/lib/recurrence/index";
  import { RECURRENCE_LABELS } from "@/lib/recurrence/consts";
  ```

  In `recurrence/index.ts`:

  ```typescript
  export * from "./consts";
  export * from "./types";
  ```

- **Avoid barrel-only files**: Don't create `index.ts` files that only re-export from child modules. Import directly from the specific module instead (e.g., `import { formatCurrency } from '@/utils/formatCurrency'` not `from '@/utils'`).
- **JSDoc**: Skip `@param`/`@returns` tags (TypeScript provides types); use inline comments if needed
- **Loading indicators**: Delay by ~1 second to avoid flash for fast operations
- **Intl API**: Prefer `Intl.DateTimeFormat`, `Intl.NumberFormat`, etc. over manual formatting for dates, numbers, and currencies
- **Explicit conditionals for derived values**: When a value like `isWithdrawal` is derived from another value like `direction`, branch on the source value, not the derived one. This makes the logic clearer and avoids confusion:

  ```typescript
  // GOOD - branch on the source value
  if (event.direction === "deposit") {
    balance += event.amount;
  } else {
    balance -= event.amount; // "withdrawal"
  }

  // BAD - mixes the source value with a value derived from it
  const isWithdrawal = event.direction === "withdrawal";
  if (event.direction === "deposit") {
    balance += event.amount;
  } else if (isWithdrawal) {
    balance -= event.amount; // redundant — just use `direction`
  }
  ```

- **Type guards over type assertions**: Never use `as` type assertions on values with unknown runtime types. Use type guards from Remeda (`isString`, `isNumber`, `isBoolean`, `isPlainObject`) or create a new custom type guard if none exist:

  ```typescript
  // GOOD - type guard validates at runtime
  import { isString } from "remeda";

  if (isString(value)) {
    config.name = value;
  }

  // BAD - blind cast assumes type without validation
  config.name = value as string;
  ```

  For union types (e.g., `"cyan" | "magenta" | "yellow" | "green" | "orange"`), create a type guard that validates the actual values, not just the primitive type:

  ```typescript
  // GOOD - validates the value is one of the allowed options
  import { isCategoryColor } from "@/types";

  if (isCategoryColor(value)) {
    category.color = value; // No cast needed
  }

  // BAD - isString only checks primitive type, not valid union values
  if (isString(value)) {
    category.color = value as CategoryColor; // Still a blind cast!
  }
  ```

  When creating type guards for union types, use the named type in the return type annotation - don't hardcode the union:

  ```typescript
  // GOOD - uses the named type
  import type { CategoryColor } from "@/types";

  const CATEGORY_COLORS: readonly CategoryColor[] = [
    "cyan",
    "magenta",
    "yellow",
    "green",
    "orange",
  ];

  export const isCategoryColor = (value: unknown): value is CategoryColor => {
    return isString(value) && CATEGORY_COLORS.includes(value as CategoryColor);
  };

  // BAD - hardcodes the union type (duplicates the type definition)
  export const isCategoryColor = (
    value: unknown
  ): value is "cyan" | "magenta" | "yellow" | "green" | "orange" => {
    // ...
  };
  ```

- **Typed errors over string messages**: When throwing errors, create a custom error class with a typed `code` property instead of using plain `Error` with string messages. This enables type-safe error handling:

  ```typescript
  // GOOD - typed error with machine-readable code
  type MyErrorCode = "NOT_FOUND" | "PERMISSION_DENIED" | "TIMEOUT";

  class MyError extends Error {
    readonly code: MyErrorCode;
    constructor(code: MyErrorCode) {
      super(code);
      this.name = "MyError";
      this.code = code;
    }
  }

  const isMyError = (error: unknown): error is MyError => {
    return error instanceof MyError;
  };

  // Usage - callers get autocomplete and type checking
  try {
    await doSomething();
  } catch (error) {
    if (isMyError(error)) {
      switch (error.code) {
        case "NOT_FOUND": // TypeScript knows valid codes
        // ...
      }
    }
  }

  // BAD - string messages aren't type-safe
  throw new Error("Not found");
  throw new Error("Permission denied");
  ```

- **Tests verify behavior, not implementation**: Tests should verify that code works correctly, not enshrine implementation details. Never write tests that just check constant values - if a constant matters, test the behavior it affects:

  ```typescript
  // BAD - tests implementation detail, provides no value
  it("should have expected default interval", () => {
    expect(DEFAULT_INTERVAL).toBe(1);
  });

  // GOOD - tests actual behavior that depends on the constant
  it("stops generating occurrences after endsOn", () => {
    const occurrences = expandEvent(weeklyEvent, rangeStart, rangeEnd);
    expect(
      occurrences.every((o) => o.date <= weeklyEvent.recurrence.endsOn),
    ).toBe(true);
  });
  ```
