#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { createPublicClient, createWalletClient, decodeEventLog, formatEther, formatUnits, http, parseUnits } from "viem";
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

type LastSecuredLoan = {
  loanId: number;
  positionId: number;
  borrower: string;
  asset: string;
  principalWei: string;
  interestBps: number;
  collateralAsset: string;
  collateralAmountWei: string;
  dueAt: number;
};

type BorrowerState = {
  chainId?: number;
  agentLoanManager?: string;
  loanManager?: string;
  positionManager?: string;
  securedPool?: string;
  collateralAsset?: string;
  trackedGasLoanIds?: number[];
  trackedSecuredLoanIds?: number[];
  securedLoanPositions?: Record<string, number>;
  lastReminderAt?: number;
  lastLowGasAt?: number;
  lastGasLoan?: Partial<LastGasLoan>;
  lastSecuredLoan?: Partial<LastSecuredLoan>;
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
  const here = path.dirname(fileURLToPath(import.meta.url));

  const candidates = [
    path.join(here, "..", ".env"),
    path.join(here, "..", "..", ".env"),
  ];

  for (const envPath of candidates) {
    try {
      const raw = await fs.readFile(envPath, "utf8");
      parseDotEnv(raw);
      return;
    } catch {
      continue;
    }
  }
}

await loadLocalEnv();
const ENV = getEnv();
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const MAX_UINT256 = (1n << 256n) - 1n;

