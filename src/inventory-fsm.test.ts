import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { InventoryState, InventoryStatus } from './contract.ts';
import { transition } from './inventory-fsm.ts';

function makeState(status: InventoryStatus, stock: number, holdExpiresAt: number | null = null): InventoryState {
  return { status, stock, holdExpiresAt };
}

// Narrows a transition result for tests that expect a valid transition.
function must(state: InventoryState | null): InventoryState {
  if (state === null) {
    throw new Error('expected a valid transition, got null');
  }
  return state;
}

const HOLD_MS = 60_000;

test('AVAILABLE + HOLD with stock > 0 moves to HOLDING and sets holdExpiresAt = now + holdMs', () => {
  const next = transition(makeState('AVAILABLE', 5), { type: 'HOLD', now: 1000, holdMs: HOLD_MS });
  assert.deepEqual(next, makeState('HOLDING', 5, 61_000));
});

test('HOLDING + EXPIRE at holdExpiresAt moves to AVAILABLE and clears holdExpiresAt', () => {
  const next = transition(makeState('HOLDING', 4, 61_000), { type: 'EXPIRE', now: 61_000 });
  assert.deepEqual(next, makeState('AVAILABLE', 4, null));
});

test('HOLDING + REJECT rolls back to AVAILABLE with stock unchanged', () => {
  const next = transition(makeState('HOLDING', 4, 61_000), { type: 'REJECT' });
  assert.deepEqual(next, makeState('AVAILABLE', 4, null));
});

test('HOLDING + CONFIRM moves to PURCHASED, keeps stock, and clears holdExpiresAt', () => {
  const next = transition(makeState('HOLDING', 4, 61_000), { type: 'CONFIRM' });
  assert.deepEqual(next, makeState('PURCHASED', 4, null));
});

test('HOLDING + SYNC keeps HOLDING, takes the synced stock, and keeps holdExpiresAt', () => {
  const next = transition(makeState('HOLDING', 4, 61_000), { type: 'SYNC', stock: 3 });
  assert.deepEqual(next, makeState('HOLDING', 3, 61_000));
});

test('PURCHASED + SYNC keeps PURCHASED and takes the synced stock', () => {
  const next = transition(makeState('PURCHASED', 4), { type: 'SYNC', stock: 2 });
  assert.deepEqual(next, makeState('PURCHASED', 2, null));
});

test('AVAILABLE + SYNC with stock > 0 keeps AVAILABLE and takes the synced stock', () => {
  const next = transition(makeState('AVAILABLE', 1), { type: 'SYNC', stock: 4 });
  assert.deepEqual(next, makeState('AVAILABLE', 4, null));
});

test('AVAILABLE + SYNC with stock 0 moves to SOLD_OUT', () => {
  const next = transition(makeState('AVAILABLE', 1), { type: 'SYNC', stock: 0 });
  assert.deepEqual(next, makeState('SOLD_OUT', 0, null));
});

test('SOLD_OUT + SYNC with stock > 0 moves to AVAILABLE', () => {
  const next = transition(makeState('SOLD_OUT', 0), { type: 'SYNC', stock: 3 });
  assert.deepEqual(next, makeState('AVAILABLE', 3, null));
});

test('HOLD with stock 0 is rejected (returns null)', () => {
  assert.equal(transition(makeState('AVAILABLE', 0), { type: 'HOLD', now: 0, holdMs: HOLD_MS }), null);
});

test('double hold: HOLD while HOLDING is rejected (returns null)', () => {
  assert.equal(transition(makeState('HOLDING', 4, 61_000), { type: 'HOLD', now: 5000, holdMs: HOLD_MS }), null);
});

test('early expiry: EXPIRE before holdExpiresAt is rejected (returns null)', () => {
  assert.equal(transition(makeState('HOLDING', 4, 61_000), { type: 'EXPIRE', now: 60_999 }), null);
});

test('CONFIRM while AVAILABLE is rejected (returns null)', () => {
  assert.equal(transition(makeState('AVAILABLE', 4), { type: 'CONFIRM' }), null);
});

test('REJECT while PURCHASED is rejected (returns null)', () => {
  assert.equal(transition(makeState('PURCHASED', 4), { type: 'REJECT' }), null);
});

test('SOLD_OUT + SYNC with stock 0 is rejected (returns null)', () => {
  assert.equal(transition(makeState('SOLD_OUT', 0), { type: 'SYNC', stock: 0 }), null);
});

test('transition never mutates the input state', () => {
  const before = makeState('AVAILABLE', 5);
  const snapshot = { ...before };
  const next = transition(before, { type: 'HOLD', now: 0, holdMs: HOLD_MS });
  assert.deepEqual(before, snapshot);
  assert.notEqual(next, before);
});

test('race: a second HOLD sent right after the first one is rejected (returns null)', () => {
  const first = must(transition(makeState('AVAILABLE', 5), { type: 'HOLD', now: 1000, holdMs: HOLD_MS }));
  assert.equal(transition(first, { type: 'HOLD', now: 1001, holdMs: HOLD_MS }), null);
});

test('race: EXPIRE sent before the hold window ends is rejected, so the hold is not expired early', () => {
  const held = must(transition(makeState('AVAILABLE', 5), { type: 'HOLD', now: 1000, holdMs: HOLD_MS }));
  assert.equal(transition(held, { type: 'EXPIRE', now: 30_000 }), null);
});

test('race: REJECT arriving after CONFIRM is rejected (returns null), so a purchase is not rolled back', () => {
  const held = must(transition(makeState('AVAILABLE', 5), { type: 'HOLD', now: 1000, holdMs: HOLD_MS }));
  const purchased = must(transition(held, { type: 'CONFIRM' }));
  assert.equal(purchased.status, 'PURCHASED');
  assert.equal(transition(purchased, { type: 'REJECT' }), null);
});

test('race: HOLD, REJECT, HOLD recomputes holdExpiresAt from the new now', () => {
  const first = must(transition(makeState('AVAILABLE', 5), { type: 'HOLD', now: 1000, holdMs: HOLD_MS }));
  const rejected = must(transition(first, { type: 'REJECT' }));
  const second = transition(rejected, { type: 'HOLD', now: 9000, holdMs: HOLD_MS });
  assert.deepEqual(second, makeState('HOLDING', 5, 9000 + HOLD_MS));
});
