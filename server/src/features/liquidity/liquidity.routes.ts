import type { FastifyInstance } from "fastify";
import { env } from "@/config/env.js";
import {
  getNativeDepositQuote,
  getNativeLpPosition,
  getNativeWithdrawQuote,
  getPools,
  getRewards,
  getSecuredDepositQuote,
  getSecuredLpPosition,
  getSecuredWithdrawQuote,
  getUsdcDepositQuote,
  getUsdcLpPosition,
  getUsdcWithdrawQuote,
} from "@/features/liquidity/liquidity.controller.js";

export function registerLiquidityRoutes(app: FastifyInstance) {
  app.get("/liquidity/pools", getPools);
  app.get("/liquidity/rewards", getRewards);
  app.get("/liquidity/native/position", getNativeLpPosition);
  app.get("/liquidity/native/quote/deposit", getNativeDepositQuote);
  app.get("/liquidity/native/quote/withdraw", getNativeWithdrawQuote);

  if (env.SECURED_POOL_ADDRESS) {
    app.get("/liquidity/secured/position", getSecuredLpPosition);
    app.get("/liquidity/secured/quote/deposit", getSecuredDepositQuote);
    app.get("/liquidity/secured/quote/withdraw", getSecuredWithdrawQuote);
  }

  if (env.USDC_POOL_ADDRESS) {
    app.get("/liquidity/usdc/position", getUsdcLpPosition);
    app.get("/liquidity/usdc/quote/deposit", getUsdcDepositQuote);
    app.get("/liquidity/usdc/quote/withdraw", getUsdcWithdrawQuote);
  }
}