function usage() {
  console.log(
    [
      "tabby-borrower <command>",
      "",
      "Commands:",
      "  init-wallet [--force]",
      "  ensure-gas [--min-balance-wei <wei>] [--topup-wei <wei>] [--interest-bps <bps>] [--duration-seconds <sec>] [--action <n>] [--json]",
      "  request-gas-loan --principal-wei <wei> --interest-bps <bps> --duration-seconds <sec> --action <n> [--borrower <0x...>] [--metadata-hash <0x...>]",
      "  status --loan-id <id>",
      "  repay-gas-loan --loan-id <id> [--amount-wei <wei>]",
      "  next-due [--borrower <0x...>]",
      "  heartbeat [--borrower <0x...>] [--quiet-ok] [--json]",
      "  approve-collateral [--amount <n>|--amount-wei <wei>] [--collateral-asset <0x...>] [--max]",
      "  open-secured-loan --principal <n>|--principal-wei <wei> --collateral-amount <n>|--collateral-amount-wei <wei> [--duration-seconds <sec>|--due-at <unix>] [--interest-bps <bps>] [--collateral-asset <0x...>] [--no-auto-approve]",
      "  secured-status --loan-id <id>",
      "  repay-secured-loan --loan-id <id> [--amount <n>|--amount-wei <wei>] [--no-auto-approve]",
      "  withdraw-collateral --loan-id <id> [--position-id <id>] [--amount <n>|--amount-wei <wei>]",
      "",
      "Global flags:",
      "  --no-auto-gas   Disable automatic gas topups before sending transactions.",
      "",
      "Env:",
      "  TABBY_API_BASE_URL   (default: https://api.tabby.cash)",
      "  TABBY_DEV_AUTH_TOKEN (optional; used when server ENFORCE_MOLTBOOK=false + DEV_AUTH_TOKEN is set)",
      "  MOLTBOOK_API_KEY     (required to auto-mint identity token)",
      "  MOLTBOOK_AUDIENCE    (optional)",
      "  TABBY_MIN_TX_GAS_WEI         (optional; default: 10000000000000000 = 0.01 MON)",
      "  TABBY_GAS_TOPUP_WEI          (optional; default: 20000000000000000 = 0.02 MON)",
      "  TABBY_GAS_TOPUP_INTEREST_BPS (optional; default: 500)",
      "  TABBY_GAS_TOPUP_DURATION_SECONDS (optional; default: 3600)",
      "  TABBY_GAS_TOPUP_ACTION       (optional; default: 1)",
      "  MONAD_CHAIN_ID / CHAIN_ID   (optional; defaults to 10143 unless returned by Tabby or cached)",
      "  MONAD_RPC_URL / RPC_URL     (optional; defaults to https://testnet-rpc.monad.xyz or https://rpc.monad.xyz)",
      "  AGENT_LOAN_MANAGER_ADDRESS         (optional; overrides cached/public config)",
      "  LOAN_MANAGER_ADDRESS               (secured loans; can be discovered/cached)",
      "  POSITION_MANAGER_ADDRESS           (secured loans; optional override)",
      "  SECURED_POOL_ADDRESS               (secured loans; optional override)",
      "  COLLATERAL_ASSET                   (secured loans; default collateral token)",
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

function asAddress(value: string | undefined, label: string) {
  if (value === undefined) return undefined;
  if (!ADDRESS_RE.test(value)) throw new Error(`Invalid ${label}`);
  return value;
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

function isLocalBaseUrl() {
  const url = new URL(ENV.TABBY_API_BASE_URL);
  const host = url.hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
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
      loanManager: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
      positionManager: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
      securedPool: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
      collateralAsset: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
      trackedGasLoanIds: z.array(z.number().int().positive()).optional(),
      trackedSecuredLoanIds: z.array(z.number().int().positive()).optional(),
      securedLoanPositions: z.record(z.string(), z.number().int().positive()).optional(),
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
      lastSecuredLoan: z
        .object({
          loanId: z.number().int().positive(),
          positionId: z.number().int().positive(),
          borrower: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
          asset: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
          principalWei: z.string().regex(/^\d+$/),
          interestBps: z.number().int().min(0),
          collateralAsset: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
          collateralAmountWei: z.string().regex(/^\d+$/),
          dueAt: z.number().int().positive(),
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
  const apiKey = ENV.MOLTBOOK_API_KEY;
  if (!apiKey) return undefined;
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
    const schema = z
      .object({
        chainId: z.number().int().positive().optional(),
        agentLoanManager: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
        loanManager: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
        positionManager: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
        securedPool: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
        collateralAsset: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
      })
      .passthrough();
    return schema.parse(data);
  } catch {
    return undefined;
  }
}

async function getRpcConfigFromStateOrEnv() {
  const chainIdEnv = ENV.MONAD_CHAIN_ID ?? ENV.CHAIN_ID;
  const rpcUrlEnv = ENV.MONAD_RPC_URL ?? ENV.RPC_URL;

  const publicConfig = await fetchTabbyPublicConfig();
  const state = (await tryLoadState()) ?? undefined;

  const chainId = chainIdEnv ?? publicConfig?.chainId ?? state?.chainId ?? 10143;
  if (!Number.isInteger(chainId) || chainId <= 0) throw new Error("Invalid MONAD_CHAIN_ID");

  const rpcUrl = rpcUrlEnv ?? defaultRpcUrl(chainId);
  if (!rpcUrl) throw new Error("Missing MONAD_RPC_URL");

  const chain = {
    id: chainId,
    name: chainId === 143 ? "Monad Mainnet" : "Monad Testnet",
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  };

  return { chain, rpcUrl, publicConfig, state };
}

async function getGasLoanConfigFromStateOrEnv() {
  const agentLoanManagerEnv = ENV.AGENT_LOAN_MANAGER_ADDRESS;
  const { chain, rpcUrl, publicConfig, state } = await getRpcConfigFromStateOrEnv();

  const agentLoanManager = agentLoanManagerEnv ?? publicConfig?.agentLoanManager ?? state?.agentLoanManager;
  if (!agentLoanManager) {
    throw new Error(
      "Missing agentLoanManager; set AGENT_LOAN_MANAGER_ADDRESS, or ensure /public/config is reachable, or add it to ~/.config/tabby-borrower/state.json"
    );
  }

  return { chain, rpcUrl, agentLoanManager };
}

async function loadBorrowerAccount() {
  const wallet = await loadWallet();
  const account = privateKeyToAccount(wallet.privateKey as `0x${string}`);
  return { wallet, account };
}

async function getSecuredLoanConfigFromStateOrEnv() {
  const { chain, rpcUrl, publicConfig, state } = await getRpcConfigFromStateOrEnv();
  const loanManagerEnv = asAddress(ENV.LOAN_MANAGER_ADDRESS, "LOAN_MANAGER_ADDRESS");
  const positionManagerEnv = asAddress(ENV.POSITION_MANAGER_ADDRESS, "POSITION_MANAGER_ADDRESS");
  const securedPoolEnv = asAddress(ENV.SECURED_POOL_ADDRESS, "SECURED_POOL_ADDRESS");
  const collateralAssetEnv = asAddress(ENV.COLLATERAL_ASSET, "COLLATERAL_ASSET");

  const loanManager = loanManagerEnv ?? publicConfig?.loanManager ?? state?.loanManager;
  if (!loanManager) {
    throw new Error("Missing loanManager; set LOAN_MANAGER_ADDRESS or add it to ~/.config/tabby-borrower/state.json");
  }

  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) }) as any;

  const [pmFromChain, poolFromChain] = await Promise.all([
    publicClient.readContract({ address: loanManager, abi: loanManagerAbi, functionName: "positionManager" }),
    publicClient.readContract({ address: loanManager, abi: loanManagerAbi, functionName: "liquidityPool" }),
  ]);

  const positionManager = positionManagerEnv ?? publicConfig?.positionManager ?? state?.positionManager ?? pmFromChain;
  const securedPool = securedPoolEnv ?? publicConfig?.securedPool ?? state?.securedPool ?? poolFromChain;

  if (!positionManager || !ADDRESS_RE.test(positionManager)) throw new Error("Failed to resolve positionManager");
  if (!securedPool || !ADDRESS_RE.test(securedPool) || /^0x0{40}$/.test(securedPool)) {
    throw new Error("Failed to resolve securedPool (LoanManager.liquidityPool is zero)");
  }

  const debtAsset = await publicClient.readContract({ address: securedPool, abi: liquidityPoolReadAbi, functionName: "ASSET" });
  if (!debtAsset || !ADDRESS_RE.test(debtAsset)) throw new Error("Failed to resolve secured pool asset");

  const collateralAsset = collateralAssetEnv ?? publicConfig?.collateralAsset ?? state?.collateralAsset;

  await updateState({
    chainId: chain.id,
    loanManager,
    positionManager,
    securedPool,
    collateralAsset: collateralAsset ?? state?.collateralAsset,
  });

  return { chain, rpcUrl, publicClient, loanManager, positionManager, securedPool, debtAsset, collateralAsset };
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

const erc20Abi = [
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
];

const liquidityPoolReadAbi = [
  {
    type: "function",
    name: "ASSET",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
];

const loanManagerAbi = [
  {
    type: "function",
    name: "positionManager",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "liquidityPool",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
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
  {
    type: "function",
    name: "loanPositions",
    stateMutability: "view",
    inputs: [{ name: "loanId", type: "uint256" }],
    outputs: [{ type: "uint256" }],
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
    name: "openLoan",
    stateMutability: "nonpayable",
    inputs: [
      { name: "asset", type: "address" },
      { name: "principal", type: "uint256" },
      { name: "interestBps", type: "uint256" },
      { name: "collateralAsset", type: "address" },
      { name: "collateralAmount", type: "uint256" },
      { name: "dueAt", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "repay",
    stateMutability: "nonpayable",
    inputs: [
      { name: "loanId", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "event",
    name: "LoanOpened",
    anonymous: false,
    inputs: [
      { indexed: true, name: "loanId", type: "uint256" },
      { indexed: true, name: "positionId", type: "uint256" },
      { indexed: true, name: "borrower", type: "address" },
      { indexed: false, name: "asset", type: "address" },
      { indexed: false, name: "principal", type: "uint256" },
    ],
  },
];

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
  {
    type: "function",
    name: "removeCollateral",
    stateMutability: "nonpayable",
    inputs: [
      { name: "positionId", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
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
  const { chain, rpcUrl, agentLoanManager } = await getGasLoanConfigFromStateOrEnv();
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

type GasLoanOfferParams = {
  borrower: string;
  principalWei: string;
  interestBps: number;
  durationSeconds: number;
  action: number;
  metadataHash?: string;
};

async function readJsonSafe(res: Response): Promise<any | undefined> {
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}

function httpFailureMessage(prefix: string, status: number, json: any | undefined) {
  const code = json?.code;
  const msg = json?.message;
  if (typeof code === "string" && code.length > 0) {
    return `${prefix} (${status}) ${code}${typeof msg === "string" && msg.length > 0 ? `: ${msg}` : ""}`;
  }
  return `${prefix} (${status})`;
}

async function requestGasLoanWithParams(params: GasLoanOfferParams) {
  const wallet = await loadWallet();
  if (params.borrower.toLowerCase() !== wallet.address.toLowerCase()) {
    throw new Error("Borrower must match ~/.config/tabby-borrower/wallet.json address");
  }

  const identityToken = await mintIdentityToken();
  const devAuthToken = ENV.TABBY_DEV_AUTH_TOKEN;
  if (!identityToken && !devAuthToken && !isLocalBaseUrl()) {
    throw new Error("Missing auth: set MOLTBOOK_API_KEY (Moltbook) or TABBY_DEV_AUTH_TOKEN (dev)");
  }

  const offerRes = await fetch(new URL("/loans/gas/offer", baseUrl()), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(identityToken ? { "x-moltbook-identity": identityToken } : {}),
      ...(devAuthToken ? { "x-dev-auth": devAuthToken } : {}),
    },
    body: JSON.stringify({
      borrower: params.borrower,
      principalWei: params.principalWei,
      interestBps: params.interestBps,
      durationSeconds: params.durationSeconds,
      action: params.action,
      metadataHash: params.metadataHash,
    }),
  });

  const offerJson = await readJsonSafe(offerRes);
  if (!offerRes.ok) {
    throw new Error(httpFailureMessage("tabby offer failed", offerRes.status, offerJson));
  }
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
    headers: {
      "content-type": "application/json",
      ...(identityToken ? { "x-moltbook-identity": identityToken } : {}),
      ...(devAuthToken ? { "x-dev-auth": devAuthToken } : {}),
    },
    body: JSON.stringify({
      borrower: params.borrower,
      nonce: offer.nonce,
      borrowerSignature,
    }),
  });

  const execJson = await readJsonSafe(execRes);
  if (!execRes.ok) {
    throw new Error(httpFailureMessage("tabby execute failed", execRes.status, execJson));
  }
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
        borrower: params.borrower,
        principalWei: offer.principal,
        interestBps: Number(offer.interestBps),
        dueAt: Number(offer.dueAt),
        action: Number(offer.action),
      },
    });
  }

  return execJson.data;
}

function parseWeiRequired(value: string | undefined, label: string): bigint {
  if (!value) throw new Error(`Missing ${label}`);
  if (!/^\d+$/.test(value)) throw new Error(`Invalid ${label}`);
  return BigInt(value);
}

type EnsureGasParams = {
  borrower: string;
  minBalanceWei: bigint;
  topupWei: bigint;
  interestBps: number;
  durationSeconds: number;
  action: number;
};

function defaultEnsureGasParams(borrower: string): EnsureGasParams {
  const minBalanceWei = BigInt(ENV.TABBY_MIN_TX_GAS_WEI ?? "10000000000000000");
  const topupWei = BigInt(ENV.TABBY_GAS_TOPUP_WEI ?? "20000000000000000");
  const interestBps = ENV.TABBY_GAS_TOPUP_INTEREST_BPS ?? 500;
  const durationSeconds = ENV.TABBY_GAS_TOPUP_DURATION_SECONDS ?? 3600;
  const action = ENV.TABBY_GAS_TOPUP_ACTION ?? 1;
  return { borrower, minBalanceWei, topupWei, interestBps, durationSeconds, action };
}

async function ensureGasWithParams(params: EnsureGasParams) {
  const { chain, rpcUrl } = await getRpcConfigFromStateOrEnv();
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) }) as any;
  const balanceWei = await publicClient.getBalance({ address: params.borrower });

  if (balanceWei >= params.minBalanceWei) {
    return {
      ok: true,
      status: "sufficient",
      borrower: params.borrower,
      chainId: chain.id,
      balanceWei: balanceWei.toString(),
      minBalanceWei: params.minBalanceWei.toString(),
    };
  }

  const needWei = params.minBalanceWei - balanceWei;
  const principalWei = params.topupWei > needWei ? params.topupWei : needWei;

  const result = await requestGasLoanWithParams({
    borrower: params.borrower,
    principalWei: principalWei.toString(),
    interestBps: params.interestBps,
    durationSeconds: params.durationSeconds,
    action: params.action,
  });

  const newBalanceWei = await publicClient.getBalance({ address: params.borrower });
  return {
    ok: true,
    status: "toppedUp",
    borrower: params.borrower,
    chainId: chain.id,
    balanceWei: balanceWei.toString(),
    minBalanceWei: params.minBalanceWei.toString(),
    requestedPrincipalWei: principalWei.toString(),
    result,
    newBalanceWei: newBalanceWei.toString(),
  };
}

function isInsufficientFundsError(error: unknown) {
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    msg.includes("insufficient funds") ||
    msg.includes("insufficient balance") ||
    msg.includes("insufficient funds for gas") ||
    msg.includes("insufficient funds for intrinsic transaction cost")
  );
}

