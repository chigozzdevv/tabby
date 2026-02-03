import { env } from "@/config/env.js";
import { logger } from "@/config/logger.js";
import { getDb } from "@/db/mongodb.js";
import { asAddress, publicClient } from "@/shared/viem.js";
import type { GasLoanOfferDoc } from "@/features/loans/loans.model.js";
import { getActivityCursor, recordActivityEvent, setActivityCursor } from "@/features/activity/activity.service.js";

const cursorKey = "agent-loan-manager";

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
] as const;

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

const loanRepaidEventAbi = [
  {
    type: "event",
    name: "LoanRepaid",
    inputs: [
      { indexed: true, name: "loanId", type: "uint256" },
      { indexed: true, name: "payer", type: "address" },
      { indexed: false, name: "amount", type: "uint256" },
      { indexed: false, name: "principalPaid", type: "uint256" },
      { indexed: false, name: "interestPaid", type: "uint256" },
    ],
  },
] as const;

const loanDefaultedEventAbi = [
  {
    type: "event",
    name: "LoanDefaulted",
    inputs: [
      { indexed: true, name: "loanId", type: "uint256" },
      { indexed: false, name: "principalWrittenOff", type: "uint256" },
    ],
  },
] as const;

async function getOnchainBorrower(loanId: number): Promise<string | undefined> {
  try {
    const alm = asAddress(env.AGENT_LOAN_MANAGER_ADDRESS);
    const state = await publicClient.readContract({
      address: alm,
      abi: agentLoanManagerAbi,
      functionName: "loans",
      args: [BigInt(loanId)],
    });
    const borrower = state?.[0];
    if (typeof borrower !== "string" || !borrower.startsWith("0x")) return undefined;
    return borrower.toLowerCase();
  } catch {
    return undefined;
  }
}

async function fetchBlockTimestamps(blockNumbers: bigint[]) {
  const unique = Array.from(new Set(blockNumbers.map((b) => b.toString()))).map((s) => BigInt(s));
  const blocks = await Promise.all(unique.map((bn) => publicClient.getBlock({ blockNumber: bn })));
  const map = new Map<string, Date>();
  for (let i = 0; i < unique.length; i++) {
    map.set(unique[i]!.toString(), new Date(Number(blocks[i]!.timestamp) * 1000));
  }
  return map;
}

async function getAgentContextByLoanId(loanIds: number[]) {
  const db = getDb();
  const offers = db.collection<GasLoanOfferDoc>("gas-loan-offers");
  const docs = await offers
    .find({ loanId: { $in: loanIds } }, { projection: { loanId: 1, agentId: 1, borrower: 1 } })
    .toArray();
  const map = new Map<number, { agentId?: string; borrower?: string }>();
  for (const doc of docs) {
    if (!doc.loanId) continue;
    map.set(doc.loanId, { agentId: doc.agentId, borrower: doc.borrower });
  }
  return map;
}

