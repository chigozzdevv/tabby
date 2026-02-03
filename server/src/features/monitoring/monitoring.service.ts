import { z } from "zod";
import { getDb } from "@/db/mongodb.js";
import { asAddress, publicClient } from "@/shared/viem.js";
import { HttpError } from "@/shared/http-errors.js";
import { env } from "@/config/env.js";
import type { GasLoanOfferDoc } from "@/features/loans/loans.model.js";
import type { GasLoanDetails, GasLoanOfferSummary } from "@/features/monitoring/monitoring.types.js";

const listQuerySchema = z.object({
  status: z.enum(["issued", "expired", "executed", "canceled"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const agentLoanManagerAbi = [
  {
    type: "function",
    name: "loans",
    stateMutability: "view",
    inputs: [{ name: "loanId", type: "uint256" }],
    outputs: [
      { name: "borrower", type: "address" },
      { name: "principal", type: "uint256" },
      { name: "rateBps", type: "uint256" },
      { name: "openedAt", type: "uint256" },
      { name: "dueAt", type: "uint256" },
      { name: "lastAccruedAt", type: "uint256" },
      { name: "accruedInterest", type: "uint256" },
      { name: "totalRepaid", type: "uint256" },
      { name: "closed", type: "bool" },
      { name: "defaulted", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "outstanding",
    stateMutability: "view",
    inputs: [{ name: "loanId", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

function toSummary(doc: GasLoanOfferDoc): GasLoanOfferSummary {
  return {
    borrower: doc.borrower as `0x${string}`,
    nonce: doc.nonce,
    principalWei: doc.principal,
    interestBps: doc.interestBps,
    dueAt: doc.dueAt,
    issuedAt: doc.issuedAt,
    expiresAt: doc.expiresAt,
    action: doc.action,
    metadataHash: doc.metadataHash as `0x${string}`,
    status: doc.status,
    txHash: doc.txHash as `0x${string}` | undefined,
    loanId: doc.loanId,
    createdAt: doc.createdAt.toISOString(),
  };
}

export async function listGasLoans(agentId: string, query: unknown): Promise<GasLoanOfferSummary[]> {
  const { status, limit } = listQuerySchema.parse(query);
  const db = getDb();
  const offers = db.collection<GasLoanOfferDoc>("gas-loan-offers");

  const filter: Record<string, unknown> = { agentId };
  if (status) filter.status = status;

  const docs = await offers.find(filter).sort({ createdAt: -1 }).limit(limit).toArray();
  return docs.map(toSummary);
}

export async function getGasLoanDetails(agentId: string, loanId: number): Promise<GasLoanDetails> {
  if (!Number.isInteger(loanId) || loanId <= 0) throw new HttpError(400, "invalid-loan-id", "loanId must be a positive integer");

  const db = getDb();
  const offers = db.collection<GasLoanOfferDoc>("gas-loan-offers");
  const doc = await offers.findOne({ agentId, loanId });
  if (!doc) throw new HttpError(404, "not-found", "gas loan not found");

  const offer = toSummary(doc);
  const alm = asAddress(env.AGENT_LOAN_MANAGER_ADDRESS);

  const [state, outstanding] = await Promise.all([
    publicClient.readContract({ address: alm, abi: agentLoanManagerAbi, functionName: "loans", args: [BigInt(loanId)] }),
    publicClient.readContract({ address: alm, abi: agentLoanManagerAbi, functionName: "outstanding", args: [BigInt(loanId)] }),
  ]);

  const [
    borrower,
    principal,
    rateBps,
    openedAt,
    dueAt,
    lastAccruedAt,
    accruedInterest,
    totalRepaid,
    closed,
    defaulted,
  ] = state;

  return {
    offer,
    onchain: {
      borrower,
      principalWei: principal.toString(),
      rateBps: Number(rateBps),
      openedAt: Number(openedAt),
      dueAt: Number(dueAt),
      lastAccruedAt: Number(lastAccruedAt),
      accruedInterestWei: accruedInterest.toString(),
      totalRepaidWei: totalRepaid.toString(),
      closed,
      defaulted,
      outstandingWei: outstanding.toString(),
    },
  };
}

