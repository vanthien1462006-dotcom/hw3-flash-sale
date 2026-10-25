import { normalizeText, validatePhone } from './sanitize.ts';

export type CheckoutField = 'name' | 'phone' | 'address';
export type CheckoutErrors = Partial<Record<CheckoutField, string>>;

export interface CheckoutValidation {
  ok: boolean;
  errors: CheckoutErrors;
}

export interface CheckoutValues {
  name: string;
  phone: string;
  address: string;
}

type FormState = 'idle' | 'submitting' | 'success' | 'error';

const NAME_MAX_LENGTH = 60;
const ADDRESS_MAX_LENGTH = 200;
const FIELD_NAMES: readonly CheckoutField[] = ['name', 'phone', 'address'];

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

function requireElement<T extends Element>(root: ParentNode, selector: string): T {
  const el = root.querySelector<T>(selector);
  if (el === null) {
    throw new Error(`checkout-form: missing ${selector} inside #checkout-form`);
  }
  return el;
}

export function createCheckoutForm(
  formEl: HTMLFormElement,
  options: { onSubmit: (values: CheckoutValues) => Promise<void> },
): { dispose(): void } {
  const fields: Record<CheckoutField, { input: HTMLInputElement | HTMLTextAreaElement; error: HTMLParagraphElement }> = {
    name: {
      input: requireElement<HTMLInputElement>(formEl, '#name'),
      error: requireElement<HTMLParagraphElement>(formEl, '#name-error'),
    },
    phone: {
      input: requireElement<HTMLInputElement>(formEl, '#phone'),
      error: requireElement<HTMLParagraphElement>(formEl, '#phone-error'),
    },
    address: {
      input: requireElement<HTMLTextAreaElement>(formEl, '#address'),
      error: requireElement<HTMLParagraphElement>(formEl, '#address-error'),
    },
  };
  const submitBtn = requireElement<HTMLButtonElement>(formEl, '#submit-btn');
  const retryBtn = requireElement<HTMLButtonElement>(formEl, '#retry-btn');
  const formStatus = requireElement<HTMLParagraphElement>(formEl, '#form-status');

  const setState = (state: FormState): void => {
    formEl.dataset.state = state;
  };

  const showFieldError = (field: CheckoutField, message: string | undefined): void => {
    const { input, error } = fields[field];
    if (message === undefined) {
      input.removeAttribute('aria-invalid');
      error.textContent = '';
      error.hidden = true;
      return;
    }
    input.setAttribute('aria-invalid', 'true');
    error.textContent = message;
    error.hidden = false;
  };

  const handleSubmit = async (event: SubmitEvent): Promise<void> => {
    event.preventDefault();

    // Guard 1 checks data-state, not only the disabled button. A disabled button does not stop
    // form.requestSubmit() or a script from firing submit again while a request is in flight.
    if (formEl.dataset.state === 'submitting') {
      return;
    }

    if (formEl.dataset.state === 'success') {
      formStatus.textContent = 'Order already placed. Reload the page to order again.';
      return;
    }

    const raw: CheckoutValues = {
      name: fields.name.input.value,
      phone: fields.phone.input.value,
      address: fields.address.input.value,
    };
    const result = validateCheckout(raw);
    for (const field of FIELD_NAMES) {
      showFieldError(field, result.errors[field]);
    }

    const firstInvalid = FIELD_NAMES.find((field) => result.errors[field] !== undefined);
    if (firstInvalid !== undefined) {
      fields[firstInvalid].input.focus();
      formStatus.textContent = 'Please fix the highlighted fields.';
      return;
    }

    const values: CheckoutValues = {
      name: normalizeText(raw.name),
      phone: normalizeText(raw.phone),
      address: normalizeText(raw.address),
    };

    formStatus.textContent = '';
    setState('submitting');
    submitBtn.disabled = true;

    try {
      await options.onSubmit(values);
      setState('success');
      submitBtn.disabled = false;
      formStatus.textContent = 'Order placed. Thank you.';
    } catch (error: unknown) {
      setState('error');
      submitBtn.disabled = false;
      retryBtn.hidden = false;
      formStatus.textContent = error instanceof Error ? error.message : 'Something went wrong. Try again.';
    }
  };

  const handleRetry = (): void => {
    setState('idle');
    retryBtn.hidden = true;
    submitBtn.disabled = false;
    formStatus.textContent = '';
  };

  formEl.addEventListener('submit', handleSubmit);
  retryBtn.addEventListener('click', handleRetry);

  return {
    dispose(): void {
      formEl.removeEventListener('submit', handleSubmit);
      retryBtn.removeEventListener('click', handleRetry);
    },
  };
}
