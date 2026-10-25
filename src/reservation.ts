import type { Clock, InventoryEvent, InventoryState, MockReservation } from './contract.ts';
import { createAntiDriftTimer } from './anti-drift-timer.ts';
import { transition } from './inventory-fsm.ts';
import { mockConfirm, mockRelease, mockReserve } from './mock-api.ts';

export interface ReservationApi {
  reserve(sku: string, holdMs: number): Promise<MockReservation>;
  release(holdId: string): Promise<number>;
  confirm(holdId: string): Promise<void>;
}

export interface ReservationOptions {
  sku: string;
  holdMs: number;
  onChange: (state: InventoryState) => void;
  api?: ReservationApi;
  clock?: Clock;
}

export interface Reservation {
  hold(): Promise<void>;
  confirm(): Promise<void>;
  canConfirm(): boolean;
  dispose(): void;
}

const DEMO_STOCK = 10;

const defaultApi: ReservationApi = {
  reserve: mockReserve,
  release: mockRelease,
  confirm: mockConfirm,
};

function isSoldOut(error: unknown): boolean {
  return error instanceof Error && error.message === 'SOLD_OUT';
}

// Optimistic hold: the UI moves to HOLDING at once, and the server reply is applied when it arrives.
export function createReservation(options: ReservationOptions): Reservation {
  const { sku, holdMs, onChange } = options;
  const api = options.api ?? defaultApi;
  const clock = options.clock ?? Date.now;

  let state: InventoryState = { status: 'AVAILABLE', stock: DEMO_STOCK, holdExpiresAt: null };
  let confirmedHoldId: string | null = null;
  // Counts hold attempts. A reply or expiry from an older attempt is ignored.
  let attempt = 0;
  let stopTimer: (() => void) | null = null;

  const dispatch = (event: InventoryEvent): void => {
    const next = transition(state, event);
    if (next === null) {
      return;
    }
    state = next;
    onChange(state);
  };

  const stopHoldTimer = (): void => {
    if (stopTimer !== null) {
      stopTimer();
      stopTimer = null;
    }
  };

  const releaseInBackground = (holdId: string): void => {
    api.release(holdId).then(
      (stock) => {
        dispatch({ type: 'SYNC', stock });
      },
      () => {
        // Ignored: the server expires unconfirmed holds on its own.
      },
    );
  };

  const releaseConfirmedHold = (): void => {
    if (confirmedHoldId === null) {
      return;
    }
    const holdId = confirmedHoldId;
    confirmedHoldId = null;
    releaseInBackground(holdId);
  };

  const expire = (current: number): void => {
    if (current !== attempt || state.status !== 'HOLDING') {
      return;
    }
    dispatch({ type: 'EXPIRE', now: clock() });
    releaseConfirmedHold();
  };

  const hold = async (): Promise<void> => {
    const next = transition(state, { type: 'HOLD', now: clock(), holdMs });
    if (next === null) {
      return;
    }

    attempt += 1;
    const current = attempt;
    state = next;
    onChange(state);
    stopTimer = createAntiDriftTimer(holdMs, (remaining) => {
      if (remaining === 0) {
        expire(current);
      }
    }, clock);

    let reservation: MockReservation;
    try {
      reservation = await api.reserve(sku, holdMs);
    } catch (error: unknown) {
      if (current === attempt && state.status === 'HOLDING') {
        stopHoldTimer();
        dispatch({ type: 'REJECT' });
      }
      if (isSoldOut(error)) {
        dispatch({ type: 'SYNC', stock: 0 });
      }
      return;
    }

    // Late reply: this attempt was rejected, expired or disposed. Give the unit back.
    if (current !== attempt || state.status !== 'HOLDING') {
      releaseInBackground(reservation.holdId);
      return;
    }

    confirmedHoldId = reservation.holdId;
    dispatch({ type: 'SYNC', stock: reservation.stock });
  };

  const confirm = async (): Promise<void> => {
    if (state.status !== 'HOLDING' || confirmedHoldId === null) {
      throw new Error('NO_CONFIRMED_HOLD');
    }

    const holdId = confirmedHoldId;
    // Closes the expiry callback of this hold while the confirmation is in flight.
    attempt += 1;
    try {
      await api.confirm(holdId);
    } catch (error: unknown) {
      stopHoldTimer();
      confirmedHoldId = null;
      dispatch({ type: 'REJECT' });
      throw error;
    }

    stopHoldTimer();
    confirmedHoldId = null;
    dispatch({ type: 'CONFIRM' });
  };

  const canConfirm = (): boolean => state.status === 'HOLDING' && confirmedHoldId !== null;

  const dispose = (): void => {
    stopHoldTimer();
    attempt += 1;
    releaseConfirmedHold();
  };

  onChange(state);

  return { hold, confirm, canConfirm, dispose };
}
