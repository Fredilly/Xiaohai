import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
const parameters = { cost: 16_384, blockSize: 8, parallelization: 1, keyLength: 64 } as const;

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, encodedHash: string): Promise<boolean>;
}

export class ScryptPasswordHasher implements PasswordHasher {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(16);
    const derived = await derive(password, salt, parameters);
    return [
      'scrypt',
      parameters.cost,
      parameters.blockSize,
      parameters.parallelization,
      salt.toString('base64url'),
      derived.toString('base64url'),
    ].join('$');
  }

  async verify(password: string, encodedHash: string): Promise<boolean> {
    const [algorithm, cost, blockSize, parallelization, salt, expected, extra] =
      encodedHash.split('$');
    if (
      algorithm !== 'scrypt' ||
      !cost ||
      !blockSize ||
      !parallelization ||
      !salt ||
      !expected ||
      extra
    ) {
      return false;
    }

    const parsed = {
      cost: Number(cost),
      blockSize: Number(blockSize),
      parallelization: Number(parallelization),
      keyLength: Buffer.from(expected, 'base64url').length,
    };
    if (
      parsed.cost !== parameters.cost ||
      parsed.blockSize !== parameters.blockSize ||
      parsed.parallelization !== parameters.parallelization ||
      parsed.keyLength !== parameters.keyLength
    ) {
      return false;
    }

    const actual = await derive(password, Buffer.from(salt, 'base64url'), parsed);
    const expectedBuffer = Buffer.from(expected, 'base64url');
    return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer);
  }
}

async function derive(
  password: string,
  salt: Buffer,
  options: {
    cost: number;
    blockSize: number;
    parallelization: number;
    keyLength: number;
  },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      options.keyLength,
      {
        N: options.cost,
        r: options.blockSize,
        p: options.parallelization,
        maxmem: 64 * 1024 * 1024,
      },
      (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey);
      },
    );
  });
}
