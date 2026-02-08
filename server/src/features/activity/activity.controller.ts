import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AuthContext } from "@/features/auth/auth.types.js";
import { listActivityEvents } from "@/features/activity/activity.service.js";

const authQuerySchema = z.object({
  borrower: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  loanId: z.coerce.number().int().positive().optional(),
  type: z
    .enum([
      "borrower-policy.registered",
      "gas-loan.offer-created",
      "gas-loan.offer-expired",
      "gas-loan.offer-canceled",
      "gas-loan.executed",
      "gas-loan.repaid",
      "gas-loan.defaulted",
    ])
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.coerce.date().optional(),
});

const publicQuerySchema = z.object({
  borrower: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  loanId: z.coerce.number().int().positive().optional(),
  type: z
    .enum([
      "borrower-policy.registered",
      "gas-loan.offer-created",
      "gas-loan.offer-expired",
      "gas-loan.offer-canceled",
      "gas-loan.executed",
      "gas-loan.repaid",
      "gas-loan.defaulted",
    ])
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.coerce.date().optional(),
});

export async function getActivity(request: FastifyRequest, reply: FastifyReply) {
  const auth = (request as unknown as { auth: AuthContext }).auth;
  const query = authQuerySchema.parse(request.query);
  const data = await listActivityEvents({ agentId: auth.moltbook.agent.id, ...query });
  return reply.send({ ok: true, data });
}

export async function getPublicActivity(request: FastifyRequest, reply: FastifyReply) {
  const query = publicQuerySchema.parse(request.query);
  const data = await listActivityEvents(query);
  return reply.send({ ok: true, data });
}
