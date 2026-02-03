import type { FastifyInstance } from "fastify";
import { env } from "@/config/env.js";

export function registerPublicConfigRoutes(app: FastifyInstance) {
  app.get("/public/config", async () => ({
    ok: true,
    data: {
      chainId: env.CHAIN_ID,
      agentLoanManager: env.AGENT_LOAN_MANAGER_ADDRESS,
    },
  }));
}

