import { env } from "@/config/env.js";
import { logger } from "@/config/logger.js";
import { getDb } from "@/db/mongodb.js";
import { asAddress, publicClient } from "@/shared/viem.js";
import type { GasLoanOfferDoc } from "@/features/loans/loans.model.js";
import type { ActivityEventDoc } from "@/features/activity/activity.model.js";
import { getActivityCursor, recordActivityEvent, setActivityCursor } from "@/features/activity/activity.service.js";

const gasCursorKey = "agent-loan-manager";
const securedCursorKey = "secured-loan-manager";

type AgentContext = { agentId?: string; borrower?: string };
type SecuredLoanPositionLinkDoc = {
  positionId: number;
  loanId: number;
  borrower: string;
  agentId?: string;
  createdAt: Date;
  updatedAt: Date;
};

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

const agentLoanExecutedEventAbi = [
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

const agentLoanRepaidEventAbi = [
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

const agentLoanDefaultedEventAbi = [
  {
    type: "event",
    name: "LoanDefaulted",
    inputs: [
      { indexed: true, name: "loanId", type: "uint256" },
      { indexed: false, name: "principalWrittenOff", type: "uint256" },
    ],
  },
] as const;

const securedLoanManagerAbi = [
  {
    type: "function",
    name: "loans",
    stateMutability: "view",
    inputs: [{ name: "loanId", type: "uint256" }],
    outputs: [
      { name: "borrower", type: "address" },
      { name: "asset", type: "address" },
      { name: "principal", type: "uint256" },
      { name: "interestBps", type: "uint256" },
      { name: "collateralAsset", type: "address" },
      { name: "collateralAmount", type: "uint256" },
      { name: "openedAt", type: "uint256" },
      { name: "dueAt", type: "uint256" },
      { name: "lastAccruedAt", type: "uint256" },
      { name: "accruedInterest", type: "uint256" },
      { name: "closed", type: "bool" },
    ],
  },
] as const;

const positionManagerAbi = [
  {
    type: "function",
    name: "positions",
    stateMutability: "view",
    inputs: [{ name: "positionId", type: "uint256" }],
    outputs: [
      { name: "owner", type: "address" },
      { name: "collateralAsset", type: "address" },
      { name: "collateralAmount", type: "uint256" },
      { name: "debtAsset", type: "address" },
      { name: "debt", type: "uint256" },
      { name: "liquidated", type: "bool" },
    ],
  },
] as const;

const securedLoanOpenedEventAbi = [
  {
    type: "event",
    name: "LoanOpened",
    inputs: [
      { indexed: true, name: "loanId", type: "uint256" },
      { indexed: true, name: "positionId", type: "uint256" },
      { indexed: true, name: "borrower", type: "address" },
      { indexed: false, name: "asset", type: "address" },
      { indexed: false, name: "principal", type: "uint256" },
    ],
  },
] as const;

const securedLoanRepaidEventAbi = [
  {
    type: "event",
    name: "LoanRepaid",
    inputs: [
      { indexed: true, name: "loanId", type: "uint256" },
      { indexed: true, name: "payer", type: "address" },
      { indexed: false, name: "amount", type: "uint256" },
    ],
  },
] as const;

const collateralRemovedEventAbi = [
  {
    type: "event",
    name: "CollateralRemoved",
    inputs: [
      { indexed: true, name: "positionId", type: "uint256" },
      { indexed: false, name: "amount", type: "uint256" },
    ],
  },
] as const;

function compareLogs(a: { log: { blockNumber: bigint; logIndex: number } }, b: { log: { blockNumber: bigint; logIndex: number } }) {
  if (a.log.blockNumber === b.log.blockNumber) return a.log.logIndex - b.log.logIndex;
  return a.log.blockNumber < b.log.blockNumber ? -1 : 1;
}

async function getSyncWindow(key: string) {
  const latest = await publicClient.getBlockNumber();
  const confirmations = BigInt(env.ACTIVITY_CONFIRMATIONS);
  const safeToBlock = latest > confirmations ? latest - confirmations : 0n;

  const cursor = await getActivityCursor(key);
  const fromBlock = cursor
    ? BigInt(cursor.lastProcessedBlock + 1)
    : env.ACTIVITY_START_BLOCK !== undefined
      ? BigInt(env.ACTIVITY_START_BLOCK)
      : safeToBlock;

  if (fromBlock > safeToBlock) return null;

  return {
    fromBlock,
    toBlock: safeToBlock,
    chunkSize: BigInt(env.ACTIVITY_CHUNK_SIZE),
  };
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
  const docs = await offers.find({ loanId: { $in: loanIds } }, { projection: { loanId: 1, agentId: 1, borrower: 1 } }).toArray();
  const map = new Map<number, AgentContext>();
  for (const doc of docs) {
    if (!doc.loanId) continue;
    map.set(doc.loanId, { agentId: doc.agentId, borrower: doc.borrower });
  }
  return map;
}

async function getAgentIdByBorrower(borrower: string, cache: Map<string, string | undefined>) {
  const key = borrower.toLowerCase();
  if (cache.has(key)) return cache.get(key);

  const db = getDb();
  const events = db.collection<ActivityEventDoc>("activity-events");
  const fromEvents = await events.findOne(
    { borrower: key, agentId: { $exists: true } },
    { sort: { createdAt: -1 }, projection: { agentId: 1 } }
  );

  if (fromEvents?.agentId) {
    cache.set(key, fromEvents.agentId);
    return fromEvents.agentId;
  }

  const offers = db.collection<GasLoanOfferDoc>("gas-loan-offers");
  const fromOffers = await offers.findOne({ borrower: key }, { sort: { createdAt: -1 }, projection: { agentId: 1 } });
  const agentId = fromOffers?.agentId;
  cache.set(key, agentId);
  return agentId;
}

async function getOnchainGasBorrower(loanId: number): Promise<string | undefined> {
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

async function getOnchainSecuredBorrower(loanId: number): Promise<string | undefined> {
  if (!env.LOAN_MANAGER_ADDRESS) return undefined;
  try {
    const loanManager = asAddress(env.LOAN_MANAGER_ADDRESS);
    const state = await publicClient.readContract({
      address: loanManager,
      abi: securedLoanManagerAbi,
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

async function getOnchainPositionOwner(positionId: number): Promise<string | undefined> {
  if (!env.POSITION_MANAGER_ADDRESS) return undefined;
  try {
    const positionManager = asAddress(env.POSITION_MANAGER_ADDRESS);
    const state = await publicClient.readContract({
      address: positionManager,
      abi: positionManagerAbi,
      functionName: "positions",
      args: [BigInt(positionId)],
    });
    const owner = state?.[0];
    if (typeof owner !== "string" || !owner.startsWith("0x")) return undefined;
    return owner.toLowerCase();
  } catch {
    return undefined;
  }
}

async function upsertSecuredPositionLink(input: { positionId: number; loanId: number; borrower: string; agentId?: string }) {
  const db = getDb();
  const links = db.collection<SecuredLoanPositionLinkDoc>("secured-loan-position-links");

  const setDoc: Partial<SecuredLoanPositionLinkDoc> = {
    loanId: input.loanId,
    borrower: input.borrower.toLowerCase(),
    updatedAt: new Date(),
  };
  if (input.agentId) setDoc.agentId = input.agentId;

  await links.updateOne(
    { positionId: input.positionId },
    {
      $set: setDoc,
      $setOnInsert: {
        positionId: input.positionId,
        createdAt: new Date(),
      },
    },
    { upsert: true }
  );
}

async function getSecuredPositionLink(positionId: number) {
  const db = getDb();
  const links = db.collection<SecuredLoanPositionLinkDoc>("secured-loan-position-links");
  return await links.findOne({ positionId });
}

async function syncGasActivityOnce() {
  const window = await getSyncWindow(gasCursorKey);
  if (!window) return;

  const alm = asAddress(env.AGENT_LOAN_MANAGER_ADDRESS);

  for (let start = window.fromBlock; start <= window.toBlock; start += window.chunkSize) {
    const end = start + window.chunkSize - 1n > window.toBlock ? window.toBlock : start + window.chunkSize - 1n;

    const [executedLogs, repaidLogs, defaultedLogs] = await Promise.all([
      publicClient.getContractEvents({
        address: alm,
        abi: agentLoanExecutedEventAbi,
        eventName: "LoanExecuted",
        fromBlock: start,
        toBlock: end,
      }),
      publicClient.getContractEvents({
        address: alm,
        abi: agentLoanRepaidEventAbi,
        eventName: "LoanRepaid",
        fromBlock: start,
        toBlock: end,
      }),
      publicClient.getContractEvents({
        address: alm,
        abi: agentLoanDefaultedEventAbi,
        eventName: "LoanDefaulted",
        fromBlock: start,
        toBlock: end,
      }),
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
    ].sort(compareLogs);

    if (allLogs.length === 0) {
      await setActivityCursor(gasCursorKey, Number(end));
      continue;
    }

    const blockTimestamps = await fetchBlockTimestamps(allLogs.map((l) => l.log.blockNumber));
    const loanIds = Array.from(new Set(allLogs.map((l) => Number(l.log.args.loanId)).filter((id) => Number.isFinite(id) && id > 0)));
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
        if (args.borrower === undefined || args.principal === undefined || args.rateBps === undefined || args.dueAt === undefined || args.action === undefined) {
          continue;
        }

        const borrower = (ctx?.borrower ?? args.borrower.toLowerCase()) as string;
        await recordActivityEvent({
          type: "gas-loan.executed",
          dedupeKey: `gas-loan.executed:${txHash}`,
          agentId: ctx?.agentId,
          borrower,
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
        if (args.payer === undefined || args.amount === undefined || args.principalPaid === undefined || args.interestPaid === undefined) {
          continue;
        }

        const borrower = (ctx?.borrower ?? (await getOnchainGasBorrower(loanId))) as string | undefined;
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

      const borrower = (ctx?.borrower ?? (await getOnchainGasBorrower(loanId))) as string | undefined;
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

    await setActivityCursor(gasCursorKey, Number(end));
  }
}

async function syncSecuredActivityOnce() {
  const loanManager = env.LOAN_MANAGER_ADDRESS ? asAddress(env.LOAN_MANAGER_ADDRESS) : undefined;
  const positionManager = env.POSITION_MANAGER_ADDRESS ? asAddress(env.POSITION_MANAGER_ADDRESS) : undefined;
  if (!loanManager && !positionManager) return;

  const window = await getSyncWindow(securedCursorKey);
  if (!window) return;

  const agentIdByBorrower = new Map<string, string | undefined>();

  for (let start = window.fromBlock; start <= window.toBlock; start += window.chunkSize) {
    const end = start + window.chunkSize - 1n > window.toBlock ? window.toBlock : start + window.chunkSize - 1n;

    const [openedLogs, repaidLogs, removedLogs] = await Promise.all([
      loanManager
        ? publicClient.getContractEvents({
            address: loanManager,
            abi: securedLoanOpenedEventAbi,
            eventName: "LoanOpened",
            fromBlock: start,
            toBlock: end,
          })
        : Promise.resolve([]),
      loanManager
        ? publicClient.getContractEvents({
            address: loanManager,
            abi: securedLoanRepaidEventAbi,
            eventName: "LoanRepaid",
            fromBlock: start,
            toBlock: end,
          })
        : Promise.resolve([]),
      positionManager
        ? publicClient.getContractEvents({
            address: positionManager,
            abi: collateralRemovedEventAbi,
            eventName: "CollateralRemoved",
            fromBlock: start,
            toBlock: end,
          })
        : Promise.resolve([]),
    ]);

    type OpenedLog = (typeof openedLogs)[number];
    type RepaidLog = (typeof repaidLogs)[number];
    type RemovedLog = (typeof removedLogs)[number];

    type AnyLog =
      | { kind: "opened"; log: OpenedLog }
      | { kind: "repaid"; log: RepaidLog }
      | { kind: "collateral-removed"; log: RemovedLog };

    const allLogs: AnyLog[] = [
      ...openedLogs.map((l) => ({ kind: "opened" as const, log: l })),
      ...repaidLogs.map((l) => ({ kind: "repaid" as const, log: l })),
      ...removedLogs.map((l) => ({ kind: "collateral-removed" as const, log: l })),
    ].sort(compareLogs);

    if (allLogs.length === 0) {
      await setActivityCursor(securedCursorKey, Number(end));
      continue;
    }

    const blockTimestamps = await fetchBlockTimestamps(allLogs.map((l) => l.log.blockNumber));

    for (const item of allLogs) {
      const txHash = item.log.transactionHash;
      const blockNumber = Number(item.log.blockNumber);
      const logIndex = Number(item.log.logIndex);
      const createdAt = blockTimestamps.get(item.log.blockNumber.toString()) ?? new Date();

      if (item.kind === "opened") {
        const args = item.log.args;
        if (args.loanId === undefined || args.positionId === undefined || args.borrower === undefined || args.asset === undefined || args.principal === undefined) {
          continue;
        }

        const loanId = Number(args.loanId);
        const positionId = Number(args.positionId);
        const borrower = args.borrower.toLowerCase();
        const agentId = await getAgentIdByBorrower(borrower, agentIdByBorrower);

        await upsertSecuredPositionLink({ positionId, loanId, borrower, agentId });

        await recordActivityEvent({
          type: "secured-loan.opened",
          dedupeKey: `secured-loan.opened:${txHash}:${logIndex}`,
          agentId,
          borrower,
          loanId,
          txHash,
          blockNumber,
          logIndex,
          payload: {
            positionId,
            asset: args.asset,
            principalWei: args.principal.toString(),
          },
          createdAt,
        });
        continue;
      }

      if (item.kind === "repaid") {
        const args = item.log.args;
        if (args.loanId === undefined || args.payer === undefined || args.amount === undefined) {
          continue;
        }

        const loanId = Number(args.loanId);
        const borrower = await getOnchainSecuredBorrower(loanId);
        const agentId = borrower ? await getAgentIdByBorrower(borrower, agentIdByBorrower) : undefined;

        await recordActivityEvent({
          type: "secured-loan.repaid",
          dedupeKey: `secured-loan.repaid:${txHash}:${logIndex}`,
          agentId,
          borrower,
          loanId,
          txHash,
          blockNumber,
          logIndex,
          payload: {
            payer: args.payer,
            amountWei: args.amount.toString(),
          },
          createdAt,
        });
        continue;
      }

      const args = item.log.args;
      if (args.positionId === undefined || args.amount === undefined) continue;

      const positionId = Number(args.positionId);
      const link = await getSecuredPositionLink(positionId);
      const borrower = link?.borrower ?? (await getOnchainPositionOwner(positionId));
      const agentId = link?.agentId ?? (borrower ? await getAgentIdByBorrower(borrower, agentIdByBorrower) : undefined);

      await recordActivityEvent({
        type: "secured-loan.collateral-withdrawn",
        dedupeKey: `secured-loan.collateral-withdrawn:${txHash}:${logIndex}`,
        agentId,
        borrower,
        loanId: link?.loanId,
        txHash,
        blockNumber,
        logIndex,
        payload: {
          positionId,
          amountWei: args.amount.toString(),
        },
        createdAt,
      });
    }

    await setActivityCursor(securedCursorKey, Number(end));
  }
}

export function startActivitySync() {
  if (env.NODE_ENV === "test") return;
  if (!env.ACTIVITY_SYNC_ENABLED) return;

  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await syncGasActivityOnce();
      await syncSecuredActivityOnce();
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
