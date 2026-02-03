import type { FastifyRequest } from "fastify";
import { HttpError } from "@/shared/http-errors.js";
import { verifyMoltbookIdentityToken } from "@/features/auth/auth.service.js";
import type { AuthContext } from "@/features/auth/auth.types.js";

export async function requireMoltbookAuth(request: FastifyRequest) {
  const token = request.headers["x-moltbook-identity"];
  if (typeof token !== "string" || token.length === 0) {
    throw new HttpError(401, "missing-identity-token", "Missing X-Moltbook-Identity header");
  }

  const result = await verifyMoltbookIdentityToken(token);
  if (!result.valid) {
    throw new HttpError(401, "invalid-identity-token", result.error ?? "Invalid identity token");
  }

  (request as unknown as { auth: AuthContext }).auth = {
    moltbook: { token, agent: { id: result.agent.id, name: result.agent.name, karma: result.agent.karma } },
  };
}
