import type { MockReservation } from './contract.ts';

// The mock API is the only source of truth for stock. Callers never change stock directly.
type HoldStatus = 'active' | 'confirmed' | 'released';

interface HoldRecord {
  status: HoldStatus;
  timer: ReturnType<typeof setTimeout>;
}

const LATENCY_MS = 800;

let mockStock = 10;
let nextId = 1;
const holds = new Map<string, HoldRecord>();

// Server-side expiry: an unconfirmed hold returns its unit to stock.
function expireHold(holdId: string): void {
  const hold = holds.get(holdId);
  if (hold === undefined || hold.status !== 'active') {
    return;
  }
  hold.status = 'released';
  mockStock += 1;
}

export function mockReserve(sku: string, holdMs: number): Promise<MockReservation> {
  return new Promise<MockReservation>((resolve, reject) => {
    setTimeout(() => {
      if (sku.trim().length === 0) {
        reject(new Error('INVALID_SKU'));
        return;
      }
      if (mockStock === 0) {
        reject(new Error('SOLD_OUT'));
        return;
      }

      mockStock -= 1;
      const holdId = `hold-${nextId}`;
      nextId += 1;
      const timer = setTimeout(() => {
        expireHold(holdId);
      }, holdMs);
      holds.set(holdId, { status: 'active', timer });
      resolve({ holdId, stock: mockStock });
    }, LATENCY_MS);
  });
}

export function mockRelease(holdId: string): Promise<number> {
  return new Promise<number>((resolve) => {
    setTimeout(() => {
      const hold = holds.get(holdId);
      // Idempotent: only an active hold returns its unit to stock.
      if (hold !== undefined && hold.status === 'active') {
        clearTimeout(hold.timer);
        hold.status = 'released';
        mockStock += 1;
      }
      resolve(mockStock);
    }, LATENCY_MS);
  });
}

export function mockConfirm(holdId: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    setTimeout(() => {
      const hold = holds.get(holdId);
      if (hold === undefined || hold.status !== 'active') {
        reject(new Error('HOLD_NOT_ACTIVE'));
        return;
      }
      clearTimeout(hold.timer);
      hold.status = 'confirmed';
      resolve();
    }, LATENCY_MS);
  });
}
