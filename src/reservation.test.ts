import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { InventoryState, MockReservation } from './contract.ts';
import { createReservation } from './reservation.ts';
import type { ReservationApi } from './reservation.ts';

type FrameCallback = (time: number) => void;

interface FakeFrames {
  // Runs only the callbacks queued before this call, like one animation frame.
  flush(): void;
  pendingCount(): number;
}

// Replaces requestAnimationFrame and cancelAnimationFrame for the duration of run(), then restores them.
async function withFakeFrames(run: (frames: FakeFrames) => Promise<void>): Promise<void> {
  const globals = globalThis as unknown as Record<string, unknown>;
  const originalRequest = globals.requestAnimationFrame;
  const originalCancel = globals.cancelAnimationFrame;
  const pending = new Map<number, FrameCallback>();
  let nextId = 1;

  globals.requestAnimationFrame = (callback: FrameCallback): number => {
    const id = nextId;
    nextId += 1;
    pending.set(id, callback);
    return id;
  };
  globals.cancelAnimationFrame = (id: number): void => {
    pending.delete(id);
  };

  try {
    await run({
      flush(): void {
        const batch = [...pending.values()];
        pending.clear();
        for (const callback of batch) {
          callback(0);
        }
      },
      pendingCount(): number {
        return pending.size;
      },
    });
  } finally {
    if (originalRequest === undefined) {
      delete globals.requestAnimationFrame;
    } else {
      globals.requestAnimationFrame = originalRequest;
    }
    if (originalCancel === undefined) {
      delete globals.cancelAnimationFrame;
    } else {
      globals.cancelAnimationFrame = originalCancel;
    }
  }
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

// A promise the test settles by hand, so each reply can arrive at a chosen moment.
function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface ReserveCall {
  sku: string;
  holdMs: number;
  reply: Deferred<MockReservation>;
}

interface ConfirmCall {
  holdId: string;
  reply: Deferred<void>;
}

interface FakeApi {
  api: ReservationApi;
  reserveCalls: ReserveCall[];
  confirmCalls: ConfirmCall[];
  releaseCalls: string[];
}

function fakeApi(): FakeApi {
  const reserveCalls: ReserveCall[] = [];
  const confirmCalls: ConfirmCall[] = [];
  const releaseCalls: string[] = [];

  const api: ReservationApi = {
    reserve(sku: string, holdMs: number): Promise<MockReservation> {
      const reply = deferred<MockReservation>();
      reserveCalls.push({ sku, holdMs, reply });
      return reply.promise;
    },
    async release(holdId: string): Promise<number> {
      releaseCalls.push(holdId);
      return 10;
    },
    confirm(holdId: string): Promise<void> {
      const reply = deferred<void>();
      confirmCalls.push({ holdId, reply });
      return reply.promise;
    },
  };

  return { api, reserveCalls, confirmCalls, releaseCalls };
}

// Lets promise callbacks queued so far run to completion.
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

test('a reply that arrives after the local hold expired releases the unit and leaves the status AVAILABLE', async () => {
  await withFakeFrames(async (frames) => {
    const { api, reserveCalls, releaseCalls } = fakeApi();
    const states: InventoryState[] = [];
    let now = 0;
    const reservation = createReservation({
      sku: 'SKU-1',
      holdMs: 1000,
      onChange: (state) => states.push(state),
      api,
      clock: () => now,
    });

    const pendingHold = reservation.hold();
    assert.equal(states.at(-1)?.status, 'HOLDING');

    now = 1000;
    frames.flush();
    assert.equal(states.at(-1)?.status, 'AVAILABLE');

    reserveCalls[0].reply.resolve({ holdId: 'hold-7', stock: 9 });
    await pendingHold;
    await settle();

    assert.equal(states.at(-1)?.status, 'AVAILABLE');
    assert.deepEqual(releaseCalls, ['hold-7']);
    assert.equal(reservation.canConfirm(), false);
    reservation.dispose();
  });
});

test('a SOLD_OUT rejection rolls back and then shows SOLD_OUT with stock 0', async () => {
  await withFakeFrames(async (frames) => {
    const { api, reserveCalls } = fakeApi();
    const states: InventoryState[] = [];
    const reservation = createReservation({
      sku: 'SKU-2',
      holdMs: 60_000,
      onChange: (state) => states.push(state),
      api,
      clock: () => 0,
    });

    const pendingHold = reservation.hold();
    reserveCalls[0].reply.reject(new Error('SOLD_OUT'));
    await pendingHold;
    await settle();

    assert.deepEqual(states.at(-1), { status: 'SOLD_OUT', stock: 0, holdExpiresAt: null });
    assert.equal(frames.pendingCount(), 0, 'the hold timer must be stopped');
    assert.equal(reservation.canConfirm(), false);
    reservation.dispose();
  });
});

test('canConfirm is false until the reserve reply arrives, then true', async () => {
  await withFakeFrames(async () => {
    const { api, reserveCalls } = fakeApi();
    const reservation = createReservation({
      sku: 'SKU-3',
      holdMs: 60_000,
      onChange: () => {},
      api,
      clock: () => 0,
    });

    const pendingHold = reservation.hold();
    assert.equal(reservation.canConfirm(), false);

    reserveCalls[0].reply.resolve({ holdId: 'hold-3', stock: 9 });
    await pendingHold;
    await settle();
    assert.equal(reservation.canConfirm(), true);
    reservation.dispose();
  });
});

test('confirm() without a holdId throws NO_CONFIRMED_HOLD and does not call api.confirm', async () => {
  await withFakeFrames(async () => {
    const { api, reserveCalls, confirmCalls } = fakeApi();
    const reservation = createReservation({
      sku: 'SKU-4',
      holdMs: 60_000,
      onChange: () => {},
      api,
      clock: () => 0,
    });

    // Nothing held yet.
    await assert.rejects(reservation.confirm(), /NO_CONFIRMED_HOLD/);

    // Held, but the reserve reply has not arrived, so there is still no holdId.
    const pendingHold = reservation.hold();
    await assert.rejects(reservation.confirm(), /NO_CONFIRMED_HOLD/);
    assert.equal(confirmCalls.length, 0);

    reserveCalls[0].reply.resolve({ holdId: 'hold-4', stock: 9 });
    await pendingHold;
    reservation.dispose();
  });
});

test('a failed confirm rolls the status back to AVAILABLE and rethrows the error', async () => {
  await withFakeFrames(async () => {
    const { api, reserveCalls, confirmCalls } = fakeApi();
    const states: InventoryState[] = [];
    const reservation = createReservation({
      sku: 'SKU-5',
      holdMs: 60_000,
      onChange: (state) => states.push(state),
      api,
      clock: () => 0,
    });

    const pendingHold = reservation.hold();
    reserveCalls[0].reply.resolve({ holdId: 'hold-5', stock: 9 });
    await pendingHold;
    await settle();

    const confirming = reservation.confirm();
    confirmCalls[0].reply.reject(new Error('HOLD_NOT_ACTIVE'));
    await assert.rejects(confirming, /HOLD_NOT_ACTIVE/);
    await settle();

    assert.equal(states.at(-1)?.status, 'AVAILABLE');
    assert.equal(reservation.canConfirm(), false);
    assert.deepEqual(confirmCalls.map((call) => call.holdId), ['hold-5']);
    reservation.dispose();
  });
});

test('a second hold() while HOLDING does not call api.reserve again', async () => {
  await withFakeFrames(async () => {
    const { api, reserveCalls } = fakeApi();
    const reservation = createReservation({
      sku: 'SKU-6',
      holdMs: 60_000,
      onChange: () => {},
      api,
      clock: () => 0,
    });

    const pendingHold = reservation.hold();
    await reservation.hold();
    assert.equal(reserveCalls.length, 1);

    reserveCalls[0].reply.resolve({ holdId: 'hold-6', stock: 9 });
    await pendingHold;
    await reservation.hold();
    assert.equal(reserveCalls.length, 1);
    reservation.dispose();
  });
});
