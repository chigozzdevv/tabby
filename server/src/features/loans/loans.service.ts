import { z } from "zod";
import { decodeEventLog, type Hex } from "viem";
import { getDb } from "@/db/mongodb.js";
import { env } from "@/config/env.js";
import { HttpError } from "@/shared/http-errors.js";
import { asAddress, chain, publicClient, tabbyAccount, walletClient } from "@/shared/viem.js";
import { recordActivityEvent } from "@/features/activity/activity.service.js";
import type { ActivityEventDoc } from "@/features/activity/activity.model.js";
import type {
  GasLoanExecuteRequest,
  GasLoanExecuteResponse,
  GasLoanOfferRequest,
  GasLoanOfferResponse,
} from "@/features/loans/loans.types.js";
import type { GasLoanOfferDoc, NonceCounterDoc } from "@/features/loans/loans.model.js";

const agentLoanManagerAbi = [
  {
    type: "function",
    name: "pool",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "policyRegistry",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "tabbySigner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "usedNonces",
    stateMutability: "view",
    inputs: [
      { name: "borrower", type: "address" },
      { name: "nonce", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "outstanding",
    stateMutability: "view",
    inputs: [{ name: "loanId", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
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
    name: "executeLoan",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "offer",
        type: "tuple",
        components: [
          { name: "borrower", type: "address" },
          { name: "principal", type: "uint256" },
          { name: "interestBps", type: "uint256" },
          { name: "dueAt", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "issuedAt", type: "uint256" },
          { name: "expiresAt", type: "uint256" },
          { name: "action", type: "uint256" },
          { name: "metadataHash", type: "bytes32" },
        ],
      },
      { name: "tabbySig", type: "bytes" },
      { name: "borrowerSig", type: "bytes" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;

const borrowerPolicyRegistryAbi = [
  {
    type: "function",
    name: "policies",
    stateMutability: "view",
    inputs: [{ name: "borrower", type: "address" }],
    outputs: [
      { name: "owner", type: "address" },
      { name: "maxPrincipal", type: "uint256" },
      { name: "maxInterestBps", type: "uint256" },
      { name: "maxDurationSeconds", type: "uint256" },
      { name: "allowedActions", type: "uint256" },
      { name: "enabled", type: "bool" },
    ],
  },
] as const;

const nativeLiquidityPoolAbi = [
  {
    type: "function",
    name: "totalOutstandingPrincipal",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

const principalSchema = z.string().regex(/^\d+$/);

let cachedChainNow: { timestampSeconds: number; fetchedAtMs: number } | undefined;
async function chainNowSeconds(): Promise<number> {
  const nowMs = Date.now();
  if (cachedChainNow && nowMs - cachedChainNow.fetchedAtMs < 5_000) return cachedChainNow.timestampSeconds;

  const blockNumber = await publicClient.getBlockNumber();
  const block = await publicClient.getBlock({ blockNumber });
  const timestampSeconds = Number(block.timestamp);
  if (!Number.isFinite(timestampSeconds) || timestampSeconds <= 0) throw new HttpError(502, "rpc-unavailable", "Failed to read chain timestamp");

  cachedChainNow = { timestampSeconds, fetchedAtMs: nowMs };
  return timestampSeconds;
}

async function findOnchainDefaultedGasLoanId(borrower: `0x${string}`): Promise<number | undefined> {
  const db = getDb();
  const offers = db.collection<GasLoanOfferDoc>("gas-loan-offers");

  const docs = await offers
    .find({ borrower: borrower.toLowerCase(), status: "executed", loanId: { $exists: true } }, { projection: { loanId: 1 } })
    .toArray();

  const ids = Array.from(new Set(docs.map((d) => d.loanId).filter((id): id is number => typeof id === "number" && id > 0)));
  if (ids.length === 0) return undefined;

  ids.sort((a, b) => b - a);

  const agentLoanManager = asAddress(env.AGENT_LOAN_MANAGER_ADDRESS);
  const chunkSize = 20;

  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const results = await Promise.all(
      chunk.map(async (id) => {
        const loan = await publicClient.readContract({
          address: agentLoanManager,
          abi: agentLoanManagerAbi,
          functionName: "loans",
          args: [BigInt(id)],
        });
        const [onchainBorrower] = loan;
        const defaulted = loan[9] === true;
        return {
          id,
          defaulted: defaulted && onchainBorrower.toLowerCase() === borrower.toLowerCase(),
        };
      })
    );

    const hit = results.find((r) => r.defaulted);
    if (hit) return hit.id;
  }

  return undefined;
}

async function getActiveGasLoanIds(borrower: `0x${string}`): Promise<number[]> {
  const db = getDb();
  const offers = db.collection<GasLoanOfferDoc>("gas-loan-offers");

  const filter: Record<string, unknown> = {
    borrower: borrower.toLowerCase(),
    status: "executed",
    loanId: { $exists: true },
  };

  const docs = await offers
    .find(filter, { projection: { loanId: 1 } })
    .toArray();

  const ids = Array.from(new Set(docs.map((d) => d.loanId).filter((id): id is number => typeof id === "number" && id > 0)));
  if (ids.length === 0) return [];

  const agentLoanManager = asAddress(env.AGENT_LOAN_MANAGER_ADDRESS);
  const checks = await Promise.all(
    ids.map(async (id) => {
      const outstanding = await publicClient.readContract({
        address: agentLoanManager,
        abi: agentLoanManagerAbi,
        functionName: "outstanding",
        args: [BigInt(id)],
      });
      return { id, outstanding };
    })
  );

  return checks.filter((c) => c.outstanding > 0n).map((c) => c.id);
}

async function hasActiveGasLoanByAction(borrower: `0x${string}`, action: number): Promise<boolean> {
  const db = getDb();
  const offers = db.collection<GasLoanOfferDoc>("gas-loan-offers");

  const docs = await offers
    .find(
      { borrower: borrower.toLowerCase(), status: "executed", action, loanId: { $exists: true } },
      { projection: { loanId: 1 } }
    )
    .toArray();

  const ids = Array.from(new Set(docs.map((d) => d.loanId).filter((id): id is number => typeof id === "number" && id > 0)));
  if (ids.length === 0) return false;

  const agentLoanManager = asAddress(env.AGENT_LOAN_MANAGER_ADDRESS);
  const checks = await Promise.all(
    ids.map(async (id) => {
      const outstanding = await publicClient.readContract({
        address: agentLoanManager,
        abi: agentLoanManagerAbi,
        functionName: "outstanding",
        args: [BigInt(id)],
      });
      return outstanding > 0n;
    })
  );

  return checks.some(Boolean);
}

async function getNextNonce(borrower: string): Promise<number> {
  const db = getDb();
  const counters = db.collection<NonceCounterDoc>("nonce-counters");

  const doc = await counters.findOneAndUpdate(
    { borrower },
    { $inc: { nextNonce: 1 }, $set: { updatedAt: new Date() } },
    { upsert: true, returnDocument: "after" }
  );
  const next = doc?.nextNonce ?? 1;
  return next;
}

async function enforceOnchainPolicy(borrower: `0x${string}`, interestBps: number, principal: bigint, durationSeconds: number, action: number) {
  const agentLoanManager = asAddress(env.AGENT_LOAN_MANAGER_ADDRESS);

  const policyRegistry = await publicClient.readContract({
    address: agentLoanManager,
    abi: agentLoanManagerAbi,
    functionName: "policyRegistry",
  });

  const policy = await publicClient.readContract({
    address: policyRegistry,
    abi: borrowerPolicyRegistryAbi,
    functionName: "policies",
    args: [borrower],
  });

  const [owner, maxPrincipal, maxInterestBps, maxDurationSeconds, allowedActions, enabled] = policy;
  if (owner === "0x0000000000000000000000000000000000000000") {
    throw new HttpError(403, "policy-not-set", "Borrower policy not registered");
  }
  if (!enabled) throw new HttpError(403, "policy-disabled", "Borrower policy disabled");

  if (maxPrincipal !== 0n && principal > maxPrincipal) throw new HttpError(403, "policy-violation", "principal too large");
  if (maxInterestBps !== 0n && BigInt(interestBps) > maxInterestBps) throw new HttpError(403, "policy-violation", "interest too high");
  if (maxDurationSeconds !== 0n && BigInt(durationSeconds) > maxDurationSeconds) {
    throw new HttpError(403, "policy-violation", "duration too long");
  }
  if (allowedActions !== 0n) {
    const mask = 1n << BigInt(action);
    if ((allowedActions & mask) === 0n) throw new HttpError(403, "policy-violation", "action not allowed");
  }
}

async function ensurePoolLiquidity(principal: bigint) {
  const agentLoanManager = asAddress(env.AGENT_LOAN_MANAGER_ADDRESS);
  const pool = await publicClient.readContract({ address: agentLoanManager, abi: agentLoanManagerAbi, functionName: "pool" });
  const available = await publicClient.getBalance({ address: pool });

  if (principal > available) {
    const outstanding = await publicClient.readContract({ address: pool, abi: nativeLiquidityPoolAbi, functionName: "totalOutstandingPrincipal" });
    throw new HttpError(
      409,
      "insufficient-liquidity",
      `Pool balance too low (available=${available.toString()} outstanding=${outstanding.toString()})`
    );
  }
}

async function ensureSignerMatchesContract() {
  const agentLoanManager = asAddress(env.AGENT_LOAN_MANAGER_ADDRESS);
  const onchainSigner = await publicClient.readContract({
    address: agentLoanManager,
    abi: agentLoanManagerAbi,
    functionName: "tabbySigner",
  });
  if (onchainSigner.toLowerCase() !== tabbyAccount.address.toLowerCase()) {
    throw new HttpError(500, "tabby-signer-mismatch", "TABBY_PRIVATE_KEY does not match AgentLoanManager.tabbySigner()");
  }
}

async function ensureBorrowerNotDefaulted(agentId: string, borrower: `0x${string}`) {
  const db = getDb();
  const events = db.collection<ActivityEventDoc>("activity-events");
  const doc = await events.findOne({ borrower: borrower.toLowerCase(), type: "gas-loan.defaulted" }, { projection: { _id: 1 } });
  if (doc) throw new HttpError(403, "borrower-defaulted", "Borrower has a defaulted gas loan");

  const loanId = await findOnchainDefaultedGasLoanId(borrower);
  if (!loanId) return;

  await recordActivityEvent({
    type: "gas-loan.defaulted",
    dedupeKey: `gas-loan.defaulted:onchain:${env.CHAIN_ID}:${env.AGENT_LOAN_MANAGER_ADDRESS.toLowerCase()}:${loanId}`,
    agentId,
    borrower: borrower.toLowerCase(),
    loanId,
    payload: { source: "onchain-state" },
  });

  throw new HttpError(403, "borrower-defaulted", "Borrower has a defaulted gas loan");
}

export async function createGasLoanOffer(agentId: string, input: GasLoanOfferRequest): Promise<GasLoanOfferResponse> {
  const borrower = asAddress(input.borrower);
  principalSchema.parse(input.principalWei);
  if (!Number.isFinite(input.interestBps) || input.interestBps < 0) throw new HttpError(400, "invalid-interest", "interestBps invalid");
  if (!Number.isFinite(input.durationSeconds) || input.durationSeconds <= 0) throw new HttpError(400, "invalid-duration", "durationSeconds invalid");
  if (!Number.isFinite(input.action) || input.action < 0) throw new HttpError(400, "invalid-action", "action invalid");

  await ensureBorrowerNotDefaulted(agentId, borrower);

  const principal = BigInt(input.principalWei);
  if (principal <= 0n) throw new HttpError(400, "invalid-principal", "principal must be greater than 0");
  const issuedAt = await chainNowSeconds();
  const dueAt = issuedAt + Math.floor(input.durationSeconds);
  const offerTtl = input.offerTtlSeconds ?? 300;
  const expiresAt = issuedAt + Math.max(1, Math.floor(offerTtl));

  const metadataHash = (input.metadataHash ?? "0x0000000000000000000000000000000000000000000000000000000000000000") as `0x${string}`;

  await ensureSignerMatchesContract();
  await enforceOnchainPolicy(borrower, input.interestBps, principal, input.durationSeconds, input.action);
  await ensurePoolLiquidity(principal);

  if (!env.GAS_LOAN_ALLOW_MULTIPLE_ACTIVE) {
    const activeLoanIds = await getActiveGasLoanIds(borrower);
    const hasActive = activeLoanIds.length > 0;

    if (input.action === env.REPAY_GAS_ACTION_ID) {
      if (!hasActive) {
        throw new HttpError(409, "no-active-loan", "repay-gas is only allowed when there is an active gas loan");
      }
      const hasActiveRepayGas = await hasActiveGasLoanByAction(borrower, env.REPAY_GAS_ACTION_ID);
      if (hasActiveRepayGas) {
        throw new HttpError(409, "repay-gas-active", "repay-gas already active for this borrower");
      }
      if (principal > BigInt(env.REPAY_GAS_MAX_PRINCIPAL_WEI)) {
        throw new HttpError(403, "repay-gas-too-large", "repay-gas principal too large");
      }
      if (input.durationSeconds > env.REPAY_GAS_MAX_DURATION_SECONDS) {
        throw new HttpError(403, "repay-gas-too-long", "repay-gas duration too long");
      }
    } else if (hasActive) {
      throw new HttpError(409, "active-loan", "borrower has an active gas loan");
    }
  }

  const nonce = await getNextNonce(borrower.toLowerCase());

  const offer = {
    borrower,
    principal,
    interestBps: BigInt(input.interestBps),
    dueAt: BigInt(dueAt),
    nonce: BigInt(nonce),
    issuedAt: BigInt(issuedAt),
    expiresAt: BigInt(expiresAt),
    action: BigInt(input.action),
    metadataHash,
  } as const;

  const signature = await walletClient.signTypedData({
    account: tabbyAccount,
    domain: {
      name: "TabbyAgentLoan",
      version: "1",
      chainId: chain.id,
      verifyingContract: asAddress(env.AGENT_LOAN_MANAGER_ADDRESS),
    },
    types: {
      LoanOffer: [
        { name: "borrower", type: "address" },
        { name: "principal", type: "uint256" },
        { name: "interestBps", type: "uint256" },
        { name: "dueAt", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "issuedAt", type: "uint256" },
        { name: "expiresAt", type: "uint256" },
        { name: "action", type: "uint256" },
        { name: "metadataHash", type: "bytes32" },
      ],
    },
    primaryType: "LoanOffer",
    message: offer,
  });

  const db = getDb();
  const offers = db.collection<GasLoanOfferDoc>("gas-loan-offers");
  await offers.insertOne({
    borrower: borrower.toLowerCase(),
    agentId,
    nonce,
    principal: principal.toString(),
    interestBps: input.interestBps,
    dueAt,
    issuedAt,
    expiresAt,
    action: input.action,
    metadataHash,
    tabbySignature: signature,
    status: "issued",
    createdAt: new Date(),
  });

  await recordActivityEvent({
    type: "gas-loan.offer-created",
    dedupeKey: `gas-loan.offer-created:${borrower.toLowerCase()}:${nonce}`,
    agentId,
    borrower: borrower.toLowerCase(),
    payload: {
      borrower,
      nonce,
      principalWei: principal.toString(),
      interestBps: input.interestBps,
      issuedAt,
      dueAt,
      expiresAt,
      action: input.action,
      metadataHash,
    },
  });

  return {
    offer: {
      borrower,
      principal: principal.toString(),
      interestBps: input.interestBps,
      dueAt,
      nonce,
      issuedAt,
      expiresAt,
      action: input.action,
      metadataHash,
    },
    tabbySigner: tabbyAccount.address,
    tabbySignature: signature,
    chainId: chain.id,
    agentLoanManager: asAddress(env.AGENT_LOAN_MANAGER_ADDRESS),
  };
}

const loanExecutedEventAbi = [
  {
    type: "event",
    name: "LoanExecuted",
    inputs: [
      { indexed: true, name: "loanId", type: "uint256" },
      { indexed: true, name: "borrower", type: "address" },
      { indexed: false, name: "principal", type: "uint256" },
      { indexed: false, name: "rateBps", type: "uint256" },
      { indexed: false, name: "dueAt", type: "uint256" },
      { indexed: false, name: "action", type: "uint256" },
    ],
  },
] as const;

export async function executeGasLoanOffer(agentId: string, input: GasLoanExecuteRequest): Promise<GasLoanExecuteResponse> {
  const borrower = asAddress(input.borrower);
  if (!Number.isInteger(input.nonce) || input.nonce <= 0) throw new HttpError(400, "invalid-nonce", "nonce must be a positive integer");

  const now = await chainNowSeconds();
  const db = getDb();
  const offers = db.collection<GasLoanOfferDoc>("gas-loan-offers");
  const baseDoc = await offers.findOne({ borrower: borrower.toLowerCase(), nonce: input.nonce });

  if (!baseDoc) throw new HttpError(404, "offer-not-found", "Offer not found");
  if (baseDoc.agentId !== agentId) throw new HttpError(403, "forbidden", "Offer does not belong to this agent");
  if (baseDoc.status === "executed") {
    return { txHash: baseDoc.txHash as Hex, loanId: baseDoc.loanId };
  }
  if (baseDoc.status === "executing") throw new HttpError(409, "offer-in-progress", "Offer is already executing");
  if (baseDoc.status !== "issued" && baseDoc.status !== "failed") {
    throw new HttpError(409, "offer-not-issuable", `Offer status is ${baseDoc.status}`);
  }

  if (baseDoc.expiresAt <= now) {
    await offers.updateOne({ _id: baseDoc._id }, { $set: { status: "expired" } });
    await recordActivityEvent({
      type: "gas-loan.offer-expired",
      dedupeKey: `gas-loan.offer-expired:${baseDoc.borrower}:${baseDoc.nonce}`,
      agentId,
      borrower: baseDoc.borrower,
      payload: { borrower, nonce: baseDoc.nonce, expiresAt: baseDoc.expiresAt },
    });
    throw new HttpError(410, "offer-expired", "Offer expired");
  }

  const locked = await offers.findOneAndUpdate(
    { _id: baseDoc._id, status: { $in: ["issued", "failed"] } },
    { $set: { status: "executing", executingAt: new Date() }, $unset: { lastError: "", failedAt: "" } },
    { returnDocument: "after" }
  );
  const offerDoc = locked ?? null;
  if (!offerDoc) {
    const current = await offers.findOne({ _id: baseDoc._id });
    if (current?.status === "executed") {
      return { txHash: current.txHash as Hex, loanId: current.loanId };
    }
    if (current?.status === "executing") throw new HttpError(409, "offer-in-progress", "Offer is already executing");
    throw new HttpError(409, "offer-not-issuable", `Offer status is ${current?.status ?? "unknown"}`);
  }
  const agentLoanManager = asAddress(env.AGENT_LOAN_MANAGER_ADDRESS);
  const alreadyUsed = await publicClient.readContract({
    address: agentLoanManager,
    abi: agentLoanManagerAbi,
    functionName: "usedNonces",
    args: [borrower, BigInt(offerDoc.nonce)],
  });
  if (alreadyUsed) {
    await offers.updateOne({ _id: offerDoc._id }, { $set: { status: "executed" } });
    throw new HttpError(409, "nonce-already-used", "Nonce already used onchain");
  }

  const offer = {
    borrower,
    principal: BigInt(offerDoc.principal),
    interestBps: BigInt(offerDoc.interestBps),
    dueAt: BigInt(offerDoc.dueAt),
    nonce: BigInt(offerDoc.nonce),
    issuedAt: BigInt(offerDoc.issuedAt),
    expiresAt: BigInt(offerDoc.expiresAt),
    action: BigInt(offerDoc.action),
    metadataHash: offerDoc.metadataHash as Hex,
  } as const;

  let txHash: Hex;
  try {
    txHash = await walletClient.writeContract({
      address: agentLoanManager,
      abi: agentLoanManagerAbi,
      functionName: "executeLoan",
      args: [offer, offerDoc.tabbySignature as Hex, input.borrowerSignature as Hex],
      account: tabbyAccount,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await offers.updateOne(
      { _id: offerDoc._id },
      { $set: { status: "failed", lastError: message, failedAt: new Date() }, $unset: { executingAt: "" } }
    );
    throw error;
  }

  let receipt;
  try {
    receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await offers.updateOne(
      { _id: offerDoc._id },
      { $set: { status: "failed", lastError: message, failedAt: new Date() }, $unset: { executingAt: "" } }
    );
    throw error;
  }

  if (receipt.status !== "success") {
    await offers.updateOne(
      { _id: offerDoc._id },
      { $set: { status: "failed", lastError: "transaction-reverted", failedAt: new Date() }, $unset: { executingAt: "" } }
    );
    throw new HttpError(502, "execute-reverted", "Loan execution reverted");
  }

  let loanId: number | undefined;
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({ abi: loanExecutedEventAbi, data: log.data, topics: log.topics });
      if (decoded.eventName === "LoanExecuted") {
        loanId = Number(decoded.args.loanId);
      }
    } catch {
      continue;
    }
  }

  await offers.updateOne(
    { _id: offerDoc._id },
    {
      $set: { status: "executed", txHash: txHash, loanId: loanId, executedAt: new Date() },
      $unset: { executingAt: "", lastError: "", failedAt: "" },
    }
  );

  await recordActivityEvent({
    type: "gas-loan.executed",
    dedupeKey: `gas-loan.executed:${txHash}`,
    agentId,
    borrower: borrower.toLowerCase(),
    loanId,
    txHash,
    payload: { borrower, nonce: offerDoc.nonce, loanId },
  });

  return { txHash, loanId };
}
