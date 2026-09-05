import { EmailSendError } from '@app/contract/mail/interfaces/email-provider.interface';

/**
 * Await a call that is expected to reject, and hand back the thrown
 * `EmailSendError` for inspection.
 *
 * `promise.catch((e) => e as EmailSendError)` looks like it does this but does
 * not type-check: TypeScript widens the result to
 * `EmailSendError | <the resolve type>`, so every property access on it is an
 * error. Worse, if the call unexpectedly *succeeds* that form silently returns
 * the success value and the assertions below it quietly pass against the wrong
 * object. This fails loudly instead.
 */
export async function captureEmailError(promise: Promise<unknown>): Promise<EmailSendError> {
  let caught: unknown;
  let resolved = false;

  try {
    await promise;
    resolved = true;
  } catch (error) {
    caught = error;
  }

  if (resolved) {
    throw new Error('Expected the call to reject with an EmailSendError, but it resolved.');
  }

  return caught as EmailSendError;
}
