/**
 * Best-effort, fire-and-forget cleanup of expired rows in short-lived
 * verification / pairing tables. Called from the corresponding insert
 * routes so the tables self-maintain without a separate scheduler.
 *
 * Errors are swallowed: a failed cleanup must never block a fresh OTP
 * issuance or a pairing handshake. Backed by `expiresAt` indexes — see
 * the hardening_pack migration.
 */
import { prisma } from "@/lib/db";

/**
 * Wrap fire-and-forget DB calls so a synchronous failure (e.g. the
 * Prisma client method missing in a test mock) is swallowed alongside
 * the async rejection path. Otherwise the test runner would surface a
 * TypeError from the missing method even though the production
 * behavior is best-effort.
 */
function fire(work: () => Promise<unknown>): void {
  try {
    void work().catch(() => {
      /* noop */
    });
  } catch {
    /* noop */
  }
}

export function pruneExpiredEmailOtps(): void {
  fire(() =>
    prisma.emailOtp.deleteMany({ where: { expiresAt: { lt: new Date() } } }),
  );
}

export function pruneExpiredTelegramPairings(): void {
  fire(() =>
    prisma.telegramPairing.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    }),
  );
}

export function pruneExpiredRevokedSessions(): void {
  fire(() =>
    prisma.revokedSession.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    }),
  );
}
