# TASK_DECOMPOSITION: HW3 High-Concurrency Flash-Sale Engine

Written for: the developer who implements H3-T01 to H3-T13 and H3-AUDIT one task at a time, and the reviewer who checks each commit.

Status of this document: H3-T01 only. No HTML, CSS or TypeScript exists for HW3 yet.

---

## 1. Overview

The app is a demo product page for a flash sale. The product is fictional ("Lumen Pro Wireless Earbuds") and the sale mimics the 11.11 (Single's Day) sale in Vietnam. It has three parts:

1. **Drift-free countdown.** A countdown to the sale start that is computed from `Date.now()` deltas, so it does not drift when the tab is busy.
2. **Optimistic hold.** The user reserves a unit for 60 seconds. The UI reacts at once, the server confirms in the background, and the hold expires or rolls back on failure.
3. **Checkout form.** A form with a double-submit guard and input validation and sanitization.

Stack: Vite, vanilla TypeScript in strict mode, no runtime dependencies, no CDN. Mobile-first at 375 px.

Constants used by the spec:

| Constant | Value | Source |
| --- | --- | --- |
| Sale start (UTC) | `2026-11-10T17:00:00Z` | 00:00 on 11/11/2026, Vietnam time (UTC+7) |
| Hold duration | `60000` ms | `data-hold-ms` on `#hold-btn` |
| Sample stock | `10` units | Choice made in this document; fictional sample data |
| Mock API latency | `400` ms | Choice made in this document; injected so tests can change it |

Time rules: store the sale start as ISO 8601 UTC in the `datetime` attribute. Convert it with `Date.parse` to epoch milliseconds before any math.

---

## 2. Ownership and data flow

- **The mock API owns stock.** `mockReserve`, `mockRelease` and `mockConfirm` change the stock in the mock server.
- **The FSM never subtracts stock.** `transition` only copies the stock value that arrives in a `SYNC` event.
- **Flow of a hold:**
  1. Click `#hold-btn`. The controller sends `HOLD` to the FSM at once (optimistic).
  2. The controller calls `api.reserve(sku, holdMs)`.
  3. On success, the controller sends `SYNC` with the server stock and keeps the `holdId`. It starts an expiry timer.
  4. On failure, the controller sends `REJECT`. The FSM goes back to `AVAILABLE`.
  5. When the timer reaches 0, the controller sends `EXPIRE` and calls `api.release(holdId)`.
- **Flow of a purchase:** the user submits the form. The controller calls `api.confirm(holdId)`. Only after the server accepts does the controller send `CONFIRM`, so the FSM moves to `PURCHASED`.

---

## 3. Contract (H3-T03, `src/contract.ts`)

These types are committed in H3-T03, before any logic that uses them.

```ts
export type InventoryStatus = 'AVAILABLE' | 'HOLDING' | 'PURCHASED' | 'SOLD_OUT';

export interface InventoryState {
  status: InventoryStatus;
  stock: number;
  holdExpiresAt: number | null; // epoch ms
}

export type InventoryEvent =
  | { type: 'HOLD'; now: number; holdMs: number }
  | { type: 'EXPIRE'; now: number }
  | { type: 'REJECT' }
  | { type: 'CONFIRM' }
  | { type: 'SYNC'; stock: number };

export interface MockReservation {
  holdId: string;
  stock: number;
}
```

Timer types are also in `src/contract.ts`:

```ts
export type Clock = () => number;               // defaults to Date.now
export type TickHandler = (remainingMs: number) => void;
```

Function signatures. Each function lives in the module named in the comment and must match this shape exactly.

```ts
// src/inventory-fsm.ts
export function transition(state: InventoryState, event: InventoryEvent): InventoryState | null;

// src/anti-drift-timer.ts
export function computeRemaining(targetMs: number, nowMs: number): number;
export function createAntiDriftTimer(durationMs: number, onTick: TickHandler, clock?: Clock): () => void;

// src/mock-api.ts
export function mockReserve(sku: string, holdMs: number): Promise<MockReservation>;
export function mockRelease(holdId: string): Promise<number>;
export function mockConfirm(holdId: string): Promise<void>;

// src/reservation.ts
export interface ReservationApi {
  reserve(sku: string, holdMs: number): Promise<MockReservation>;
  release(holdId: string): Promise<number>;
  confirm(holdId: string): Promise<void>;
}
```

Semantics:

- `computeRemaining(targetMs, nowMs)` returns `Math.max(0, targetMs - nowMs)`. It is never negative.
- `createAntiDriftTimer(durationMs, onTick, clock = Date.now)` records `start = clock()` when created. Each tick computes `remaining = max(0, durationMs - (clock() - start))` and calls `onTick(remaining)`. When `remaining` reaches 0, it makes the last call with `0` and stops by itself. The returned function stops the timer early and cancels any pending animation frame.
- `mockReserve` resolves after the mock latency. It rejects when the stock is 0 or when a test-only failure flag is set.
- `mockRelease` returns the stock after the release. Calling it again with an unknown or already released `holdId` is a no-op that returns the current stock.
- `mockConfirm` rejects when the `holdId` is unknown or its hold has expired.

---

## 4. Inventory transition table (H3-T07, `src/inventory-fsm.ts`)

Every pair not listed here returns `null`. A `null` result means the event is ignored and the state does not change.

| From | Event | Guard | To | Effect |
| --- | --- | --- | --- | --- |
| AVAILABLE | HOLD | `stock > 0` | HOLDING | `holdExpiresAt = now + holdMs` |
| HOLDING | EXPIRE | `now >= holdExpiresAt` | AVAILABLE | `holdExpiresAt = null` |
| HOLDING | REJECT | none | AVAILABLE | optimistic rollback; `holdExpiresAt = null` |
| HOLDING | CONFIRM | none | PURCHASED | stock unchanged; `holdExpiresAt = null` |
| HOLDING | SYNC | none | HOLDING | `stock = event.stock` |
| PURCHASED | SYNC | none | PURCHASED | `stock = event.stock` |
| AVAILABLE | SYNC | `event.stock > 0` | AVAILABLE | `stock = event.stock` |
| AVAILABLE | SYNC | `event.stock === 0` | SOLD_OUT | `stock = 0` |
| SOLD_OUT | SYNC | `event.stock > 0` | AVAILABLE | `stock = event.stock` |

Rules that follow from the table:

- Invariant: `holdExpiresAt` is non-null only when `status === 'HOLDING'`. Any transition out of HOLDING clears it.
- `transition` returns a new object and never mutates its input.
- `HOLD` from `HOLDING`, `PURCHASED` or `SOLD_OUT` returns `null`. This is the double-hold case.
- `EXPIRE` before `holdExpiresAt` returns `null`. This is the early-expiry case.
- `HOLD` when stock is 0 returns `null`. A reserve that comes back late, after the item is sold out, cannot revive a hold.

Added guards. These are not in the original brief. They are proposed here and listed in section 9 for the user to confirm:

- `SYNC` with a negative or non-integer `stock` returns `null`.
- `HOLD` with `holdMs <= 0` returns `null`.

Known gap in the table: `HOLDING + SYNC` with `stock === 0` stays `HOLDING`. The item only leaves HOLDING through `EXPIRE`, `REJECT` or `CONFIRM`.

---

## 5. Countdown and timer

- **H3-T06, `src/anti-drift-timer.ts`:** `computeRemaining` and `createAntiDriftTimer` as described in section 3. The timer schedules each next frame with `requestAnimationFrame`, computes the remaining time from the `Date.now()` delta, and stops when remaining is 0. It never uses `setInterval` and never decrements a counter.
- **H3-T06A, `src/countdown.ts`:** reads `time#sale-start`, parses its `datetime` with `Date.parse`, and throws a clear `Error` if the element is missing or the value is invalid. It writes the four `span[data-unit]` values (`days`, `hours`, `minutes`, `seconds`) with `textContent`, zero-padded. When the remaining time reaches 0, it sets the `role="timer"` text to a "sale is live" message. It stops the timer on `pagehide`.
- The hold expiry in H3-T09 reuses `createAntiDriftTimer(holdMs, ...)`. Its last tick sends `EXPIRE`.

---

## 6. HTML contract (H3-T04, `index.html`)

Required structure. Extra elements are not allowed unless this file is updated first.

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Lumen Pro Flash Sale</title>
    <link rel="stylesheet" href="/src/css/reset.css">
    <link rel="stylesheet" href="/src/css/tokens.css">
    <link rel="stylesheet" href="/src/css/layout.css">
    <link rel="stylesheet" href="/src/css/form.css">
    <script type="module" src="/src/main.ts"></script>
  </head>
  <body>
    <a href="#product">Skip to product</a>
    <header>
      <h1>Lumen Pro Wireless Earbuds: 11.11 Flash Sale</h1>
    </header>
    <main>
      <section id="countdown-section" aria-labelledby="countdown-title">
        <h2 id="countdown-title">Sale starts in</h2>
        <p role="timer" id="countdown">
          <span data-unit="days">00</span><span>days</span>
          <span data-unit="hours">00</span><span>hours</span>
          <span data-unit="minutes">00</span><span>minutes</span>
          <span data-unit="seconds">00</span><span>seconds</span>
        </p>
        <p>Starts <time id="sale-start" datetime="2026-11-10T17:00:00Z">00:00, 11/11/2026 (UTC+7)</time></p>
      </section>

      <section id="stock" aria-labelledby="stock-title">
        <h2 id="stock-title">Stock</h2>
        <p role="status" id="stock-status"></p>
      </section>

      <section id="product" aria-labelledby="product-title">
        <h2 id="product-title">Lumen Pro Wireless Earbuds</h2>
        <button type="button" id="hold-btn" data-hold-ms="60000">Reserve for 60 seconds</button>
      </section>

      <section id="checkout" aria-labelledby="checkout-title">
        <h2 id="checkout-title">Checkout</h2>
        <form id="checkout-form" data-state="idle" novalidate>
          <label for="name">Full name</label>
          <input id="name" name="name" type="text" autocomplete="name" aria-describedby="name-hint name-error">
          <p id="name-hint">As shown on your ID.</p>
          <p id="name-error" hidden></p>

          <label for="phone">Phone number</label>
          <input id="phone" name="phone" type="tel" autocomplete="tel" aria-describedby="phone-hint phone-error">
          <p id="phone-hint">Vietnamese mobile number, for example 0912 345 678.</p>
          <p id="phone-error" hidden></p>

          <label for="address">Delivery address</label>
          <textarea id="address" name="address" rows="3" autocomplete="street-address" aria-describedby="address-hint address-error"></textarea>
          <p id="address-hint">House number, street, district, city.</p>
          <p id="address-error" hidden></p>

          <button type="submit" id="submit-btn">Place order</button>
          <button type="button" id="retry-btn" hidden>Try again</button>
          <p id="form-status" role="status"></p>
        </form>
      </section>
    </main>
  </body>
</html>
```

Decisions in this contract:

- The brief puts `data-hold-ms="60000"` in the sentence about `section#product`. This document places it on `#hold-btn`, because the controller reads the hold duration from the button. Confirm this choice (section 9).
- `data-state` on the form takes one of `idle`, `submitting`, `success`, `error`.
- The form field elements are direct children of the form. No wrapper `div` is used.
- Placeholders are never used as labels.
- The hold countdown is not in this contract. The brief does not specify where it is shown. Section 9 asks the user to decide.

---

## 7. CSS (H3-T05, `src/css/`)

- `reset.css`: global reset with `box-sizing: border-box`.
- `tokens.css`: every color, spacing, radius and font size is a custom property in `:root`. This is the only file that may contain hex or rgb values.
- `layout.css`: mobile-first base for 375 px. Flexbox for one-dimensional layout, Grid for two-dimensional layout, `gap` instead of margins.
- `form.css`: styles keyed on `form[data-state]` and on the error elements. It must honor the `hidden` attribute.
- Check every rule in section 3 of `project-rules.md`: `:focus-visible`, contrast of at least 4.5:1 for text and 3:1 for UI, targets of at least 24 by 24 px, `prefers-reduced-motion`, and no horizontal scroll at 375 px.

---

## 8. Work breakdown structure (WBS)

Each task is one prompt, one atomic commit, one concern. Commit messages are exact. Stage only the files listed for the task, by explicit path.

### H3-T01: write this document

- **Files:** `TASK_DECOMPOSITION.md`. Commit also adds `Agent.md` and `project-rules.md` unchanged. They are untracked today and the user named them in the commit command.
- **Depends on:** none.
- **Acceptance:** all sections of the brief are present. No HTML, CSS or TypeScript is written. `git show --stat HEAD` lists exactly the three files.
- **Commit:** `docs(spec): define timer, inventory FSM and API contracts`

### H3-T02: scaffold with stub modules

- **Files:**
  - Remove the Vite demo: `src/counter.ts`, `src/style.css`, `src/assets/` (unused template assets).
  - Replace `src/main.ts` with a stub that contains `export {};`.
  - Create stubs (each `export {};`): `src/anti-drift-timer.ts`, `src/inventory-fsm.ts`, `src/mock-api.ts`, `src/reservation.ts`, `src/countdown.ts`, `src/checkout-form.ts`.
  - Create empty CSS stubs: `src/css/reset.css`, `src/css/tokens.css`, `src/css/layout.css`, `src/css/form.css`.
  - Add `"test": "node --test \"src/**/*.test.ts\""` to `package.json` scripts.
- **Depends on:** H3-T01.
- **Acceptance:**
  - `npm run build` passes.
  - `npm test` runs and exits 0 with no test files. Record the output in the session.
  - `tsconfig.json` still has `verbatimModuleSyntax`, `allowImportingTsExtensions` and `erasableSyntaxOnly`.
  - No new runtime dependency is added.
- **Commit:** `chore(scaffold): replace Vite demo with stub modules`
- **Open issue:** the template files are untracked (see section 9, item 1).

### H3-T03: contract

- **Files:** `src/contract.ts`.
- **Depends on:** H3-T02.
- **Acceptance:**
  - Contains exactly the types in section 3, including `Clock` and `TickHandler`.
  - No logic and no runtime code.
  - `npm run build` passes.
- **Commit:** `feat(types): add inventory and timer contract`

### H3-T04: HTML structure

- **Files:** `index.html`.
- **Depends on:** H3-T03.
- **Acceptance:**
  - Matches section 6 exactly.
  - `<html lang="en">`, charset and viewport meta tags are present.
  - Exactly one `h1`. No heading level is skipped.
  - No `div`, no `style=""`, no inline script or style, no inline event handler, no `b` or `i`.
  - Every control has a visible `label for`. Hint and error are linked with `aria-describedby`.
  - `npm run build` passes.
- **Commit:** `feat(html): product page and checkout form structure`

### H3-T05: CSS

- **Files:** `src/css/reset.css`, `src/css/tokens.css`, `src/css/layout.css`, `src/css/form.css`.
- **Depends on:** H3-T04.
- **Acceptance:**
  - Zero hex or rgb values outside `tokens.css`.
  - Mobile-first. Layout checked at 375 px in DevTools.
  - `:focus-visible`, contrast, target size and `prefers-reduced-motion` rules from section 7 are in place.
  - Contrast ratios are measured with a tool and reported. Otherwise they are marked "not verified".
  - `npm run build` passes.
- **Commit:** `feat(css): tokens, reset, layout and form state styles`

### H3-T06: anti-drift timer

- **Files:** `src/anti-drift-timer.ts`, `src/anti-drift-timer.test.ts`.
- **Depends on:** H3-T03.
- **Acceptance:**
  - `computeRemaining` clamps at 0.
  - `createAntiDriftTimer` computes from the clock delta, calls `onTick` with the remaining time, makes a final call with `0`, and stops itself.
  - The returned stop function cancels the pending animation frame.
  - No `setInterval`. No decrementing counter.
  - Tests use an injected fake clock and irregular steps to show no drift.
  - `npm test` and `npm run build` pass. Test output is recorded in the session.
- **Commit:** `feat(ts): anti-drift countdown from Date.now() delta`

### H3-T06A: countdown rendering

- **Files:** `src/countdown.ts`, `src/main.ts`.
- **Depends on:** H3-T06.
- **Acceptance:**
  - Reads `datetime` from `time#sale-start` and converts it with `Date.parse`.
  - Throws a clear `Error` when the element or the value is missing or invalid.
  - Writes the four `span[data-unit]` values with `textContent`, zero-padded.
  - Sets the timer text to a "sale is live" message at 0.
  - Stops the timer on `pagehide`.
  - No `innerHTML`.
  - `npm run build` passes.
- **Commit:** `feat(ts): countdown rendered from sale-start with Date.now() delta`

### H3-T07: pure inventory state machine

- **Files:** `src/inventory-fsm.ts`.
- **Depends on:** H3-T03.
- **Acceptance:**
  - `transition` implements the table in section 4, including the added guards if the user accepts them.
  - Returns `null` for every pair not in the table.
  - Never mutates its input and never subtracts stock.
  - No DOM access.
  - `npm run build` passes. Tests come in H3-T12.
- **Commit:** `feat(ts): pure inventory state machine`

### H3-T08: mock API

- **Files:** `src/mock-api.ts`.
- **Depends on:** H3-T03.
- **Acceptance:**
  - In-memory stock, initial value 10, held in the module.
  - Each reserve creates a hold with a server-side expiry. Expired holds return their stock lazily on the next call.
  - Latency is configurable and defaults to 400 ms.
  - `mockReserve` rejects when stock is 0 or when the test-only failure flag is set.
  - `mockRelease` is idempotent for unknown or already released holds.
  - `mockConfirm` rejects for unknown or expired holds.
  - `npm run build` passes.
- **Commit:** `feat(ts): mock API with latency and rejection`

### H3-T09: optimistic reservation

- **Files:** `src/reservation.ts`.
- **Depends on:** H3-T07, H3-T08, H3-T06.
- **Acceptance:**
  - Exports the `ReservationApi` interface from section 3.
  - Hold: sends `HOLD` at once, calls `api.reserve`, sends `SYNC` on success, or `REJECT` on failure.
  - Expiry: a timer built with `createAntiDriftTimer(holdMs)` sends `EXPIRE` on its last tick and calls `api.release`.
  - Late reserve: if a reserve resolves after the hold was rejected or expired, the controller calls `api.release` for that `holdId` at once, so no stock is lost.
  - Confirm: calls `api.confirm`. Sends `CONFIRM` only after the server accepts. On failure the state stays `HOLDING`.
  - Exposes `dispose()` that stops the timer.
  - `npm run build` passes.
- **Commit:** `feat(ts): optimistic reservation with expiry and rollback`

### H3-T10: checkout validation and sanitization

- **Files:** `src/sanitize.ts`, `src/checkout-form.ts`.
- **Depends on:** H3-T02.
- **Acceptance:**
  - `validateCheckout(input: unknown)` narrows the input and returns either `{ ok: true, value }` or `{ ok: false, errors }`.
  - Sanitization: trim, collapse whitespace, remove control characters.
  - Name: 2 to 80 characters, Unicode letters, spaces, apostrophes and hyphens.
  - Phone: Vietnamese mobile format after removing spaces and dashes, with a `0` or `+84` prefix.
  - Address: 10 to 200 characters.
  - No DOM access.
  - Tests cover valid and invalid values for each field.
  - `npm test` and `npm run build` pass.
- **Commit:** `feat(ts): checkout validation and input sanitization`

### H3-T11: double-submit guard and wiring

- **Files:** `src/checkout-form.ts`, `src/main.ts`.
- **Depends on:** H3-T06A, H3-T09, H3-T10.
- **Acceptance:**
  - `submit-guard.ts` is pure: `tryStart()` returns `false` while a request is in flight, and `finish()` clears the flag.
  - The form sets `data-state` through `submitting`, `success` and `error`. The submit button is disabled while a request is in flight.
  - Retry reuses the same `holdId`.
  - One listener per container and event type. Event delegation only.
  - Listeners are removed on `pagehide`.
  - No `innerHTML`.
  - `npm run build` passes.
- **Commit:** `feat(ts): double-submit guard and wiring`

### H3-T12: inventory tests

- **Files:** `src/inventory-fsm.test.ts`.
- **Depends on:** H3-T07.
- **Acceptance:**
  - Double hold: `HOLD` from `HOLDING` returns `null`.
  - Early expiry: `EXPIRE` with `now < holdExpiresAt` returns `null`. At `now === holdExpiresAt` it returns `AVAILABLE`.
  - Late reserve: `HOLD` when stock is 0 returns `null`, and `SYNC` from `SOLD_OUT` with stock 0 returns `null`.
  - Stock is never changed by `HOLD`, `REJECT` or `CONFIRM`.
  - `npm test` passes. Output is recorded in the session.
- **Commit:** `test(inventory): cover double hold, early expiry and late reserve`

### H3-AUDIT: AI failure report

- **Files:** `AI_FAILURE_AUDIT.md` only.
- **Depends on:** H3-T12.
- **Acceptance:**
  - Each defect uses the slide 29 template: AI Prompt, AI Generated Code, Risk, Detection Method, Engineering Refactor.
  - Only defects that really happened in this repo are recorded: from its git history, or from the user's own observation.
  - If fewer than 3 real defects exist, stop and report what testing is missing. Do not invent defects.
- **Commit:** `docs(audit): AI failure mode report`
- **Note:** the repo has no commits yet, so the source of real defects must be checks that failed in this project, or what the user observed.

### H3-T13: README

- **Files:** `README.md`.
- **Depends on:** H3-AUDIT.
- **Acceptance:**
  - Describes the design, the three parts, how to run `npm run dev`, `npm run build`, `npm run preview` and `npm test`.
  - Lists what was verified and what was not verified. Lighthouse, FPS and timer drift are marked for the user to run.
- **Commit:** `docs(readme): document flash-sale design and checks`

---

## 9. Open decisions for the user

1. **Template files are untracked.** `index.html`, `package.json`, `tsconfig.json`, `src/`, `public/`, `.gitignore` and the lock file are not in any commit. The rule "stage only the files named" means H3-T02 cannot commit `package.json` or `tsconfig.json` without a decision. Options: (a) a separate `chore(scaffold)` baseline commit before H3-T02, or (b) name these files in H3-T02. Choose one before H3-T02.
2. **`data-hold-ms` location.** This document puts it on `#hold-btn`. The brief could also mean `section#product`.
3. **Added guards** in section 4: `SYNC` with negative or non-integer stock, and `HOLD` with `holdMs <= 0`, return `null`.
4. **Hold countdown.** The contract has no element for the remaining hold time. Proposal: an extra `span` inside `#product`, outside `role="status"`, so the status is not announced every second.
5. **Sample values.** Stock 10 and latency 400 ms are my choices.
6. **Commit message case.** The rule says summaries are lowercase, but `docs(audit): AI failure mode report` has uppercase `AI`. This document keeps the message exactly as given, because the rule says to use the task's message exactly.
7. **Node version.** This machine has Node v24.14.1, which runs `.ts` files without a flag. `npm test` has not been run yet, so this is not yet verified.

---

## 10. Quality gates for every task

- Run `npm run build` from H3-T02 onward. Run `npm test` from H3-T06 onward. Report the output.
- Run `git show --stat HEAD` after each commit. It must list only the files named in the task.
- If a check fails, do not commit. Report the failure with its output.
- Never run `git add .`, `git add -A`, `git commit -a`, `git push`, `git commit --amend` or any rebase or reset.
- Never commit `node_modules/` or `dist/`.
- Report only results produced in the session. Lighthouse scores, FPS, timer drift and memory counts are marked "not verified" until the user runs them.
- Commits follow the order of the WBS. Each contract is committed before the logic that uses it.
