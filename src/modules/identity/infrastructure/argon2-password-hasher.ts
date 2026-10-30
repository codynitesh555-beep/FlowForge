import argon2 from 'argon2';
import type { PasswordHasher } from '../application/authentication.js';

/** Argon2id with memory-hard parameters; PHC strings carry their parameters. */
export class Argon2idPasswordHasher implements PasswordHasher {
  async hash(password: string): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65_536,
      timeCost: 3,
      parallelism: 1,
    });
  }

  async verify(hash: string, password: string): Promise<boolean> {
    return argon2.verify(hash, password);
  }
}
