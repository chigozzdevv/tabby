import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AuthContext } from "@/features/auth/auth.types.js";
import {
  getGasLoanDetails,
  getPublicGasLoanDetails,
  getPublicNextDue,
  listGasLoans,
  listPublicGasLoans,
} from "@/features/monitoring/monitoring.service.js";

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

export async function getPublicGasLoans(request: FastifyRequest, reply: FastifyReply) {
  const data = await listPublicGasLoans(request.query);
  return reply.send({ ok: true, data });
}

export async function getPublicGasLoanById(request: FastifyRequest, reply: FastifyReply) {
  const { loanId } = loanIdParamsSchema.parse(request.params);
  const data = await getPublicGasLoanDetails(loanId);
  return reply.send({ ok: true, data });
}

const nextDueQuerySchema = z.object({
  borrower: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

export async function getPublicNextDueGasLoan(request: FastifyRequest, reply: FastifyReply) {
  const { borrower } = nextDueQuerySchema.parse(request.query);
  const data = await getPublicNextDue(borrower);
  return reply.send({ ok: true, data });
}
