import type { Clock, TickHandler } from './contract.ts';

export function computeRemaining(targetMs: number, nowMs: number): number {
  return Math.max(0, targetMs - nowMs);
}

// Ticks on animation frames. Each tick reads the clock again, so late frames do not accumulate error.
export function createAntiDriftTimer(
  durationMs: number,
  onTick: TickHandler,
  clock: Clock = Date.now,
): () => void {
  const targetTime = clock() + durationMs;
  let frameId: number | null = null;

  const frame = (): void => {
    frameId = null;
    const remaining = computeRemaining(targetTime, clock());
    // Schedule the next frame before onTick, so stop() called inside onTick takes effect.
    if (remaining > 0) {
      frameId = requestAnimationFrame(frame);
    }
    onTick(remaining);
  };

  frameId = requestAnimationFrame(frame);

  return (): void => {
    if (frameId !== null) {
      cancelAnimationFrame(frameId);
      frameId = null;
    }
  };
}
