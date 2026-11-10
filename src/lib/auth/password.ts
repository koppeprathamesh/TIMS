import bcrypt from "bcryptjs";

const SALT_ROUNDS = 12;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// Compared when the account does not exist so "unknown email" costs the same time as
// "wrong password" and cannot be told apart by response timing.
let dummyHash: Promise<string> | null = null;

export async function verifyPasswordConstantTime(plain: string, hash: string | null | undefined): Promise<boolean> {
  if (hash) return bcrypt.compare(plain, hash);
  dummyHash ??= bcrypt.hash("timing-equalizer-not-a-real-password", SALT_ROUNDS);
  await bcrypt.compare(plain, await dummyHash);
  return false;
}
