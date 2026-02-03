import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  getNativePoolSnapshot,
  getNativePosition,
  getSecuredPoolSnapshot,
  getSecuredPosition,
  quoteNativeDeposit,
  quoteNativeWithdraw,
  quoteSecuredDeposit,
  quoteSecuredWithdraw,
} from "@/features/liquidity/liquidity.service.js";

export async function getPools(_request: FastifyRequest, reply: FastifyReply) {
  const native = await getNativePoolSnapshot();
  const secured = await getSecuredPoolSnapshot();
  return reply.send({ ok: true, data: { native, secured } });
}

const positionQuerySchema = z.object({
  account: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

export async function getNativeLpPosition(request: FastifyRequest, reply: FastifyReply) {
  const { account } = positionQuerySchema.parse(request.query);
  const data = await getNativePosition(account as `0x${string}`);
  return reply.send({ ok: true, data });
}

export async function getSecuredLpPosition(request: FastifyRequest, reply: FastifyReply) {
  const { account } = positionQuerySchema.parse(request.query);
  const data = await getSecuredPosition(account as `0x${string}`);
  return reply.send({ ok: true, data });
}

const depositQuoteSchema = z.object({
  amountWei: z.string().regex(/^\d+$/),
});

export async function getNativeDepositQuote(request: FastifyRequest, reply: FastifyReply) {
  const { amountWei } = depositQuoteSchema.parse(request.query);
  const data = await quoteNativeDeposit(BigInt(amountWei));
  return reply.send({ ok: true, data });
}

export async function getSecuredDepositQuote(request: FastifyRequest, reply: FastifyReply) {
  const { amountWei } = depositQuoteSchema.parse(request.query);
  const data = await quoteSecuredDeposit(BigInt(amountWei));
  return reply.send({ ok: true, data });
}

const withdrawQuoteSchema = z.object({
  shares: z.string().regex(/^\d+$/),
});

export async function getNativeWithdrawQuote(request: FastifyRequest, reply: FastifyReply) {
  const { shares } = withdrawQuoteSchema.parse(request.query);
  const data = await quoteNativeWithdraw(BigInt(shares));
  return reply.send({ ok: true, data });
}

export async function getSecuredWithdrawQuote(request: FastifyRequest, reply: FastifyReply) {
  const { shares } = withdrawQuoteSchema.parse(request.query);
  const data = await quoteSecuredWithdraw(BigInt(shares));
  return reply.send({ ok: true, data });
}
