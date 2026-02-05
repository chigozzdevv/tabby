#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { createPublicClient, createWalletClient, formatEther, http } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { getEnv } from "../env.js";

type LastGasLoan = {
  loanId: number;
  borrower: string;
  principalWei: string;
  interestBps: number;
  dueAt: number;
  action: number;
};

type BorrowerState = {
  chainId?: number;
  agentLoanManager?: string;
  trackedGasLoanIds?: number[];
  lastReminderAt?: number;
  lastLowGasAt?: number;
  lastGasLoan?: Partial<LastGasLoan>;
};

type GasLoanState = {
  loanId: number;
  borrower: string;
  principalWei: string;
  rateBps: number;
  openedAt: number;
  dueAt: number;
  lastAccruedAt: number;
  accruedInterestWei: string;
  totalRepaidWei: string;
  closed: boolean;
  defaulted: boolean;
  outstandingWei: string;
};

function parseDotEnv(content) {
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

async function loadLocalEnv() {
  const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env");
  try {
    const raw = await fs.readFile(envPath, "utf8");
    parseDotEnv(raw);
  } catch {
    return;
  }
}

await loadLocalEnv();
const ENV = getEnv();

function usage() {
  console.log(
    [
      "tabby-borrower <command>",
      "",
      "Commands:",
      "  init-wallet",
      "  request-gas-loan --principal-wei <wei> --interest-bps <bps> --duration-seconds <sec> --action <n> [--borrower <0x...>] [--metadata-hash <0x...>]",
      "  status --loan-id <id>",
      "  repay-gas-loan --loan-id <id> [--amount-wei <wei>]",
      "  next-due [--borrower <0x...>]",
      "  heartbeat [--borrower <0x...>] [--quiet-ok] [--json]",
      "",
      "Env:",
      "  TABBY_API_BASE_URL   (default: http://localhost:3000)",
      "  MOLTBOOK_API_KEY     (required to auto-mint identity token)",
      "  MOLTBOOK_AUDIENCE    (optional)",
      "  MONAD_CHAIN_ID / CHAIN_ID   (optional; defaults to 10143 unless returned by Tabby or cached)",
      "  MONAD_RPC_URL / RPC_URL     (optional; defaults to https://testnet-rpc.monad.xyz or https://rpc.monad.xyz)",
      "  AGENT_LOAN_MANAGER_ADDRESS         (optional; overrides cached/public config)",
      "  TABBY_REMIND_SECONDS                (optional; default: 3600)",
      "  TABBY_REMIND_REPEAT_SECONDS         (optional; default: 21600)",
      "  TABBY_MIN_REPAY_GAS_WEI             (optional; default: 1000000000000000)",
    ].join("\n")
  );
}

function getArg(name) {
  const idx = process.argv.findIndex((a) => a === name || a.startsWith(`${name}=`));
  if (idx === -1) return undefined;
  const arg = process.argv[idx];
  if (arg.includes("=")) return arg.split("=").slice(1).join("=");
  return process.argv[idx + 1];
}

function requireEnv(name) {
  const v = ENV[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

function baseUrl() {
  const value = ENV.TABBY_API_BASE_URL;
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  const isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (!isLocal && url.protocol !== "https:") {
    throw new Error("TABBY_API_BASE_URL must use https for non-local hosts");
  }
  return value;
}

async function statePath() {
  return path.join(os.homedir(), ".config", "tabby-borrower", "state.json");
}

async function loadState(): Promise<BorrowerState & { path: string }> {
  const p = await statePath();
  const raw = await fs.readFile(p, "utf8");
  const schema = z
    .object({
      chainId: z.number().int().positive().optional(),
      agentLoanManager: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
      trackedGasLoanIds: z.array(z.number().int().positive()).optional(),
      lastReminderAt: z.number().int().positive().optional(),
      lastLowGasAt: z.number().int().positive().optional(),
      lastGasLoan: z
        .object({
          loanId: z.number().int().positive(),
          borrower: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
          principalWei: z.string().regex(/^\d+$/),
          interestBps: z.number().int().min(0),
          dueAt: z.number().int().positive(),
          action: z.number().int().min(0).max(255),
        })
        .optional(),
    })
    .passthrough();
  const parsed = schema.parse(JSON.parse(raw)) as BorrowerState;
  return { ...parsed, path: p };
}

async function tryLoadState(): Promise<(BorrowerState & { path: string }) | undefined> {
  try {
    return await loadState();
  } catch {
    return undefined;
  }
}

async function updateState(patch: Partial<BorrowerState>) {
  const p = await statePath();
  await ensureDir(path.dirname(p));
  let existing: BorrowerState = {};
  try {
    const raw = await fs.readFile(p, "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) existing = parsed;
  } catch {
    existing = {};
  }
  const next = { ...existing, ...patch };
  await fs.writeFile(p, JSON.stringify(next, null, 2), { encoding: "utf8", mode: 0o600 });
  await fs.chmod(p, 0o600);
  return { path: p };
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function walletPath() {
  return path.join(os.homedir(), ".config", "tabby-borrower", "wallet.json");
}

async function loadWallet() {
  const p = await walletPath();
  const raw = await fs.readFile(p, "utf8");
  const schema = z.object({
    address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    privateKey: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  });
  const parsed = schema.parse(JSON.parse(raw));
  return { ...parsed, path: p };
}

async function saveWallet(privateKey) {
  const account = privateKeyToAccount(privateKey);
  const p = await walletPath();
  await ensureDir(path.dirname(p));
  await fs.writeFile(p, JSON.stringify({ address: account.address, privateKey }, null, 2), { encoding: "utf8", mode: 0o600 });
  await fs.chmod(p, 0o600);
  return { address: account.address, path: p };
}

async function mintIdentityToken() {
  const apiKey = requireEnv("MOLTBOOK_API_KEY");
  const audience = ENV.MOLTBOOK_AUDIENCE;

  const res = await fetch("https://www.moltbook.com/api/v1/agents/me/identity-token", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify(audience ? { audience } : {}),
  });
  if (!res.ok) throw new Error(`moltbook identity-token failed (${res.status})`);
  const json = await res.json();
  const token = json?.identity_token;
  if (typeof token !== "string" || token.length === 0) throw new Error("moltbook identity-token missing in response");
  return token;
}

function defaultRpcUrl(chainId) {
  if (chainId === 10143) return "https://testnet-rpc.monad.xyz";
  if (chainId === 143) return "https://rpc.monad.xyz";
  return undefined;
}

async function chainNowSeconds(publicClient) {
  const blockNumber = await publicClient.getBlockNumber();
  const block = await publicClient.getBlock({ blockNumber });
  const timestampSeconds = Number(block.timestamp);
  if (!Number.isFinite(timestampSeconds) || timestampSeconds <= 0) {
    throw new Error("Failed to read chain timestamp");
  }
  return timestampSeconds;
}

function formatSeconds(seconds) {
  const abs = Math.abs(seconds);
  const sign = seconds < 0 ? "-" : "";
  if (abs < 60) return `${sign}${abs}s`;
  if (abs < 3600) return `${sign}${Math.floor(abs / 60)}m`;
  if (abs < 86400) return `${sign}${Math.floor(abs / 3600)}h`;
  return `${sign}${Math.floor(abs / 86400)}d`;
}

async function fetchNextDueFromServer(borrower: string) {
  const url = new URL("/public/monitoring/gas-loans/next-due", baseUrl());
  url.searchParams.set("borrower", borrower);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`public next-due failed (${res.status})`);
  const json = await res.json();
  if (!json?.ok) throw new Error("public next-due invalid response");
  if (!json?.data) return undefined;
  const schema = z.object({
    loanId: z.number().int().positive(),
    dueAt: z.number().int().positive(),
    outstandingWei: z.string().regex(/^\d+$/),
  });
  return schema.parse(json.data);
}

async function fetchTabbyPublicConfig() {
  try {
    const res = await fetch(new URL("/public/config", baseUrl()));
    if (!res.ok) return undefined;
    const json = await res.json();
    const data = json?.data;
    if (!json?.ok) return undefined;
    const schema = z.object({
      chainId: z.number().int().positive(),
      agentLoanManager: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    });
    return schema.parse(data);
  } catch {
    return undefined;
  }
}

async function getChainConfigFromStateOrEnv() {
  const chainIdEnv = ENV.MONAD_CHAIN_ID ?? ENV.CHAIN_ID;
  const rpcUrlEnv = ENV.MONAD_RPC_URL ?? ENV.RPC_URL;
  const agentLoanManagerEnv = ENV.AGENT_LOAN_MANAGER_ADDRESS;

  const publicConfig = await fetchTabbyPublicConfig();

  let state: BorrowerState | undefined;
  try {
    state = await loadState();
  } catch {
    state = undefined;
  }

  const chainId = chainIdEnv ?? publicConfig?.chainId ?? state?.chainId ?? 10143;
  if (!Number.isInteger(chainId) || chainId <= 0) throw new Error("Invalid MONAD_CHAIN_ID");

  const rpcUrl = rpcUrlEnv ?? defaultRpcUrl(chainId);
  if (!rpcUrl) throw new Error("Missing MONAD_RPC_URL");

  const agentLoanManager = agentLoanManagerEnv ?? publicConfig?.agentLoanManager ?? state?.agentLoanManager;
  if (!agentLoanManager) {
    throw new Error(
      "Missing agentLoanManager; set AGENT_LOAN_MANAGER_ADDRESS, or ensure /public/config is reachable, or add it to ~/.config/tabby-borrower/state.json"
    );
  }

  const chain = {
    id: chainId,
    name: chainId === 143 ? "Monad Mainnet" : "Monad Testnet",
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  };

  return { chain, rpcUrl, agentLoanManager };
}

async function resolveBorrowerAddress() {
  const borrowerArg = getArg("--borrower");
  if (borrowerArg) return borrowerArg;

  try {
    const w = await loadWallet();
    return w.address;
  } catch {
    // ignore
  }

  const state = await tryLoadState();
  if (state?.lastGasLoan?.borrower) return state.lastGasLoan.borrower;

  throw new Error("Missing --borrower (or run init-wallet first)");
}

async function fetchExecutedLoanIdsFromServer(borrower: string): Promise<number[]> {
  const url = new URL("/public/monitoring/gas-loans", baseUrl());
  url.searchParams.set("borrower", borrower);
  url.searchParams.set("status", "executed");
  url.searchParams.set("limit", "200");

  const res = await fetch(url);
  if (!res.ok) throw new Error(`public monitoring list failed (${res.status})`);
  const json = await res.json();
  if (!json?.ok || !Array.isArray(json?.data)) throw new Error("public monitoring list invalid response");

  const ids = json.data
    .map((d) => d?.loanId)
    .filter((id) => typeof id === "number" && Number.isInteger(id) && id > 0);
  return Array.from(new Set(ids));
}

const agentLoanManagerReadAbi = [
  {
    type: "function",
    name: "gracePeriodSeconds",
    stateMutability: "view",
    inputs: [],
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
    name: "outstanding",
    stateMutability: "view",
    inputs: [{ name: "loanId", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
];

async function readGasLoanState(publicClient: any, agentLoanManager: string, loanId: number): Promise<GasLoanState> {
  const id = BigInt(loanId);
  const [loan, outstanding] = await Promise.all([
    publicClient.readContract({ address: agentLoanManager, abi: agentLoanManagerReadAbi, functionName: "loans", args: [id] }),
    publicClient.readContract({ address: agentLoanManager, abi: agentLoanManagerReadAbi, functionName: "outstanding", args: [id] }),
  ]);

  return {
    loanId,
    borrower: loan[0],
    principalWei: loan[1].toString(),
    rateBps: Number(loan[2]),
    openedAt: Number(loan[3]),
    dueAt: Number(loan[4]),
    lastAccruedAt: Number(loan[5]),
    accruedInterestWei: loan[6].toString(),
    totalRepaidWei: loan[7].toString(),
    closed: loan[8],
    defaulted: loan[9],
    outstandingWei: outstanding.toString(),
  };
}

async function heartbeat() {
  const quietOk = process.argv.includes("--quiet-ok");
  const jsonOut = process.argv.includes("--json");

  const borrower = await resolveBorrowerAddress();
  if (!/^0x[a-fA-F0-9]{40}$/.test(borrower)) throw new Error("Invalid borrower address");

  const state: BorrowerState = (await tryLoadState()) ?? {};
  const { chain, rpcUrl, agentLoanManager } = await getChainConfigFromStateOrEnv();
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) }) as any;

  const now = await chainNowSeconds(publicClient);
  const graceSecondsRaw = await publicClient.readContract({
    address: agentLoanManager,
    abi: agentLoanManagerReadAbi,
    functionName: "gracePeriodSeconds",
  });
  const graceSeconds = Number(graceSecondsRaw);

  const remindSeconds = ENV.TABBY_REMIND_SECONDS ?? 3600;
  const repeatSeconds = ENV.TABBY_REMIND_REPEAT_SECONDS ?? 21600;
  const minRepayGasWei = BigInt(ENV.TABBY_MIN_REPAY_GAS_WEI ?? "1000000000000000");

  let nextDue: Awaited<ReturnType<typeof fetchNextDueFromServer>> | undefined = undefined;
  try {
    nextDue = await fetchNextDueFromServer(borrower);
  } catch {
    nextDue = undefined;
  }

  let loanState: GasLoanState | undefined = undefined;
  if (nextDue) {
    loanState = await readGasLoanState(publicClient, agentLoanManager, nextDue.loanId);
  } else {
    let loanIds = Array.isArray(state.trackedGasLoanIds) ? state.trackedGasLoanIds.filter((n) => Number.isInteger(n) && n > 0) : [];
    if (state.lastGasLoan?.loanId && !loanIds.includes(state.lastGasLoan.loanId)) loanIds.push(state.lastGasLoan.loanId);
    if (loanIds.length === 0) {
      try {
        loanIds = await fetchExecutedLoanIdsFromServer(borrower);
      } catch {
        loanIds = [];
      }
    }
    loanIds = Array.from(new Set(loanIds)).sort((a, b) => a - b);

    const loanStates = await Promise.all(loanIds.map(async (id) => await readGasLoanState(publicClient, agentLoanManager, id)));
    const relevant = loanStates.filter((l) => l.borrower?.toLowerCase?.() === borrower.toLowerCase());
    const active = relevant.filter((l) => !l.closed && !l.defaulted && BigInt(l.outstandingWei) > 0n);
    if (active.length > 0) {
      loanState = active.sort((a, b) => a.dueAt - b.dueAt)[0];
    }
  }

  if (!loanState || BigInt(loanState.outstandingWei) === 0n || loanState.closed || loanState.defaulted) {
    if (!quietOk) console.log("Tabby: no active gas loans.");
    return;
  }

  const balanceWei = await publicClient.getBalance({ address: borrower });
  const dueInSeconds = loanState.dueAt - now;
  const isOverdue = dueInSeconds <= 0;
  const graceEndsAt = loanState.dueAt + (Number.isFinite(graceSeconds) && graceSeconds >= 0 ? graceSeconds : 0);
  const isDefaultEligible = now > graceEndsAt;

  const lastReminderAt = Number.isInteger(state.lastReminderAt) ? state.lastReminderAt : 0;
  const lastLowGasAt = Number.isInteger(state.lastLowGasAt) ? state.lastLowGasAt : 0;

  const alerts = [];
  if (isDefaultEligible) {
    if (now - lastReminderAt >= repeatSeconds) {
      alerts.push({
        type: "defaultEligible",
        loanId: loanState.loanId,
        dueAt: loanState.dueAt,
        overdueSeconds: now - loanState.dueAt,
        outstandingWei: loanState.outstandingWei,
      });
    }
  } else if (isOverdue) {
    if (now - lastReminderAt >= repeatSeconds) {
      alerts.push({
        type: "overdue",
        loanId: loanState.loanId,
        dueAt: loanState.dueAt,
        overdueSeconds: now - loanState.dueAt,
        outstandingWei: loanState.outstandingWei,
      });
    }
  } else if (dueInSeconds <= remindSeconds) {
    if (now - lastReminderAt >= repeatSeconds) {
      alerts.push({
        type: "dueSoon",
        loanId: loanState.loanId,
        dueAt: loanState.dueAt,
        dueInSeconds,
        outstandingWei: loanState.outstandingWei,
      });
    }
  }

  if (alerts.length > 0 && balanceWei < minRepayGasWei && now - lastLowGasAt >= repeatSeconds) {
    alerts.push({
      type: "lowGas",
      loanId: loanState.loanId,
      balanceWei: balanceWei.toString(),
      minRepayGasWei: minRepayGasWei.toString(),
    });
  }

  await updateState({
    trackedGasLoanIds: [loanState.loanId],
    lastReminderAt: alerts.some((a) => a.type !== "lowGas") ? now : lastReminderAt,
    lastLowGasAt: alerts.some((a) => a.type === "lowGas") ? now : lastLowGasAt,
  });

  const payload = {
    borrower,
    chainId: chain.id,
    agentLoanManager,
    now,
    gracePeriodSeconds: Number.isFinite(graceSeconds) ? graceSeconds : 0,
    balanceWei: balanceWei.toString(),
    activeLoanIds: [loanState.loanId],
    alerts,
  };

  if (jsonOut) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  if (alerts.length === 0) {
    if (!quietOk) {
      console.log(`Tabby: 1 active gas loan. Next due in ${formatSeconds(dueInSeconds)} (loanId=${loanState.loanId}).`);
    }
    return;
  }

  for (const a of alerts) {
    if (a.type === "dueSoon") {
      const mon = formatEther(BigInt(a.outstandingWei));
      console.log(
        `Tabby: loanId=${a.loanId} due in ${formatSeconds(a.dueInSeconds)} (outstanding ~${mon} MON). Repay: tabby-borrower repay-gas-loan --loan-id ${a.loanId}`
      );
      continue;
    }
    if (a.type === "overdue") {
      const mon = formatEther(BigInt(a.outstandingWei));
      console.log(
        `Tabby: loanId=${a.loanId} OVERDUE by ${formatSeconds(a.overdueSeconds)} (outstanding ~${mon} MON). Repay ASAP: tabby-borrower repay-gas-loan --loan-id ${a.loanId}`
      );
      continue;
    }
    if (a.type === "defaultEligible") {
      const mon = formatEther(BigInt(a.outstandingWei));
      console.log(
        `Tabby: loanId=${a.loanId} is past grace and can be defaulted (overdue ${formatSeconds(a.overdueSeconds)}, outstanding ~${mon} MON). Repay ASAP.`
      );
      continue;
    }
    if (a.type === "lowGas") {
      console.log(
        `Tabby: low MON balance (~${formatEther(BigInt(a.balanceWei))} MON). You may need a repay-gas topup before repaying loanId=${a.loanId}.`
      );
    }
  }
}

async function requestGasLoan() {
  const principalWei = getArg("--principal-wei");
  const interestBps = getArg("--interest-bps");
  const durationSeconds = getArg("--duration-seconds");
  const action = getArg("--action");
  const borrowerOverride = getArg("--borrower");
  const metadataHash = getArg("--metadata-hash");

  const inputSchema = z.object({
    principalWei: z.string().regex(/^\d+$/),
    interestBps: z.coerce.number().int().min(0),
    durationSeconds: z.coerce.number().int().positive(),
    action: z.coerce.number().int().min(0).max(255),
    borrower: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    metadataHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/).optional(),
  });

  const wallet = await loadWallet();
  const borrower = borrowerOverride ?? wallet.address;
  const parsed = inputSchema.parse({
    principalWei,
    interestBps,
    durationSeconds,
    action,
    borrower,
    metadataHash,
  });

  const identityToken = await mintIdentityToken();

  const offerRes = await fetch(new URL("/loans/gas/offer", baseUrl()), {
    method: "POST",
    headers: { "content-type": "application/json", "x-moltbook-identity": identityToken },
    body: JSON.stringify({
      borrower: parsed.borrower,
      principalWei: parsed.principalWei,
      interestBps: parsed.interestBps,
      durationSeconds: parsed.durationSeconds,
      action: parsed.action,
      metadataHash: parsed.metadataHash,
    }),
  });
  if (!offerRes.ok) throw new Error(`tabby offer failed (${offerRes.status})`);
  const offerJson = await offerRes.json();
  if (!offerJson?.ok) throw new Error(`tabby offer error: ${JSON.stringify(offerJson)}`);

  const data = offerJson.data;
  const offer = data.offer;
  const chainId = data.chainId;
  const agentLoanManager = data.agentLoanManager;

  await updateState({ chainId, agentLoanManager });

  const domain = { name: "TabbyAgentLoan", version: "1", chainId, verifyingContract: agentLoanManager };
  const types = {
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
  };

  const account = privateKeyToAccount(wallet.privateKey as `0x${string}`);
  const borrowerSignature = await account.signTypedData({
    domain,
    types,
    primaryType: "LoanOffer",
    message: {
      borrower: offer.borrower,
      principal: BigInt(offer.principal),
      interestBps: BigInt(offer.interestBps),
      dueAt: BigInt(offer.dueAt),
      nonce: BigInt(offer.nonce),
      issuedAt: BigInt(offer.issuedAt),
      expiresAt: BigInt(offer.expiresAt),
      action: BigInt(offer.action),
      metadataHash: offer.metadataHash,
    },
  });

  const execRes = await fetch(new URL("/loans/gas/execute", baseUrl()), {
    method: "POST",
    headers: { "content-type": "application/json", "x-moltbook-identity": identityToken },
    body: JSON.stringify({
      borrower: parsed.borrower,
      nonce: offer.nonce,
      borrowerSignature,
    }),
  });
  if (!execRes.ok) throw new Error(`tabby execute failed (${execRes.status})`);
  const execJson = await execRes.json();
  if (!execJson?.ok) throw new Error(`tabby execute error: ${JSON.stringify(execJson)}`);

  const loanId = execJson?.data?.loanId;
  if (typeof loanId === "number" && Number.isInteger(loanId) && loanId > 0) {
    const existingState: BorrowerState = (await tryLoadState()) ?? {};
    const tracked = Array.isArray(existingState.trackedGasLoanIds)
      ? existingState.trackedGasLoanIds.filter((n) => Number.isInteger(n) && n > 0)
      : [];
    if (!tracked.includes(loanId)) tracked.push(loanId);

    await updateState({
      trackedGasLoanIds: tracked,
      lastGasLoan: {
        loanId,
        borrower: parsed.borrower,
        principalWei: offer.principal,
        interestBps: Number(offer.interestBps),
        dueAt: Number(offer.dueAt),
        action: Number(offer.action),
      },
    });
  }

  console.log(JSON.stringify(execJson.data, null, 2));
}

async function status() {
  const loanId = getArg("--loan-id");
  if (!loanId) throw new Error("Missing --loan-id");

  const url = new URL(`/public/monitoring/gas-loans/${loanId}`, baseUrl());
  try {
    const res = await fetch(url);
    if (res.ok) {
      const json = await res.json();
      console.log(JSON.stringify(json, null, 2));
      return;
    }
  } catch {
    // ignore and fall back to onchain
  }

  const { chain, rpcUrl, agentLoanManager } = await getChainConfigFromStateOrEnv();
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) }) as any;
  const now = await chainNowSeconds(publicClient);
  const graceSecondsRaw = await publicClient.readContract({
    address: agentLoanManager,
    abi: agentLoanManagerReadAbi,
    functionName: "gracePeriodSeconds",
  });
  const graceSeconds = Number(graceSecondsRaw);

  const onchain = await readGasLoanState(publicClient, agentLoanManager, Number(loanId));
  const dueInSeconds = onchain.dueAt - now;
  const graceEndsAt = onchain.dueAt + (Number.isFinite(graceSeconds) && graceSeconds >= 0 ? graceSeconds : 0);

  console.log(
    JSON.stringify(
      {
        ok: true,
        data: {
          onchain: {
            ...onchain,
            dueInSeconds,
            graceEndsAt,
            defaultEligible: now > graceEndsAt,
          },
        },
      },
      null,
      2
    )
  );
}

