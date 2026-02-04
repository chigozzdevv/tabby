import { env } from "@/config/env.js";
import { HttpError } from "@/shared/http-errors.js";
import type { MoltbookVerifyResponse } from "@/features/auth/auth.types.js";
import { z } from "zod";

type CacheEntry = { value: MoltbookVerifyResponse; expiresAtMs: number };

const tokenCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<MoltbookVerifyResponse>>();

function pruneCache(nowMs: number) {
  for (const [key, entry] of tokenCache.entries()) {
    if (entry.expiresAtMs <= nowMs) tokenCache.delete(key);
  }
  const maxEntries = 2_000;
  if (tokenCache.size <= maxEntries) return;
  const overflow = tokenCache.size - maxEntries;
  const keys = tokenCache.keys();
  for (let i = 0; i < overflow; i++) {
    const next = keys.next();
    if (next.done) break;
    tokenCache.delete(next.value);
  }
}

export async function verifyMoltbookIdentityToken(identityToken: string): Promise<MoltbookVerifyResponse> {
  const nowMs = Date.now();
  pruneCache(nowMs);

  const cached = tokenCache.get(identityToken);
  if (cached && cached.expiresAtMs > nowMs) return cached.value;
  if (cached) tokenCache.delete(identityToken);

  const pending = inFlight.get(identityToken);
  if (pending) return await pending;

  const promise = (async () => {
    const base = env.MOLTBOOK_BASE_URL.endsWith("/") ? env.MOLTBOOK_BASE_URL : `${env.MOLTBOOK_BASE_URL}/`;
    const url = new URL("agents/verify-identity", base);
    const body: Record<string, unknown> = { token: identityToken };
    if (env.MOLTBOOK_AUDIENCE) body.audience = env.MOLTBOOK_AUDIENCE;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-moltbook-app-key": env.MOLTBOOK_APP_KEY,
      },
      body: JSON.stringify(body),
    });

    const json = await res.json().catch(() => undefined);
    if (!json) throw new HttpError(502, "moltbook-unavailable", `moltbook verify failed (${res.status})`);

    const schema = z
      .object({
        valid: z.boolean(),
        success: z.boolean().optional(),
        agent: z.object({ id: z.string().min(1), name: z.string().min(1), karma: z.number().optional() }).optional(),
        error: z.string().optional(),
        message: z.string().optional(),
        hint: z.string().optional(),
      })
      .passthrough();

    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new HttpError(502, "moltbook-unavailable", `moltbook verify failed (${res.status})`);

    const data = parsed.data as MoltbookVerifyResponse;

    if (!data.valid) {
      const errorCode = typeof data.error === "string" ? data.error : undefined;
      if (errorCode === "missing_app_key" || errorCode === "invalid_app_key") {
        throw new HttpError(500, "moltbook-app-key-misconfigured", data.message ?? "Moltbook app key missing or invalid");
      }
    }

    const ttlMs = data.valid ? 55 * 60_000 : 30_000;
    tokenCache.set(identityToken, { value: data, expiresAtMs: Date.now() + ttlMs });

    return data;
  })()
    .finally(() => {
      inFlight.delete(identityToken);
    });

  inFlight.set(identityToken, promise);
  return await promise;
}
