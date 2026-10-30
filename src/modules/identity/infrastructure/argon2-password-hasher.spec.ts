import { describe, expect, it } from 'vitest';
import { Argon2idPasswordHasher } from './argon2-password-hasher.js';

describe('Argon2idPasswordHasher', () => {
  it('hashes passwords with an Argon2id PHC string and verifies the password', async () => {
    const hasher = new Argon2idPasswordHasher();
    const hash = await hasher.hash('correct horse battery staple');
    expect(hash).toMatch(/^\$argon2id\$/);
    await expect(hasher.verify(hash, 'correct horse battery staple')).resolves.toBe(true);
    await expect(hasher.verify(hash, 'incorrect horse battery staple')).resolves.toBe(false);
  });
});
