import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { createGasLoanOffer, executeGasLoanOffer, registerBorrowerPolicy } from "@/features/loans/loans.service.js";
import type { AuthContext } from "@/features/auth/auth.types.js";
import type { GasLoanExecuteRequest, GasLoanOfferRequest } from "@/features/loans/loans.types.js";

const gasOfferSchema = z.object({
  borrower: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  principalWei: z
    .string()
    .regex(/^\d+$/)
    .refine((value) => {
      try {
        return BigInt(value) > 0n;
      } catch {
        return false;
      }
    }, "principalWei must be greater than 0"),
  interestBps: z.number().int().min(0).max(1_000_000),
  durationSeconds: z.number().int().positive(),
  offerTtlSeconds: z.number().int().positive().optional(),
  action: z.number().int().min(0).max(255),
  metadataHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/).optional(),
});

export async function postGasLoanOffer(request: FastifyRequest, reply: FastifyReply) {
  const auth = (request as unknown as { auth: AuthContext }).auth;
  const input = gasOfferSchema.parse(request.body) as unknown as GasLoanOfferRequest;
  const result = await createGasLoanOffer(auth.moltbook.agent.id, input);
  return reply.send({ ok: true, data: result });
}

const executeSchema = z.object({
  borrower: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  nonce: z.number().int().positive(),
  borrowerSignature: z.string().regex(/^0x[a-fA-F0-9]{130}$/),
});

export async function postExecuteGasLoan(request: FastifyRequest, reply: FastifyReply) {
  const auth = (request as unknown as { auth: AuthContext }).auth;
  const input = executeSchema.parse(request.body) as unknown as GasLoanExecuteRequest;
  const result = await executeGasLoanOffer(auth.moltbook.agent.id, input);
  return reply.send({ ok: true, data: result });
}

const registerPolicySchema = z.object({
  borrower: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  issuedAt: z.number().int().positive(),
  expiresAt: z.number().int().positive(),
  borrowerSignature: z.string().regex(/^0x[a-fA-F0-9]{130}$/),
});

export async function postRegisterBorrowerPolicy(request: FastifyRequest, reply: FastifyReply) {
  const auth = (request as unknown as { auth: AuthContext }).auth;
  const input = registerPolicySchema.parse(request.body) as {
    borrower: `0x${string}`;
    issuedAt: number;
    expiresAt: number;
    borrowerSignature: `0x${string}`;
  };

  const result = await registerBorrowerPolicy(auth.moltbook.agent.id, input);
  return reply.send({ ok: true, data: result });
}
