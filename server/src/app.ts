import fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";
import { env } from "@/config/env.js";
import { logger } from "@/config/logger.js";
import { connectMongo } from "@/db/mongodb.js";
import { registerAuthRoutes } from "@/features/auth/auth.routes.js";
import { registerActivityRoutes } from "@/features/activity/activity.routes.js";
import { registerLoansRoutes } from "@/features/loans/loans.routes.js";
import { registerLiquidityRoutes } from "@/features/liquidity/liquidity.routes.js";
import { registerMonitoringRoutes } from "@/features/monitoring/monitoring.routes.js";
import { registerPublicConfigRoutes } from "@/features/public-config/public-config.routes.js";
import { HttpError } from "@/shared/http-errors.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = fastify({
    logger: logger,
    requestTimeout: 30_000,
  });

  await app.register(cors, {
    origin: env.CORS_ORIGIN ?? true,
    credentials: true,
  });

  await connectMongo();

  app.get("/health", async () => ({ ok: true }));

  registerAuthRoutes(app);
  registerActivityRoutes(app);
  registerLoansRoutes(app);
  registerLiquidityRoutes(app);
  registerMonitoringRoutes(app);
  registerPublicConfigRoutes(app);

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) {
      return reply.status(error.statusCode).send({ ok: false, code: error.code, message: error.message });
    }
    if (error instanceof z.ZodError) {
      return reply.status(400).send({ ok: false, code: "validation-error", issues: error.issues });
    }
    request.log.error({ error }, "unhandled-error");
    return reply.status(500).send({ ok: false, code: "internal", message: "Internal server error" });
  });

  return app;
}
