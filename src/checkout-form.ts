import { normalizeText, validatePhone } from './sanitize.ts';

export type CheckoutField = 'name' | 'phone' | 'address';
export type CheckoutErrors = Partial<Record<CheckoutField, string>>;

export interface CheckoutValidation {
  ok: boolean;
  errors: CheckoutErrors;
}

const NAME_MAX_LENGTH = 60;
const ADDRESS_MAX_LENGTH = 200;

// Pure check. The maxlength attributes on the inputs already block long typing; the length errors here are a second layer.
export function validateCheckout(values: { name: unknown; phone: unknown; address: unknown }): CheckoutValidation {
  const errors: CheckoutErrors = {};

  const name = normalizeText(values.name);
  if (name.length === 0) {
    errors.name = 'Name is required.';
  } else if (name.length > NAME_MAX_LENGTH) {
    errors.name = 'Name is too long.';
  }

  if (!validatePhone(normalizeText(values.phone))) {
    errors.phone = 'Enter a 10-digit phone number starting with 0.';
  }

  const address = normalizeText(values.address);
  if (address.length === 0) {
    errors.address = 'Address is required.';
  } else if (address.length > ADDRESS_MAX_LENGTH) {
    errors.address = 'Address is too long.';
  }

  return { ok: Object.keys(errors).length === 0, errors };
}
