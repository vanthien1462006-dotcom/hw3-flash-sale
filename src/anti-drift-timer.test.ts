import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeRemaining, createAntiDriftTimer } from './anti-drift-timer.ts';

type FrameCallback = (time: number) => void;

interface FakeFrames {
  // Runs only the callbacks queued before this call, like one animation frame.
  flush(): void;
  pendingCount(): number;
}

// Replaces requestAnimationFrame and cancelAnimationFrame for the duration of run(), then restores them.
function withFakeFrames(run: (frames: FakeFrames) => void): void {
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
    run({
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

test('computeRemaining returns the time left and never goes negative', () => {
  assert.equal(computeRemaining(1000, 400), 600);
  assert.equal(computeRemaining(1000, 1000), 0);
  assert.equal(computeRemaining(1000, 1500), 0);
});

test('createAntiDriftTimer reports the true remaining time after uneven clock jumps', () => {
  let now = 0;
  const clock = (): number => now;
  const ticks: number[] = [];

  withFakeFrames((frames) => {
    createAntiDriftTimer(1000, (remaining) => {
      ticks.push(remaining);
    }, clock);

    now = 100;
    frames.flush();
    now = 350;
    frames.flush();
    now = 900;
    frames.flush();
    now = 1200;
    frames.flush();

    assert.deepEqual(ticks, [900, 650, 100, 0]);
    assert.equal(frames.pendingCount(), 0);
  });
});

test('stop cancels the pending frame and is safe to call twice', () => {
  let now = 0;
  const clock = (): number => now;
  const ticks: number[] = [];

  withFakeFrames((frames) => {
    const stop = createAntiDriftTimer(1000, (remaining) => {
      ticks.push(remaining);
    }, clock);

    stop();
    stop();
    assert.equal(frames.pendingCount(), 0);

    now = 500;
    frames.flush();
    assert.deepEqual(ticks, []);
  });
});

test('stop called inside onTick prevents further frames', () => {
  let now = 0;
  const clock = (): number => now;
  const ticks: number[] = [];

  withFakeFrames((frames) => {
    const stop = createAntiDriftTimer(1000, (remaining) => {
      ticks.push(remaining);
      stop();
    }, clock);

    now = 100;
    frames.flush();

    assert.deepEqual(ticks, [900]);
    assert.equal(frames.pendingCount(), 0);
  });
});

test('stop after the countdown has finished does not throw', () => {
  let now = 0;
  const clock = (): number => now;
  const ticks: number[] = [];

  withFakeFrames((frames) => {
    const stop = createAntiDriftTimer(100, (remaining) => {
      ticks.push(remaining);
    }, clock);

    now = 200;
    frames.flush();
    assert.deepEqual(ticks, [0]);

    stop();
    assert.equal(frames.pendingCount(), 0);
  });
});
