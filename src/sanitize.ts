// Any control character except line feed. The line feed is kept for textarea input.
const CONTROL_CHARS = /(?!\n)\p{Cc}/gu;
const WHITESPACE_RUN = /[^\S\n]+/g;
const PHONE = /^0\d{9}$/;

// Untrusted input is clamped to plain text here. Length limits are checked in validateCheckout.
export function normalizeText(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value
    .normalize('NFC')
    // A tab is treated as a separator, so "Anh\tNguyen" becomes "Anh Nguyen" and not "AnhNguyen".
    .replace(/\t/g, ' ')
    .replace(CONTROL_CHARS, '')
    .replace(WHITESPACE_RUN, ' ')
    .trim();
}

// The whole normalized string must be exactly 10 digits starting with 0. It is never cut to fit.
export function validatePhone(value: string): boolean {
  return PHONE.test(normalizeText(value));
}
