import type { FastifyInstance } from "fastify";
import { requireMoltbookAuth } from "@/features/auth/auth.middleware.js";
import { getMe } from "@/features/auth/auth.controller.js";

export function registerAuthRoutes(app: FastifyInstance) {
  app.get("/auth/me", { preHandler: requireMoltbookAuth }, getMe);
}
