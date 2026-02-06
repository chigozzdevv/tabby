import type { FastifyInstance } from "fastify";
import { env } from "@/config/env.js";

export function registerPublicConfigRoutes(app: FastifyInstance) {
  app.get("/public/config", async () => ({
    ok: true,
    data: {
      chainId: env.CHAIN_ID,
      agentLoanManager: env.AGENT_LOAN_MANAGER_ADDRESS,
      loanManager: env.LOAN_MANAGER_ADDRESS,
      positionManager: env.POSITION_MANAGER_ADDRESS,
      securedPool: env.SECURED_POOL_ADDRESS,
      collateralAsset: env.COLLATERAL_ASSET,
    },
  }));
}
