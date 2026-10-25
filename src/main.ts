import type { InventoryState } from './contract.ts';
import { startCountdown } from './countdown.ts';
import { createCheckoutForm } from './checkout-form.ts';
import { createReservation } from './reservation.ts';

const DEFAULT_HOLD_MS = 60_000;
const SKU = 'LUMEN-PRO-EARBUDS';

const timer = document.querySelector<HTMLParagraphElement>('#countdown');
const doneMessage = document.querySelector<HTMLParagraphElement>('#countdown-done');
const saleStart = document.querySelector<HTMLTimeElement>('time#sale-start');

if (timer === null || doneMessage === null || saleStart === null) {
  throw new Error('main: missing #countdown, #countdown-done or time#sale-start in index.html');
}

const stopCountdown = startCountdown(timer, saleStart, doneMessage);

window.addEventListener('pagehide', stopCountdown, { once: true });

const product = document.querySelector<HTMLElement>('#product');
const holdButton = document.querySelector<HTMLButtonElement>('#hold-btn');
const stockStatus = document.querySelector<HTMLParagraphElement>('#stock-status');

if (product === null || holdButton === null || stockStatus === null) {
  throw new Error('main: missing #product, #hold-btn or #stock-status in index.html');
}

// data-hold-ms is read from #product. A missing or non-positive-integer value falls back to 60000.
const parsedHoldMs = Number(product.dataset.holdMs);
const holdMs = Number.isInteger(parsedHoldMs) && parsedHoldMs > 0 ? parsedHoldMs : DEFAULT_HOLD_MS;

const renderStock = (state: InventoryState): void => {
  stockStatus.textContent = `Stock left: ${state.stock}. Status: ${state.status}.`;
};

const reservation = createReservation({ sku: SKU, holdMs, onChange: renderStock });

holdButton.addEventListener('click', () => {
  void reservation.hold();
});

const checkoutForm = document.querySelector<HTMLFormElement>('#checkout-form');

if (checkoutForm === null) {
  throw new Error('main: missing #checkout-form in index.html');
}

const checkout = createCheckoutForm(checkoutForm, {
  onSubmit: async () => {
    // Guard 2 checks the reservation's state, not only the form's data-state.
    if (!reservation.canConfirm()) {
      throw new Error('Your reservation is not confirmed yet.');
    }
    try {
      await reservation.confirm();
    } catch {
      // In the mock API, the only confirm failure is an expired hold.
      throw new Error('Your hold has expired. Reserve the item again.');
    }
  },
});

window.addEventListener('pagehide', () => {
  checkout.dispose();
  reservation.dispose();
}, { once: true });
