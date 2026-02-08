import type { FastifyInstance } from "fastify";
import { requireGasLoanAuth } from "@/features/auth/auth.middleware.js";
import { postExecuteGasLoan, postGasLoanOffer, postRegisterBorrowerPolicy } from "@/features/loans/loans.controller.js";

export function registerLoansRoutes(app: FastifyInstance) {
  app.post("/loans/gas/policy/register", { preHandler: requireGasLoanAuth }, postRegisterBorrowerPolicy);
  app.post("/loans/gas/offer", { preHandler: requireGasLoanAuth }, postGasLoanOffer);
  app.post("/loans/gas/execute", { preHandler: requireGasLoanAuth }, postExecuteGasLoan);
}