async function nextDue() {
  const borrower = await resolveBorrowerAddress();
  if (!/^0x[a-fA-F0-9]{40}$/.test(borrower)) throw new Error("Invalid borrower address");

  const { chain, rpcUrl, agentLoanManager } = await getChainConfigFromStateOrEnv();
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) }) as any;
  const now = await chainNowSeconds(publicClient);

  let next: GasLoanState | undefined = undefined;
  try {
    const nextDue = await fetchNextDueFromServer(borrower);
    if (nextDue) {
      next = await readGasLoanState(publicClient, agentLoanManager, nextDue.loanId);
    }
  } catch {
    next = undefined;
  }

  if (!next) {
    const state: BorrowerState = (await tryLoadState()) ?? {};
    let loanIds = Array.from(
      new Set(
        []
          .concat(Array.isArray(state.trackedGasLoanIds) ? state.trackedGasLoanIds : [])
          .concat(state.lastGasLoan?.loanId ? [state.lastGasLoan.loanId] : [])
          .filter((n) => Number.isInteger(n) && n > 0)
      )
    );
    if (loanIds.length === 0) {
      try {
        loanIds = await fetchExecutedLoanIdsFromServer(borrower);
      } catch {
        loanIds = [];
      }
    }
    if (loanIds.length === 0) throw new Error("No tracked loans found (run request-gas-loan first or pass --borrower)");

    const states = await Promise.all(loanIds.map(async (id) => await readGasLoanState(publicClient, agentLoanManager, id)));
    const relevant = states
      .filter((l) => l.borrower?.toLowerCase?.() === borrower.toLowerCase())
      .filter((l) => !l.closed && !l.defaulted && BigInt(l.outstandingWei) > 0n);
    if (relevant.length === 0) throw new Error("No active loans found");
    next = relevant.sort((a, b) => a.dueAt - b.dueAt)[0];
  }

  const dueInSeconds = next.dueAt - now;

  console.log(
    JSON.stringify(
      {
        loanId: next.loanId,
        borrower,
        dueAt: next.dueAt,
        dueInSeconds,
        overdue: dueInSeconds < 0,
      },
      null,
      2
    )
  );
}

