import { createAntiDriftTimer } from './anti-drift-timer.ts';

export interface DurationParts {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

type UnitName = keyof DurationParts;

const UNIT_NAMES: readonly UnitName[] = ['days', 'hours', 'minutes', 'seconds'];

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 86400;

// Writes the parts into `out`, so the frame loop can reuse one object.
export function splitDurationInto(ms: number, out: DurationParts): DurationParts {
  const totalSeconds = Math.floor(Math.max(0, ms) / MS_PER_SECOND);
  out.days = Math.floor(totalSeconds / SECONDS_PER_DAY);
  out.hours = Math.floor((totalSeconds % SECONDS_PER_DAY) / SECONDS_PER_HOUR);
  out.minutes = Math.floor((totalSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  out.seconds = totalSeconds % SECONDS_PER_MINUTE;
  return out;
}

export function splitDuration(ms: number): DurationParts {
  return splitDurationInto(ms, { days: 0, hours: 0, minutes: 0, seconds: 0 });
}

function requireUnit(root: HTMLElement, unit: UnitName): HTMLSpanElement {
  const el = root.querySelector<HTMLSpanElement>(`span[data-unit="${unit}"]`);
  if (el === null) {
    throw new Error(`countdown: missing span[data-unit="${unit}"] inside the timer element`);
  }
  return el;
}

// Renders the countdown to the sale start. Returns a function that stops it.
export function startCountdown(
  root: HTMLElement,
  saleStartEl: HTMLTimeElement,
  doneEl: HTMLElement,
): () => void {
  const targetMs = Date.parse(saleStartEl.dateTime);
  if (Number.isNaN(targetMs)) {
    throw new Error(`countdown: invalid sale start datetime "${saleStartEl.dateTime}"`);
  }

  const units = UNIT_NAMES.map((name) => ({ name, el: requireUnit(root, name) }));
  const parts: DurationParts = { days: 0, hours: 0, minutes: 0, seconds: 0 };
  const shown: DurationParts = { days: -1, hours: -1, minutes: -1, seconds: -1 };

  const onTick = (remainingMs: number): void => {
    if (remainingMs === 0) {
      root.hidden = true;
      doneEl.hidden = false;
      doneEl.textContent = 'The sale is live.';
      return;
    }

    splitDurationInto(remainingMs, parts);
    for (const unit of units) {
      const value = parts[unit.name];
      // Write the DOM only when a displayed value changes.
      if (value !== shown[unit.name]) {
        shown[unit.name] = value;
        unit.el.textContent = String(value).padStart(2, '0');
      }
    }
  };

  return createAntiDriftTimer(Math.max(0, targetMs - Date.now()), onTick);
}
