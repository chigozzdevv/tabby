import { env } from "@/config/env.js";
import { HttpError } from "@/shared/http-errors.js";
import type { MoltbookVerifyResponse } from "@/features/auth/auth.types.js";

export async function verifyMoltbookIdentityToken(identityToken: string): Promise<MoltbookVerifyResponse> {
  const base = env.MOLTBOOK_BASE_URL.endsWith("/") ? env.MOLTBOOK_BASE_URL : `${env.MOLTBOOK_BASE_URL}/`;
  const url = new URL("agents/verify-identity", base);
  const body: Record<string, unknown> = { token: identityToken };
  if (env.MOLTBOOK_AUDIENCE) body.audience = env.MOLTBOOK_AUDIENCE;

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new HttpError(502, "moltbook-unavailable", `moltbook verify failed (${res.status})`);
  }

  const json = (await res.json()) as MoltbookVerifyResponse;
  return json;
}
