/**
 * Result<T, E> Pattern Implementation
 * Functional, zero-dependency algebraic data type for deterministic error handling.
 */

export type Result<T, E> = Ok<T, E> | Err<T, E>;

export class Ok<T, E> {
  readonly isOk = true as const;
  readonly isErr = false as const;

  constructor(readonly value: T) {}

  map<U>(fn: (val: T) => U): Result<U, E> {
    return new Ok(fn(this.value));
  }

  mapErr<F>(_fn: (err: E) => F): Result<T, F> {
    return new Ok(this.value);
  }

  match<U>(patterns: { ok: (val: T) => U; err: (err: E) => U }): U {
    return patterns.ok(this.value);
  }

  unwrap(): T {
    return this.value;
  }
}

export class Err<T, E> {
  readonly isOk = false as const;
  readonly isErr = true as const;

  constructor(readonly error: E) {}

  map<U>(_fn: (val: T) => U): Result<U, E> {
    return new Err(this.error);
  }

  mapErr<F>(fn: (err: E) => F): Result<T, F> {
    return new Err(fn(this.error));
  }

  match<U>(patterns: { ok: (val: T) => U; err: (err: E) => U }): U {
    return patterns.err(this.error);
  }

  unwrap(): T {
    throw new Error(`Attempted to unwrap an Err: ${JSON.stringify(this.error)}`);
  }
}

export const Result = {
  ok: <T, E = never>(value: T): Result<T, E> => new Ok(value),
  fail: <T = never, E = unknown>(error: E): Result<T, E> => new Err(error),
};
