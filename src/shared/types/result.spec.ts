import { describe, it, expect } from 'vitest';
import { Result } from './result.js';

describe('Result<T, E> Pattern', () => {
  it('should create Ok value and map successfully', () => {
    const ok = Result.ok<number, string>(10);
    expect(ok.isOk).toBe(true);
    expect(ok.isErr).toBe(false);
    expect(ok.unwrap()).toBe(10);

    const mapped = ok.map((x) => x * 2);
    expect(mapped.unwrap()).toBe(20);
  });

  it('should create Err value and mapErr successfully', () => {
    const err = Result.fail<number, string>('NOT_FOUND');
    expect(err.isOk).toBe(false);
    expect(err.isErr).toBe(true);

    const mappedErr = err.mapErr((e) => `ERR_${e}`);
    expect(mappedErr.match({
      ok: () => 'ok',
      err: (e) => e,
    })).toBe('ERR_NOT_FOUND');
  });

  it('should throw on unwrap of Err', () => {
    const err = Result.fail('BOOM');
    expect(() => err.unwrap()).toThrow(/Attempted to unwrap an Err/);
  });

  it('should pattern match on Ok and Err', () => {
    const ok = Result.ok('success');
    const err = Result.fail('failure');

    const res1 = ok.match({ ok: (v) => v.toUpperCase(), err: (e) => e });
    const res2 = err.match({ ok: (v) => v, err: (e) => `Error: ${e}` });

    expect(res1).toBe('SUCCESS');
    expect(res2).toBe('Error: failure');
  });
});
