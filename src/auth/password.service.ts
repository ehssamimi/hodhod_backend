import { Injectable } from '@nestjs/common';
import { randomBytes, scrypt as nodeScrypt, timingSafeEqual } from 'node:crypto';
const COST = 16384;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;
const KEY_LENGTH = 64;
const MAX_MEMORY = 64 * 1024 * 1024;

const scrypt = (password: string, salt: Buffer, keyLength: number, options: { N: number; r: number; p: number; maxmem: number }) =>
  new Promise<Buffer>((resolve, reject) => nodeScrypt(password, salt, keyLength, options, (error, derived) =>
    error ? reject(error) : resolve(derived)));

@Injectable()
export class PasswordService {
  // A missing account still performs one real password hash verification.
  private readonly dummyHash = this.hash(randomBytes(32).toString('base64url'));

  async hash(password: string): Promise<string> {
    const salt = randomBytes(16);
    const derived = await scrypt(password, salt, KEY_LENGTH, {
      N: COST, r: BLOCK_SIZE, p: PARALLELIZATION, maxmem: MAX_MEMORY,
    });
    return ['scrypt', COST, BLOCK_SIZE, PARALLELIZATION, salt.toString('base64'), derived.toString('base64')].join('$');
  }

  async verify(password: string, encoded?: string | null): Promise<boolean> {
    const candidate = encoded ?? await this.dummyHash;
    const [algorithm, cost, blockSize, parallelization, saltText, hashText, ...extra] = candidate.split('$');
    if (algorithm !== 'scrypt' || extra.length || !/^\d+$/.test(cost ?? '') || !/^\d+$/.test(blockSize ?? '') ||
        !/^\d+$/.test(parallelization ?? '') || !saltText || !hashText) return false;
    const expected = Buffer.from(hashText, 'base64');
    if (expected.length !== KEY_LENGTH) return false;
    try {
      const derived = await scrypt(password, Buffer.from(saltText, 'base64'), expected.length, {
        N: Number(cost), r: Number(blockSize), p: Number(parallelization), maxmem: MAX_MEMORY,
      });
      return timingSafeEqual(derived, expected);
    } catch { return false; }
  }
}