function isActiveGasLoanLimitError(error: unknown) {
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return msg.includes("active-loan") || msg.includes("borrower has an active gas loan");
}

async function autoTopupGasIfNeeded(borrower: string) {
  const params = defaultEnsureGasParams(borrower);
  if (params.minBalanceWei <= 0n) {
    return { ok: true, status: "disabled", borrower };
  }

  try {
    return await ensureGasWithParams(params);
  } catch (err) {
    // If we already have an active gas loan, a normal topup (action=1) is blocked. Fall back to repay-gas (action=255),
    // which the server allows alongside an active loan, within the configured caps.
    if (!isActiveGasLoanLimitError(err) || params.action === 255) throw err;
    return await ensureGasWithParams({ ...params, action: 255, topupWei: 0n });
  }
}

async function withAutoGas<T>(borrower: string, fn: () => Promise<T>): Promise<T> {
  const noAutoGas = process.argv.includes("--no-auto-gas");
  if (!noAutoGas) {
    await autoTopupGasIfNeeded(borrower);
  }

  try {
    return await fn();
  } catch (err) {
    if (noAutoGas || !isInsufficientFundsError(err)) throw err;
    await autoTopupGasIfNeeded(borrower);
    return await fn();
  }
}

async function ensureGas() {
  const jsonOut = process.argv.includes("--json");
  const borrowerOverride = getArg("--borrower");

  const minBalanceWeiArg = getArg("--min-balance-wei");
  const topupWeiArg = getArg("--topup-wei");
  const interestBpsArg = getArg("--interest-bps");
  const durationSecondsArg = getArg("--duration-seconds");
  const actionArg = getArg("--action");

  const wallet = await loadWallet();
  const borrower = borrowerOverride ?? wallet.address;
  if (!/^0x[a-fA-F0-9]{40}$/.test(borrower)) throw new Error("Invalid borrower address");
  if (borrower.toLowerCase() !== wallet.address.toLowerCase()) {
    throw new Error("Borrower must match ~/.config/tabby-borrower/wallet.json address");
  }

  const params = defaultEnsureGasParams(borrower);

  if (minBalanceWeiArg) params.minBalanceWei = parseWeiRequired(minBalanceWeiArg, "--min-balance-wei");
  if (topupWeiArg) params.topupWei = parseWeiRequired(topupWeiArg, "--topup-wei");

  if (interestBpsArg) {
    const v = Number(interestBpsArg);
    if (!Number.isInteger(v) || v < 0) throw new Error("Invalid --interest-bps");
    params.interestBps = v;
  }

  if (durationSecondsArg) {
    const v = Number(durationSecondsArg);
    if (!Number.isInteger(v) || v <= 0) throw new Error("Invalid --duration-seconds");
    params.durationSeconds = v;
  }

  if (actionArg) {
    const v = Number(actionArg);
    if (!Number.isInteger(v) || v < 0 || v > 255) throw new Error("Invalid --action");
    params.action = v;
  }

  const payload = await ensureGasWithParams(params);

  if (jsonOut) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  if (payload.status === "sufficient") {
    console.log(`Tabby: gas OK (~${formatEther(BigInt(payload.balanceWei))} MON).`);
    return;
  }

  console.log(`Tabby: topped up gas. balance ~${formatEther(BigInt(payload.newBalanceWei))} MON.`);
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
  if (borrower.toLowerCase() !== wallet.address.toLowerCase()) {
    throw new Error("Borrower must match ~/.config/tabby-borrower/wallet.json address");
  }
  const parsed = inputSchema.parse({
    principalWei,
    interestBps,
    durationSeconds,
    action,
    borrower,
    metadataHash,
  });

  const result = await requestGasLoanWithParams({
    borrower: parsed.borrower,
    principalWei: parsed.principalWei,
    interestBps: parsed.interestBps,
    durationSeconds: parsed.durationSeconds,
    action: parsed.action,
    metadataHash: parsed.metadataHash,
  });

  console.log(JSON.stringify(result, null, 2));
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

  const { chain, rpcUrl, agentLoanManager } = await getGasLoanConfigFromStateOrEnv();
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

  const { chain, rpcUrl, agentLoanManager } = await getGasLoanConfigFromStateOrEnv();
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

  const { chain, rpcUrl, agentLoanManager } = await getGasLoanConfigFromStateOrEnv();
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

function parseWei(value: string | undefined, label: string) {
  if (!value) return undefined;
  if (!/^\d+$/.test(value)) throw new Error(`Invalid ${label}`);
  return BigInt(value);
}

async function readTokenDecimals(publicClient: any, token: string) {
  const d = await publicClient.readContract({ address: token, abi: erc20Abi, functionName: "decimals" });
  const decimals = Number(d);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new Error("Failed to read token decimals");
  return decimals;
}

async function ensureAllowance(params: {
  chain: any;
  rpcUrl: string;
  publicClient: any;
  walletClient: any;
  token: string;
  owner: string;
  spender: string;
  required: bigint;
  desired?: bigint;
}) {
  const current = await params.publicClient.readContract({
    address: params.token,
    abi: erc20Abi,
    functionName: "allowance",
    args: [params.owner, params.spender],
  });
  if (BigInt(current) >= params.required) return;

  const desired = params.desired === undefined ? params.required : params.desired;
  if (desired < params.required) throw new Error("Invalid desired allowance");

  const walletClient = params.walletClient;
  if (BigInt(current) !== 0n) {
    const hash0 = await walletClient.writeContract({
      address: params.token,
      abi: erc20Abi,
      functionName: "approve",
      args: [params.spender, 0n],
    });
    await params.publicClient.waitForTransactionReceipt({ hash: hash0 });
  }

  const hash = await walletClient.writeContract({
    address: params.token,
    abi: erc20Abi,
    functionName: "approve",
    args: [params.spender, desired],
  });
  await params.publicClient.waitForTransactionReceipt({ hash });
}

async function approveCollateral() {
  const amountWeiArg = parseWei(getArg("--amount-wei"), "--amount-wei");
  const amountArg = getArg("--amount");
  const max = process.argv.includes("--max");

  const { wallet, account } = await loadBorrowerAccount();
  const cfg = await getSecuredLoanConfigFromStateOrEnv();
  const publicClient = cfg.publicClient;
  const collateralOverride = asAddress(getArg("--collateral-asset"), "--collateral-asset");
  const collateralAsset = collateralOverride ?? cfg.collateralAsset;
  if (!collateralAsset) throw new Error("Missing collateral asset (set COLLATERAL_ASSET or pass --collateral-asset)");

  const decimals = await readTokenDecimals(publicClient, collateralAsset);
  const amountWei =
    max ? MAX_UINT256 : amountWeiArg ?? (amountArg ? parseUnits(amountArg, decimals) : undefined);
  if (amountWei === undefined) throw new Error("Missing --amount/--amount-wei (or pass --max)");

  const walletClient = createWalletClient({ account, chain: cfg.chain, transport: http(cfg.rpcUrl) }) as any;
  const owner = wallet.address;

  await withAutoGas(owner, async () => {
    if (!max) {
      await ensureAllowance({
        chain: cfg.chain,
        rpcUrl: cfg.rpcUrl,
        publicClient,
        walletClient,
        token: collateralAsset,
        owner,
        spender: cfg.positionManager,
        required: amountWei,
      });
      return;
    }

    await ensureAllowance({
      chain: cfg.chain,
      rpcUrl: cfg.rpcUrl,
      publicClient,
      walletClient,
      token: collateralAsset,
      owner,
      spender: cfg.positionManager,
      required: MAX_UINT256,
    });
  });

  const allowance = await publicClient.readContract({
    address: collateralAsset,
    abi: erc20Abi,
    functionName: "allowance",
    args: [owner, cfg.positionManager],
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        data: {
          owner,
          collateralAsset,
          positionManager: cfg.positionManager,
          allowanceWei: BigInt(allowance).toString(),
        },
      },
      null,
      2
    )
  );
}