async function repayGasLoan() {
  const loanIdRaw = getArg("--loan-id");
  if (!loanIdRaw) throw new Error("Missing --loan-id");
  const loanId = Number(loanIdRaw);
  if (!Number.isInteger(loanId) || loanId <= 0) throw new Error("Invalid --loan-id");

  const amountWeiArg = getArg("--amount-wei");

  const { chain, rpcUrl, agentLoanManager } = await getChainConfigFromStateOrEnv();
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) }) as any;

  const outstanding = await publicClient.readContract({
    address: agentLoanManager,
    abi: agentLoanManagerReadAbi,
    functionName: "outstanding",
    args: [BigInt(loanId)],
  });

  const repayWei = amountWeiArg ?? outstanding.toString();
  if (!/^\d+$/.test(repayWei)) throw new Error("Invalid --amount-wei");
  if (BigInt(repayWei) === 0n) throw new Error("Nothing to repay");

  const wallet = await loadWallet();
  const account = privateKeyToAccount(wallet.privateKey as `0x${string}`);

  const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) }) as any;

  const abi = [
    {
      type: "function",
      name: "repay",
      stateMutability: "payable",
      inputs: [{ name: "loanId", type: "uint256" }],
      outputs: [],
    },
  ];

  const hash = await walletClient.writeContract({
    address: agentLoanManager,
    abi,
    functionName: "repay",
    args: [BigInt(loanId)],
    value: BigInt(repayWei),
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(
    JSON.stringify(
      {
        txHash: hash,
        status: receipt.status,
        blockNumber: receipt.blockNumber?.toString?.() ?? String(receipt.blockNumber),
      },
      null,
      2
    )
  );
}

async function main() {
  const cmd = process.argv[2];
  if (!cmd || cmd === "-h" || cmd === "--help") {
    usage();
    process.exit(0);
  }

  if (cmd === "init-wallet") {
    const pk = generatePrivateKey();
    const { address, path: p } = await saveWallet(pk);
    console.log(JSON.stringify({ address, walletPath: p }, null, 2));
    return;
  }

  if (cmd === "request-gas-loan") {
    await requestGasLoan();
    return;
  }

  if (cmd === "status") {
    await status();
    return;
  }

  if (cmd === "repay-gas-loan") {
    await repayGasLoan();
    return;
  }

  if (cmd === "next-due") {
    await nextDue();
    return;
  }

  if (cmd === "heartbeat") {
    await heartbeat();
    return;
  }

  usage();
  process.exit(1);
}

main().catch((err) => {
  console.error(err?.message ?? String(err));
  process.exit(1);
});
