import type { FastifyInstance } from "fastify";
import { requireMoltbookAuth } from "@/features/auth/auth.middleware.js";
import { getActivity, getPublicActivity } from "@/features/activity/activity.controller.js";

export function registerActivityRoutes(app: FastifyInstance) {
  app.get("/activity", { preHandler: requireMoltbookAuth }, getActivity);
  app.get("/public/activity", getPublicActivity);
}