async function openSecuredLoan() {
  const principalWeiArg = parseWei(getArg("--principal-wei"), "--principal-wei");
  const principalArg = getArg("--principal");
  const collateralAmountWeiArg = parseWei(getArg("--collateral-amount-wei"), "--collateral-amount-wei");
  const collateralAmountArg = getArg("--collateral-amount");
  const durationSecondsArg = getArg("--duration-seconds");
  const dueAtArg = getArg("--due-at");
  const interestBpsRaw = getArg("--interest-bps");
  const noAutoApprove = process.argv.includes("--no-auto-approve");

  const { wallet, account } = await loadBorrowerAccount();
  const cfg = await getSecuredLoanConfigFromStateOrEnv();
  const publicClient = cfg.publicClient;

  const collateralOverride = asAddress(getArg("--collateral-asset"), "--collateral-asset");
  const collateralAsset = collateralOverride ?? cfg.collateralAsset;
  if (!collateralAsset) throw new Error("Missing collateral asset (set COLLATERAL_ASSET or pass --collateral-asset)");

  const debtDecimals = await readTokenDecimals(publicClient, cfg.debtAsset);
  const collateralDecimals = await readTokenDecimals(publicClient, collateralAsset);

  const principalWei = principalWeiArg ?? (principalArg ? parseUnits(principalArg, debtDecimals) : undefined);
  if (principalWei === undefined || principalWei <= 0n) throw new Error("Missing --principal/--principal-wei");

  const collateralAmountWei =
    collateralAmountWeiArg ?? (collateralAmountArg ? parseUnits(collateralAmountArg, collateralDecimals) : undefined);
  if (collateralAmountWei === undefined || collateralAmountWei <= 0n) {
    throw new Error("Missing --collateral-amount/--collateral-amount-wei");
  }

  const interestBps = interestBpsRaw ? Number(interestBpsRaw) : 0;
  if (!Number.isInteger(interestBps) || interestBps < 0) throw new Error("Invalid --interest-bps");

  let dueAt: number | undefined = undefined;
  if (dueAtArg) {
    const v = Number(dueAtArg);
    if (!Number.isInteger(v) || v <= 0) throw new Error("Invalid --due-at");
    dueAt = v;
  } else if (durationSecondsArg) {
    const d = Number(durationSecondsArg);
    if (!Number.isInteger(d) || d <= 0) throw new Error("Invalid --duration-seconds");
    const now = await chainNowSeconds(publicClient);
    dueAt = now + d;
  } else {
    throw new Error("Missing --duration-seconds or --due-at");
  }

  const collateralBal = await publicClient.readContract({
    address: collateralAsset,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [wallet.address],
  });
  if (BigInt(collateralBal) < collateralAmountWei) throw new Error("Insufficient collateral balance");

  const poolBal = await publicClient.readContract({
    address: cfg.debtAsset,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [cfg.securedPool],
  });
  if (BigInt(poolBal) < principalWei) throw new Error("Insufficient secured pool liquidity");

  const walletClient = createWalletClient({ account, chain: cfg.chain, transport: http(cfg.rpcUrl) }) as any;

  const { hash, receipt } = await withAutoGas(wallet.address, async () => {
    if (!noAutoApprove) {
      await ensureAllowance({
        chain: cfg.chain,
        rpcUrl: cfg.rpcUrl,
        publicClient,
        walletClient,
        token: collateralAsset,
        owner: wallet.address,
        spender: cfg.positionManager,
        required: collateralAmountWei,
      });
    }

    const hash = await walletClient.writeContract({
      address: cfg.loanManager,
      abi: loanManagerAbi,
      functionName: "openLoan",
      args: [cfg.debtAsset, principalWei, BigInt(interestBps), collateralAsset, collateralAmountWei, BigInt(dueAt)],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    return { hash, receipt };
  });

  let opened: { loanId: number; positionId: number } | undefined = undefined;
	for (const log of receipt.logs ?? []) {
		if ((log.address ?? "").toLowerCase() !== cfg.loanManager.toLowerCase()) continue;
		try {
			const decoded: any = decodeEventLog({ abi: loanManagerAbi as any, data: log.data, topics: log.topics });
			if (decoded.eventName !== "LoanOpened") continue;
			const args: any = decoded.args;
			if ((args?.borrower ?? "").toLowerCase() !== wallet.address.toLowerCase()) continue;
			opened = { loanId: Number(args.loanId), positionId: Number(args.positionId) };
			break;
    } catch {
      continue;
    }
  }

  if (!opened || !Number.isInteger(opened.loanId) || opened.loanId <= 0 || !Number.isInteger(opened.positionId) || opened.positionId <= 0) {
    throw new Error("Failed to decode LoanOpened event (loan opened but ids not captured)");
  }

  const existingState: BorrowerState = (await tryLoadState()) ?? {};
  const tracked = Array.isArray(existingState.trackedSecuredLoanIds)
    ? existingState.trackedSecuredLoanIds.filter((n) => Number.isInteger(n) && n > 0)
    : [];
  if (!tracked.includes(opened.loanId)) tracked.push(opened.loanId);

  const positions = typeof existingState.securedLoanPositions === "object" && existingState.securedLoanPositions
    ? { ...existingState.securedLoanPositions }
    : {};
  positions[String(opened.loanId)] = opened.positionId;

  await updateState({
    trackedSecuredLoanIds: tracked,
    securedLoanPositions: positions,
    lastSecuredLoan: {
      loanId: opened.loanId,
      positionId: opened.positionId,
      borrower: wallet.address,
      asset: cfg.debtAsset,
      principalWei: principalWei.toString(),
      interestBps,
      collateralAsset,
      collateralAmountWei: collateralAmountWei.toString(),
      dueAt,
    },
  });

  console.log(
    JSON.stringify(
      {
        txHash: hash,
        status: receipt.status,
        loanId: opened.loanId,
        positionId: opened.positionId,
      },
      null,
      2
    )
  );
}

async function securedStatus() {
  const loanIdRaw = getArg("--loan-id");
  if (!loanIdRaw) throw new Error("Missing --loan-id");
  const loanId = Number(loanIdRaw);
  if (!Number.isInteger(loanId) || loanId <= 0) throw new Error("Invalid --loan-id");

  const { wallet } = await loadBorrowerAccount();
  const cfg = await getSecuredLoanConfigFromStateOrEnv();
  const publicClient = cfg.publicClient;

  const id = BigInt(loanId);
  const [loan, outstanding, positionIdOnchain] = await Promise.all([
    publicClient.readContract({ address: cfg.loanManager, abi: loanManagerAbi, functionName: "loans", args: [id] }),
    publicClient.readContract({ address: cfg.loanManager, abi: loanManagerAbi, functionName: "outstanding", args: [id] }),
    publicClient.readContract({ address: cfg.loanManager, abi: loanManagerAbi, functionName: "loanPositions", args: [id] }),
  ]);

  const state = await tryLoadState();
  const posFromState = state?.securedLoanPositions?.[String(loanId)];
  const positionId = Number(positionIdOnchain) > 0 ? Number(positionIdOnchain) : posFromState;

  let position: any = undefined;
  if (positionId && Number.isInteger(positionId) && positionId > 0) {
    try {
      position = await publicClient.readContract({
        address: cfg.positionManager,
        abi: positionManagerAbi,
        functionName: "positions",
        args: [BigInt(positionId)],
      });
    } catch {
      position = undefined;
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        data: {
          borrower: wallet.address,
          loanId,
          loan: {
            borrower: loan[0],
            asset: loan[1],
            principalWei: loan[2].toString(),
            interestBps: Number(loan[3]),
            collateralAsset: loan[4],
            collateralAmountWei: loan[5].toString(),
            openedAt: Number(loan[6]),
            dueAt: Number(loan[7]),
            lastAccruedAt: Number(loan[8]),
            accruedInterestWei: loan[9].toString(),
            closed: loan[10],
          },
          outstandingWei: BigInt(outstanding).toString(),
          positionId: positionId ?? 0,
          position: position
            ? {
                owner: position[0],
                collateralAsset: position[1],
                collateralAmountWei: position[2].toString(),
                debtAsset: position[3],
                debtWei: position[4].toString(),
                liquidated: position[5],
              }
            : undefined,
        },
      },
      null,
      2
    )
  );
}

async function repaySecuredLoan() {
  const loanIdRaw = getArg("--loan-id");
  if (!loanIdRaw) throw new Error("Missing --loan-id");
  const loanId = Number(loanIdRaw);
  if (!Number.isInteger(loanId) || loanId <= 0) throw new Error("Invalid --loan-id");

  const amountWeiArg = parseWei(getArg("--amount-wei"), "--amount-wei");
  const amountArg = getArg("--amount");
  const noAutoApprove = process.argv.includes("--no-auto-approve");

  const { wallet, account } = await loadBorrowerAccount();
  const cfg = await getSecuredLoanConfigFromStateOrEnv();
  const publicClient = cfg.publicClient;

  const id = BigInt(loanId);
  const [loan, outstanding] = await Promise.all([
    publicClient.readContract({ address: cfg.loanManager, abi: loanManagerAbi, functionName: "loans", args: [id] }),
    publicClient.readContract({ address: cfg.loanManager, abi: loanManagerAbi, functionName: "outstanding", args: [id] }),
  ]);

  const asset = loan[1] as string;
  if (!asset || !ADDRESS_RE.test(asset)) throw new Error("Failed to read loan asset");

  const outstandingWei = BigInt(outstanding);
  if (outstandingWei === 0n) throw new Error("Nothing to repay");

  const decimals = await readTokenDecimals(publicClient, asset);
  const repayWei = amountWeiArg ?? (amountArg ? parseUnits(amountArg, decimals) : outstandingWei);
  if (repayWei <= 0n) throw new Error("Invalid repay amount");
  if (repayWei > outstandingWei) throw new Error("Repay amount exceeds outstanding");

  const bal = await publicClient.readContract({ address: asset, abi: erc20Abi, functionName: "balanceOf", args: [wallet.address] });
  if (BigInt(bal) < repayWei) throw new Error("Insufficient balance to repay");

  const walletClient = createWalletClient({ account, chain: cfg.chain, transport: http(cfg.rpcUrl) }) as any;

  const { hash, receipt } = await withAutoGas(wallet.address, async () => {
    if (!noAutoApprove) {
      await ensureAllowance({
        chain: cfg.chain,
        rpcUrl: cfg.rpcUrl,
        publicClient,
        walletClient,
        token: asset,
        owner: wallet.address,
        spender: cfg.loanManager,
        required: repayWei,
      });
    }

    const hash = await walletClient.writeContract({
      address: cfg.loanManager,
      abi: loanManagerAbi,
      functionName: "repay",
      args: [id, repayWei],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    return { hash, receipt };
  });
  const newOutstanding = await publicClient.readContract({
    address: cfg.loanManager,
    abi: loanManagerAbi,
    functionName: "outstanding",
    args: [id],
  });

  console.log(
    JSON.stringify(
      {
        txHash: hash,
        status: receipt.status,
        repaidWei: repayWei.toString(),
        outstandingWei: outstandingWei.toString(),
        newOutstandingWei: BigInt(newOutstanding).toString(),
      },
      null,
      2
    )
  );
}

async function withdrawCollateral() {
  const loanIdRaw = getArg("--loan-id");
  if (!loanIdRaw) throw new Error("Missing --loan-id");
  const loanId = Number(loanIdRaw);
  if (!Number.isInteger(loanId) || loanId <= 0) throw new Error("Invalid --loan-id");

  const positionIdArg = getArg("--position-id");
  const amountWeiArg = parseWei(getArg("--amount-wei"), "--amount-wei");
  const amountArg = getArg("--amount");

  const { wallet, account } = await loadBorrowerAccount();
  const cfg = await getSecuredLoanConfigFromStateOrEnv();
  const publicClient = cfg.publicClient;

  let positionId: number | undefined = undefined;
  if (positionIdArg) {
    const v = Number(positionIdArg);
    if (!Number.isInteger(v) || v <= 0) throw new Error("Invalid --position-id");
    positionId = v;
  } else {
    const state = await tryLoadState();
    const fromState = state?.securedLoanPositions?.[String(loanId)];
    if (fromState && Number.isInteger(fromState) && fromState > 0) positionId = fromState;
  }

  if (!positionId) {
    const id = BigInt(loanId);
    const onchain = await publicClient.readContract({ address: cfg.loanManager, abi: loanManagerAbi, functionName: "loanPositions", args: [id] });
    const v = Number(onchain);
    if (Number.isInteger(v) && v > 0) positionId = v;
  }

  if (!positionId) throw new Error("Missing position id (pass --position-id or open the loan with this CLI)");

  const position = await publicClient.readContract({
    address: cfg.positionManager,
    abi: positionManagerAbi,
    functionName: "positions",
    args: [BigInt(positionId)],
  });

  const owner = position[0] as string;
  if (owner.toLowerCase() !== wallet.address.toLowerCase()) throw new Error("Position not owned by this wallet");
  if (position[5]) throw new Error("Position already liquidated");
  if (BigInt(position[4]) !== 0n) throw new Error("Position still has debt; repay first");

  const collateralAsset = position[1] as string;
  const collateralAmountWei = BigInt(position[2]);

  const decimals = await readTokenDecimals(publicClient, collateralAsset);
  const withdrawWei = amountWeiArg ?? (amountArg ? parseUnits(amountArg, decimals) : collateralAmountWei);
  if (withdrawWei <= 0n) throw new Error("Invalid withdraw amount");
  if (withdrawWei > collateralAmountWei) throw new Error("Withdraw amount exceeds collateral");

  const walletClient = createWalletClient({ account, chain: cfg.chain, transport: http(cfg.rpcUrl) }) as any;
  const { hash, receipt } = await withAutoGas(wallet.address, async () => {
    const hash = await walletClient.writeContract({
      address: cfg.positionManager,
      abi: positionManagerAbi,
      functionName: "removeCollateral",
      args: [BigInt(positionId), withdrawWei],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    return { hash, receipt };
  });
  console.log(
    JSON.stringify(
      {
        txHash: hash,
        status: receipt.status,
        positionId,
        collateralAsset,
        withdrawnWei: withdrawWei.toString(),
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
    const force = process.argv.includes("--force");
    if (!force) {
      try {
        const existing = await loadWallet();
        console.log(JSON.stringify({ address: existing.address, walletPath: existing.path, existing: true }, null, 2));
        return;
      } catch {
        // no existing wallet
      }
    }

    const pk = generatePrivateKey();
    const { address, path: p } = await saveWallet(pk);
    console.log(JSON.stringify({ address, walletPath: p, existing: false }, null, 2));
    return;
  }

  if (cmd === "ensure-gas") {
    await ensureGas();
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

  if (cmd === "approve-collateral") {
    await approveCollateral();
    return;
  }

  if (cmd === "open-secured-loan") {
    await openSecuredLoan();
    return;
  }

  if (cmd === "secured-status") {
    await securedStatus();
    return;
  }

  if (cmd === "repay-secured-loan") {
    await repaySecuredLoan();
    return;
  }

  if (cmd === "withdraw-collateral") {
    await withdrawCollateral();
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
