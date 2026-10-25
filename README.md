# Flash-Sale Demo

A flash-sale demo with an anti-drift countdown, an optimistic inventory hold and a guarded checkout.

## How to run

```bash
npm install
npm run dev
npm run build
npm run preview
npm test
```

- `npm run dev` serves the page at http://localhost:5173.
- `npm run build` runs the TypeScript type check (`tsc`) and then bundles with Vite.
- `npm run preview` serves the built files at http://localhost:4173.
- `npm test` runs the test files with `node --test`.

The project uses Vite and TypeScript only. It has no runtime dependencies and no external CDN.

## Design

### Inventory state machine

`src/inventory-fsm.ts` contains the pure function `transition(state, event)`. It returns the next state, or `null` when the event is not valid in the current state. It never subtracts stock. Stock changes only through a `SYNC` event.

States: `AVAILABLE`, `HOLDING`, `PURCHASED`, `SOLD_OUT`.

Events: `HOLD`, `EXPIRE`, `REJECT`, `CONFIRM`, `SYNC`.

| Event | From | To | Condition and effect |
|---|---|---|---|
| `HOLD` | `AVAILABLE` | `HOLDING` | Stock is greater than 0. `holdExpiresAt = now + holdMs`. |
| `HOLD` | any other state, or stock 0 | (none) | Returns `null`. |
| `EXPIRE` | `HOLDING` | `AVAILABLE` | `now >= holdExpiresAt`. `holdExpiresAt` is cleared. |
| `EXPIRE` | any other state, or `now < holdExpiresAt` | (none) | Returns `null`. |
| `REJECT` | `HOLDING` | `AVAILABLE` | Rolls the hold back. `holdExpiresAt` is cleared. |
| `REJECT` | any other state | (none) | Returns `null`. |
| `CONFIRM` | `HOLDING` | `PURCHASED` | `holdExpiresAt` is cleared. |
| `CONFIRM` | any other state | (none) | Returns `null`. |
| `SYNC` | `HOLDING` | `HOLDING` | Stock is copied from the event. `holdExpiresAt` is kept. |
| `SYNC` | `PURCHASED` | `PURCHASED` | Stock is copied from the event. |
| `SYNC` | `AVAILABLE` | `AVAILABLE` | Stock is greater than 0. |
| `SYNC` | `AVAILABLE` | `SOLD_OUT` | Stock is 0. |
| `SYNC` | `AVAILABLE` | (none) | Stock is less than 0. Returns `null`. |
| `SYNC` | `SOLD_OUT` | `AVAILABLE` | Stock is greater than 0. |
| `SYNC` | `SOLD_OUT` | (none) | Stock is 0 or less. Returns `null`. |

A `SYNC` with stock 0 while `HOLDING` keeps the state as `HOLDING`. The hold is still active, and it ends only through `EXPIRE` or `REJECT`.

### Countdown

A `setInterval` countdown drifts. It fires late on each tick, and if the code subtracts 1 from a counter on every tick, those late ticks add up. Browsers can also delay or throttle timers, so the total error grows over time.

`createAntiDriftTimer` in `src/anti-drift-timer.ts` avoids this. It records a target time once, using `Date.now()` as the clock. On every animation frame it computes `remaining = max(0, target - Date.now())` again. A late frame does not add error, because each tick reads the clock again. The timer schedules its next frame with `requestAnimationFrame`, and it stops when `remaining` reaches 0.

Known limits of this approach:

- `Date.now()` follows the system clock. If the clock is changed, the remaining time jumps at once.
- `requestAnimationFrame` does not run in a background tab. A timer in a background tab does not tick until the tab is visible again.

### Optimistic reservation

`createReservation` in `src/reservation.ts` runs one hold at a time:

1. **Hold first.** `hold()` moves the state to `HOLDING` at once, and starts the hold timer with the hold duration. The server reply is applied when it arrives.
2. **Rollback on failure.** If the reserve request is rejected, the state goes back to `AVAILABLE` (`REJECT`). A `SOLD_OUT` rejection also sets the stock to 0 (`SYNC`).
3. **Late reply.** If a reply arrives after the hold was rejected, expired or disposed, the unit is released in the background.
4. **Expiry.** When the hold timer reaches 0, the state moves to `AVAILABLE` (`EXPIRE`), and the held unit is released.
5. **Confirm.** `confirm()` calls the API. On success the state becomes `PURCHASED`. On failure the state is rolled back (`REJECT`), and the error is thrown again.

Each hold attempt has a number. A reply or an expiry from an older attempt is ignored. A second `hold()` while `HOLDING` does nothing.

### Mock API

`src/mock-api.ts` is a module that runs in the browser. It keeps its stock and holds in memory. It is not a real server, and nothing is saved between page loads.

- Each request waits 800 ms before it answers.
- Stock starts at 10.
- An unconfirmed hold expires on the mock server after its hold duration. The expiry uses `setTimeout` in the browser, and the unit goes back to stock.
- `mockRelease` is idempotent. It returns a unit only for an active hold.
- `mockConfirm` rejects with `HOLD_NOT_ACTIVE` when the hold is unknown or no longer active.

### Checkout and double-submit guard

`src/checkout-form.ts` validates the form and handles submission. Two guards stop a second order:

- **Guard 1 (form state).** `handleSubmit` returns early while `data-state` is `submitting`. The submit button is also disabled during a request. A disabled button does not stop a script from calling `requestSubmit()`, so the check on `data-state` is the real guard. After a successful order, `data-state` is `success`, and the form refuses further submits until the page is reloaded.
- **Guard 2 (reservation state).** `src/main.ts` checks `reservation.canConfirm()` before it confirms the hold. If no hold is confirmed, the order is not sent.

Input is cleaned by `src/sanitize.ts`. `normalizeText` converts text to Unicode NFC, turns tabs into spaces, removes control characters (line breaks are kept), collapses runs of spaces and trims. `validatePhone` requires the whole value to be exactly 10 digits starting with `0`. The field lengths are checked in `validateCheckout`: name up to 60 characters and address up to 200 characters. The source does not use `innerHTML`, `outerHTML`, `insertAdjacentHTML` or `document.write`. Messages are written with `textContent`.

### Limits of this demo

- There is no real payment. No money is taken, and no order reaches a shop.
- The mock API is in memory. Reloading the page resets stock to 10.
- A confirm failure rolls the state back to `AVAILABLE`. The message then says that the hold expired, and the user must hold again. Pressing "Try again" after this does not confirm the item.
- A `SYNC` with stock 0 while `HOLDING` is kept in `HOLDING` (see the table above).
- The added guards for invalid `SYNC` stock values are not implemented. A `SYNC` in `HOLDING` or `PURCHASED` accepts any stock value, including negative numbers and non-integers. In `AVAILABLE` and `SOLD_OUT`, a non-integer value greater than 0 is also accepted.

## Tests

`npm test` runs `src/**/*.test.ts` with `node --test`. Node runs the TypeScript files directly.

The test files are excluded from `tsc` by `tsconfig.json`. `npm run build` therefore does not type-check them. The `node:test` and `node:assert` imports also need `@types/node`, and that package is not installed. The tests are not type-checked.

## Measurements

Measured by the author; not filled in this file.
