import type { FastifyInstance } from "fastify";
import { requireMoltbookAuth } from "@/features/auth/auth.middleware.js";
import { getGasLoanById, getGasLoans, getPublicGasLoanById, getPublicGasLoans } from "@/features/monitoring/monitoring.controller.js";

export function registerMonitoringRoutes(app: FastifyInstance) {
  app.get("/monitoring/gas-loans", { preHandler: requireMoltbookAuth }, getGasLoans);
  app.get("/monitoring/gas-loans/:loanId", { preHandler: requireMoltbookAuth }, getGasLoanById);

  app.get("/public/monitoring/gas-loans", getPublicGasLoans);
  app.get("/public/monitoring/gas-loans/:loanId", getPublicGasLoanById);
}
