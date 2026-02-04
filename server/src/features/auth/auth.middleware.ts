import type { FastifyRequest } from "fastify";
import { HttpError } from "@/shared/http-errors.js";
import { verifyMoltbookIdentityToken } from "@/features/auth/auth.service.js";
import type { AuthContext } from "@/features/auth/auth.types.js";

type RateWindow = { windowStartMs: number; count: number; lastSeenMs: number };
const rateWindows = new Map<string, RateWindow>();

function pruneRateWindows(nowMs: number) {
  for (const [key, value] of rateWindows.entries()) {
    if (nowMs - value.lastSeenMs > 10 * 60_000) rateWindows.delete(key);
  }
}

function enforceRateLimit(agentId: string, nowMs: number) {
  pruneRateWindows(nowMs);

  const windowMs = 60_000;
  const limitPerMinute = 600;

  const existing = rateWindows.get(agentId);
  if (!existing || nowMs - existing.windowStartMs >= windowMs) {
    rateWindows.set(agentId, { windowStartMs: nowMs, count: 1, lastSeenMs: nowMs });
    return;
  }

  existing.count += 1;
  existing.lastSeenMs = nowMs;

  if (existing.count > limitPerMinute) {
    const retryAfterSeconds = Math.max(1, Math.ceil((existing.windowStartMs + windowMs - nowMs) / 1000));
    throw new HttpError(429, "rate-limited", `Too many requests. Retry after ${retryAfterSeconds}s`);
  }
}

export async function requireMoltbookAuth(request: FastifyRequest) {
  const token = request.headers["x-moltbook-identity"];
  if (typeof token !== "string" || token.length === 0) {
    throw new HttpError(401, "missing-identity-token", "Missing X-Moltbook-Identity header");
  }

  const result = await verifyMoltbookIdentityToken(token);
  if (!result.valid) {
    throw new HttpError(401, "invalid-identity-token", result.error ?? result.message ?? "Invalid identity token");
  }

  enforceRateLimit(result.agent.id, Date.now());

  (request as unknown as { auth: AuthContext }).auth = {
    moltbook: { token, agent: { id: result.agent.id, name: result.agent.name, karma: result.agent.karma } },
  };
}
