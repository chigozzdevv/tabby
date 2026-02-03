import type { FastifyInstance } from "fastify";
import { requireMoltbookAuth } from "@/features/auth/auth.middleware.js";
import { postExecuteGasLoan, postGasLoanOffer } from "@/features/loans/loans.controller.js";

export function registerLoansRoutes(app: FastifyInstance) {
  app.post("/loans/gas/offer", { preHandler: requireMoltbookAuth }, postGasLoanOffer);
  app.post("/loans/gas/execute", { preHandler: requireMoltbookAuth }, postExecuteGasLoan);
}
