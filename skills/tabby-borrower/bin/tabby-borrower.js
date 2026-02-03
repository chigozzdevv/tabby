#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

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
      "  next-due",
      "",
      "Env:",
      "  TABBY_API_BASE_URL   (default: http://localhost:3000)",
      "  MOLTBOOK_API_KEY     (required to auto-mint identity token)",
      "  MOLTBOOK_AUDIENCE    (optional)",
      "  MONAD_CHAIN_ID       (optional; defaults to 10143 unless returned by Tabby or cached)",
      "  MONAD_RPC_URL        (optional; defaults to https://testnet-rpc.monad.xyz or https://rpc.monad.xyz)",
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
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

function baseUrl() {
  return process.env.TABBY_API_BASE_URL ?? "http://localhost:3000";
}

async function statePath() {
  return path.join(os.homedir(), ".config", "tabby-borrower", "state.json");
}

async function loadState() {
  const p = await statePath();
  const raw = await fs.readFile(p, "utf8");
  const schema = z
    .object({
      chainId: z.number().int().positive().optional(),
      agentLoanManager: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
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
  const parsed = schema.parse(JSON.parse(raw));
  return { ...parsed, path: p };
}

async function updateState(patch) {
  const p = await statePath();
  await ensureDir(path.dirname(p));
  let existing = {};
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
  const audience = process.env.MOLTBOOK_AUDIENCE;

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
  const chainIdEnv = process.env.MONAD_CHAIN_ID ? Number(process.env.MONAD_CHAIN_ID) : undefined;
  const rpcUrlEnv = process.env.MONAD_RPC_URL;

  const publicConfig = await fetchTabbyPublicConfig();

  let state;
  try {
    state = await loadState();
  } catch {
    state = undefined;
  }

  const chainId = chainIdEnv ?? publicConfig?.chainId ?? state?.chainId ?? 10143;
  if (!Number.isInteger(chainId) || chainId <= 0) throw new Error("Invalid MONAD_CHAIN_ID");

  const rpcUrl = rpcUrlEnv ?? defaultRpcUrl(chainId);
  if (!rpcUrl) throw new Error("Missing MONAD_RPC_URL");

  const agentLoanManager = publicConfig?.agentLoanManager ?? state?.agentLoanManager;
  if (!agentLoanManager) {
    throw new Error("Missing agentLoanManager; set it in server env or add it to ~/.config/tabby-borrower/state.json");
  }

  const chain = {
    id: chainId,
    name: chainId === 143 ? "Monad Mainnet" : "Monad Testnet",
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  };

  return { chain, rpcUrl, agentLoanManager };
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

  const account = privateKeyToAccount(wallet.privateKey);
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
    await updateState({
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
  const res = await fetch(url);
  if (!res.ok) throw new Error(`status failed (${res.status})`);
  const json = await res.json();
  console.log(JSON.stringify(json, null, 2));
}

async function nextDue() {
  const state = await loadState();
  const last = state.lastGasLoan;
  if (!last) throw new Error("No cached loan found in state.json");

  const now = Math.floor(Date.now() / 1000);
  const dueInSeconds = last.dueAt - now;

  console.log(
    JSON.stringify(
      {
        loanId: last.loanId,
        borrower: last.borrower,
        dueAt: last.dueAt,
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

  const statusUrl = new URL(`/public/monitoring/gas-loans/${loanId}`, baseUrl());
  const statusRes = await fetch(statusUrl);
  if (!statusRes.ok) throw new Error(`status failed (${statusRes.status})`);
  const statusJson = await statusRes.json();

  const outstandingWei = statusJson?.data?.onchain?.outstandingWei;
  if (typeof outstandingWei !== "string" || !/^\d+$/.test(outstandingWei)) {
    throw new Error("Missing outstandingWei in monitoring response");
  }

  const repayWei = amountWeiArg ?? outstandingWei;
  if (!/^\d+$/.test(repayWei)) throw new Error("Invalid --amount-wei");
  if (BigInt(repayWei) === 0n) throw new Error("Nothing to repay");

  const wallet = await loadWallet();
  const account = privateKeyToAccount(wallet.privateKey);

  const { chain, rpcUrl, agentLoanManager } = await getChainConfigFromStateOrEnv();

  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });

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

  usage();
  process.exit(1);
}

main().catch((err) => {
  console.error(err?.message ?? String(err));
  process.exit(1);
});
