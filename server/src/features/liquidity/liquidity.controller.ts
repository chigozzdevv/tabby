import type { FastifyReply, FastifyRequest } from "fastify";
import { getNativePoolSnapshot } from "@/features/liquidity/liquidity.service.js";

export async function getPools(_request: FastifyRequest, reply: FastifyReply) {
  const native = await getNativePoolSnapshot();
  return reply.send({ ok: true, data: { native } });
}
