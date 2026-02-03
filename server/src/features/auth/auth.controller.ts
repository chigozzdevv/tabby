import type { FastifyReply, FastifyRequest } from "fastify";
import type { AuthContext } from "@/features/auth/auth.types.js";

export async function getMe(request: FastifyRequest, reply: FastifyReply) {
  const auth = (request as unknown as { auth: AuthContext }).auth;
  return reply.send({ agent: auth.moltbook.agent });
}
