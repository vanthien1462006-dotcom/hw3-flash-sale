import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitDuration, splitDurationInto } from './countdown.ts';

test('splitDuration returns zeros for 0 ms', () => {
  assert.deepEqual(splitDuration(0), { days: 0, hours: 0, minutes: 0, seconds: 0 });
});

test('splitDuration keeps 59 999 ms as 59 seconds, not a full minute', () => {
  assert.deepEqual(splitDuration(59_999), { days: 0, hours: 0, minutes: 0, seconds: 59 });
});

test('splitDuration counts exactly 1 000 ms as 1 second', () => {
  assert.deepEqual(splitDuration(1000), { days: 0, hours: 0, minutes: 0, seconds: 1 });
});

test('splitDuration splits one day, three hours, four minutes and five seconds', () => {
  const ms = 86_400_000 + 3 * 3_600_000 + 4 * 60_000 + 5_000;
  assert.deepEqual(splitDuration(ms), { days: 1, hours: 3, minutes: 4, seconds: 5 });
});

test('splitDuration clamps negative durations to zero', () => {
  assert.deepEqual(splitDuration(-5000), { days: 0, hours: 0, minutes: 0, seconds: 0 });
});

test('splitDurationInto writes into the given object and returns it', () => {
  const out = { days: 9, hours: 9, minutes: 9, seconds: 9 };
  const result = splitDurationInto(3_723_000, out);
  assert.equal(result, out);
  assert.deepEqual(out, { days: 0, hours: 1, minutes: 2, seconds: 3 });
});
