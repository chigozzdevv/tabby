#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { z } from "zod";
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
      "",
      "Env:",
      "  TABBY_API_BASE_URL   (default: http://localhost:3000)",
      "  MOLTBOOK_API_KEY     (required to auto-mint identity token)",
      "  MOLTBOOK_AUDIENCE    (optional)",
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

  usage();
  process.exit(1);
}

main().catch((err) => {
  console.error(err?.message ?? String(err));
  process.exit(1);
});
