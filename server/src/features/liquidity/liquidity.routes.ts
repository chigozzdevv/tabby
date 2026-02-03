import type { FastifyInstance } from "fastify";
import { getPools } from "@/features/liquidity/liquidity.controller.js";

export function registerLiquidityRoutes(app: FastifyInstance) {
  app.get("/liquidity/pools", getPools);
}
