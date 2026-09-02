/**
 * For failures that are expected control flow rather than exceptions.
 *
 * Used sparingly: a wrong password is an IdenzyError because it must produce an HTTP
 * response. A cache miss or an optimistic-lock retry is a Result.
 */
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}
