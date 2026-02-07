import type { FastifyRequest } from "fastify";
import { env } from "@/config/env.js";
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

function isLoopbackIp(ip: string) {
  const v = ip.trim().toLowerCase();
  if (v === "127.0.0.1" || v === "::1") return true;
  if (v.startsWith("::ffff:127.")) return true;
  return false;
}

export async function requireGasLoanAuth(request: FastifyRequest) {
  if (env.ENFORCE_MOLTBOOK) {
    await requireMoltbookAuth(request);
    return;
  }

  const expectedDevToken = env.DEV_AUTH_TOKEN;
  if (expectedDevToken) {
    const header = request.headers["x-dev-auth"];
    if (typeof header !== "string" || header.length === 0) {
      throw new HttpError(401, "missing-dev-auth", "Missing X-Dev-Auth header");
    }
    if (header !== expectedDevToken) {
      throw new HttpError(401, "invalid-dev-auth", "Invalid X-Dev-Auth header");
    }
  } else if (!isLoopbackIp(request.ip)) {
    throw new HttpError(401, "dev-auth-required", "ENFORCE_MOLTBOOK=false requires DEV_AUTH_TOKEN for non-loopback requests");
  }

  const agentId = `dev:${request.ip}`;
  enforceRateLimit(agentId, Date.now());

  (request as unknown as { auth: AuthContext }).auth = {
    moltbook: { token: "dev", agent: { id: agentId, name: "dev" } },
  };
}
