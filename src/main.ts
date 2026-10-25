import { startCountdown } from './countdown.ts';

const timer = document.querySelector<HTMLParagraphElement>('#countdown');
const doneMessage = document.querySelector<HTMLParagraphElement>('#countdown-done');
const saleStart = document.querySelector<HTMLTimeElement>('time#sale-start');

if (timer === null || doneMessage === null || saleStart === null) {
  throw new Error('main: missing #countdown, #countdown-done or time#sale-start in index.html');
}

const stopCountdown = startCountdown(timer, saleStart, doneMessage);

window.addEventListener('pagehide', stopCountdown, { once: true });
