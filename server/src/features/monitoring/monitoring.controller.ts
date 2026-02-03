import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AuthContext } from "@/features/auth/auth.types.js";
import { getGasLoanDetails, listGasLoans } from "@/features/monitoring/monitoring.service.js";

export async function getGasLoans(request: FastifyRequest, reply: FastifyReply) {
  const auth = (request as unknown as { auth: AuthContext }).auth;
  const data = await listGasLoans(auth.moltbook.agent.id, request.query);
  return reply.send({ ok: true, data });
}

const loanIdParamsSchema = z.object({ loanId: z.coerce.number().int().positive() });

export async function getGasLoanById(request: FastifyRequest, reply: FastifyReply) {
  const auth = (request as unknown as { auth: AuthContext }).auth;
  const { loanId } = loanIdParamsSchema.parse(request.params);
  const data = await getGasLoanDetails(auth.moltbook.agent.id, loanId);
  return reply.send({ ok: true, data });
}

