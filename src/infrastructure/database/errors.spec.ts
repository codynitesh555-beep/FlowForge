import { describe, expect, it } from 'vitest';
import { mapDatabaseError } from './errors.js';

describe('mapDatabaseError', () => {
  it.each([
    ['P2002', 'UNIQUE_CONSTRAINT'],
    ['P2003', 'FOREIGN_KEY'],
    ['P2025', 'RECORD_NOT_FOUND'],
    ['P9999', 'DATABASE_ERROR'],
  ] as const)('maps %s without exposing the database message', (code, expected) => {
    expect(mapDatabaseError({ code, message: 'sensitive database details' })).toEqual({ code: expected });
  });
});
