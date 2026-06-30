import { NextResponse } from "next/server";
import { readSession } from "@/lib/session";

/**
 * GET /api/auth/session - returns { address } when the caller has a valid
 * wallet session cookie, otherwise 200 { address: null }. We avoid 401 here
 * so unauthenticated UI doesn't trigger console errors on every page load.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const session = await readSession(req);
  return NextResponse.json({ address: session?.addr ?? null });
}
