// TODO(wave2): implement
import { Prisma, PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma: PrismaClient = global.__prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  global.__prisma = prisma;
}

/**
 * Transient connection error codes worth retrying:
 *   P1001 - can't reach DB server
 *   P1002 - DB server timeout
 *   P1017 - server has closed the connection
 *   P2024 - connection pool timeout
 */
const TRANSIENT_DB_ERRORS = new Set(["P1001", "P1002", "P1017", "P2024"]);

function isTransientDbError(err: unknown): boolean {
  const code =
    err instanceof Prisma.PrismaClientKnownRequestError
      ? err.code
      : err instanceof Prisma.PrismaClientInitializationError
        ? err.errorCode
        : null;
  return code != null && TRANSIENT_DB_ERRORS.has(code);
}

/**
 * Retry a prisma query on transient connection errors with exponential backoff.
 * Defaults: 4 attempts, 250ms / 750ms / 2.25s / 6.75s.
 */
export async function withDbRetry<T>(
  fn: () => Promise<T>,
  attempts = 4,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isTransientDbError(err) || i === attempts - 1) throw err;
      const delay = 250 * Math.pow(3, i);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
