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

// Epoch ms source; the timer defaults to Date.now when none is given.
export interface Clock {
  (): number;
}

// Receives the remaining milliseconds on each tick, ending with 0.
export interface TickHandler {
  (remainingMs: number): void;
}
