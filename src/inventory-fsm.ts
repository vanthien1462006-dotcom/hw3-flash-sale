import type { InventoryState, InventoryEvent } from './contract.ts';

// Pure transition table. Returns a new state, or null when the event is not valid in this state.
// Stock is only ever copied from a SYNC event. This function never subtracts stock.
export function transition(state: InventoryState, event: InventoryEvent): InventoryState | null {
  switch (event.type) {
    case 'HOLD':
      if (state.status !== 'AVAILABLE' || state.stock <= 0) {
        return null;
      }
      return { status: 'HOLDING', stock: state.stock, holdExpiresAt: event.now + event.holdMs };

    case 'EXPIRE':
      if (state.status !== 'HOLDING' || state.holdExpiresAt === null || event.now < state.holdExpiresAt) {
        return null;
      }
      return { status: 'AVAILABLE', stock: state.stock, holdExpiresAt: null };

    case 'REJECT':
      if (state.status !== 'HOLDING') {
        return null;
      }
      return { status: 'AVAILABLE', stock: state.stock, holdExpiresAt: null };

    case 'CONFIRM':
      if (state.status !== 'HOLDING') {
        return null;
      }
      return { status: 'PURCHASED', stock: state.stock, holdExpiresAt: null };

    case 'SYNC':
      return transitionOnSync(state, event.stock);
  }
}

function transitionOnSync(state: InventoryState, stock: number): InventoryState | null {
  switch (state.status) {
    case 'HOLDING':
      return { status: 'HOLDING', stock, holdExpiresAt: state.holdExpiresAt };

    case 'PURCHASED':
      return { status: 'PURCHASED', stock, holdExpiresAt: null };

    case 'AVAILABLE':
      if (stock > 0) {
        return { status: 'AVAILABLE', stock, holdExpiresAt: null };
      }
      if (stock === 0) {
        return { status: 'SOLD_OUT', stock: 0, holdExpiresAt: null };
      }
      return null;

    case 'SOLD_OUT':
      if (stock > 0) {
        return { status: 'AVAILABLE', stock, holdExpiresAt: null };
      }
      return null;
  }
}