async function syncOnce() {
  const alm = asAddress(env.AGENT_LOAN_MANAGER_ADDRESS);

  const latest = await publicClient.getBlockNumber();
  const safeToBlock = latest > BigInt(env.ACTIVITY_CONFIRMATIONS) ? latest - BigInt(env.ACTIVITY_CONFIRMATIONS) : 0n;

  const cursor = await getActivityCursor(cursorKey);
  let fromBlock = cursor ? BigInt(cursor.lastProcessedBlock + 1) : env.ACTIVITY_START_BLOCK !== undefined ? BigInt(env.ACTIVITY_START_BLOCK) : safeToBlock;
  if (fromBlock > safeToBlock) return;

  const toBlock = safeToBlock;

  const [executedLogs, repaidLogs, defaultedLogs] = await Promise.all([
    publicClient.getContractEvents({ address: alm, abi: loanExecutedEventAbi, eventName: "LoanExecuted", fromBlock, toBlock }),
    publicClient.getContractEvents({ address: alm, abi: loanRepaidEventAbi, eventName: "LoanRepaid", fromBlock, toBlock }),
    publicClient.getContractEvents({ address: alm, abi: loanDefaultedEventAbi, eventName: "LoanDefaulted", fromBlock, toBlock }),
  ]);

  type ExecutedLog = (typeof executedLogs)[number];
  type RepaidLog = (typeof repaidLogs)[number];
  type DefaultedLog = (typeof defaultedLogs)[number];

  type AnyLog =
    | { kind: "executed"; log: ExecutedLog }
    | { kind: "repaid"; log: RepaidLog }
    | { kind: "defaulted"; log: DefaultedLog };

  const allLogs: AnyLog[] = [
    ...executedLogs.map((l) => ({ kind: "executed" as const, log: l })),
    ...repaidLogs.map((l) => ({ kind: "repaid" as const, log: l })),
    ...defaultedLogs.map((l) => ({ kind: "defaulted" as const, log: l })),
  ];

  if (allLogs.length === 0) {
    await setActivityCursor(cursorKey, Number(toBlock));
    return;
  }

  const blockTimestamps = await fetchBlockTimestamps(allLogs.map((l) => l.log.blockNumber));

  const loanIds = Array.from(
    new Set(
      allLogs.map((l) => Number(l.log.args.loanId)).filter((id) => Number.isFinite(id) && id > 0)
    )
  );
  const contextByLoanId = await getAgentContextByLoanId(loanIds);

  for (const item of allLogs) {
    const txHash = item.log.transactionHash;
    const blockNumber = Number(item.log.blockNumber);
    const logIndex = Number(item.log.logIndex);
    const createdAt = blockTimestamps.get(item.log.blockNumber.toString()) ?? new Date();

    const loanIdRaw = item.log.args.loanId;
    if (loanIdRaw === undefined) continue;
    const loanId = Number(loanIdRaw);
    const ctx = contextByLoanId.get(loanId);

    if (item.kind === "executed") {
      const args = item.log.args;
      if (
        args.borrower === undefined ||
        args.principal === undefined ||
        args.rateBps === undefined ||
        args.dueAt === undefined ||
        args.action === undefined
      ) {
        continue;
      }

      const borrower = (ctx?.borrower ?? args.borrower.toLowerCase()) as string;
      await recordActivityEvent({
        type: "gas-loan.executed",
        dedupeKey: `gas-loan.executed:${txHash}`,
        agentId: ctx?.agentId,
        borrower: borrower,
        loanId,
        txHash,
        blockNumber,
        logIndex,
        payload: {
          borrower: args.borrower,
          principalWei: args.principal.toString(),
          rateBps: Number(args.rateBps),
          dueAt: Number(args.dueAt),
          action: Number(args.action),
        },
        createdAt,
      });
      continue;
    }

    if (item.kind === "repaid") {
      const args = item.log.args;
      if (
        args.payer === undefined ||
        args.amount === undefined ||
        args.principalPaid === undefined ||
        args.interestPaid === undefined
      ) {
        continue;
      }

      const borrower = (ctx?.borrower ?? (await getOnchainBorrower(loanId))) as string | undefined;
      await recordActivityEvent({
        type: "gas-loan.repaid",
        dedupeKey: `gas-loan.repaid:${txHash}:${logIndex}`,
        agentId: ctx?.agentId,
        borrower,
        loanId,
        txHash,
        blockNumber,
        logIndex,
        payload: {
          payer: args.payer,
          amountWei: args.amount.toString(),
          principalPaidWei: args.principalPaid.toString(),
          interestPaidWei: args.interestPaid.toString(),
        },
        createdAt,
      });
      continue;
    }

    const args = item.log.args;
    if (args.principalWrittenOff === undefined) continue;

    const borrower = (ctx?.borrower ?? (await getOnchainBorrower(loanId))) as string | undefined;
    await recordActivityEvent({
      type: "gas-loan.defaulted",
      dedupeKey: `gas-loan.defaulted:${txHash}:${logIndex}`,
      agentId: ctx?.agentId,
      borrower,
      loanId,
      txHash,
      blockNumber,
      logIndex,
      payload: { principalWrittenOffWei: args.principalWrittenOff.toString() },
      createdAt,
    });
  }

  await setActivityCursor(cursorKey, Number(toBlock));
}

export function startActivitySync() {
  if (env.NODE_ENV === "test") return;
  if (!env.ACTIVITY_SYNC_ENABLED) return;

  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await syncOnce();
    } catch (error) {
      logger.error({ error }, "activity-sync-failed");
    } finally {
      running = false;
    }
  };

  void tick();
  setInterval(() => void tick(), env.ACTIVITY_POLL_INTERVAL_MS);
  logger.info(
    {
      pollMs: env.ACTIVITY_POLL_INTERVAL_MS,
      confirmations: env.ACTIVITY_CONFIRMATIONS,
      startBlock: env.ACTIVITY_START_BLOCK,
    },
    "activity-sync-started"
  );
}
