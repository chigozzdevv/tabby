import { buildApp } from "@/app.js";
import { env } from "@/config/env.js";
import { logger } from "@/config/logger.js";
import { startActivitySync } from "@/features/activity/activity.sync.js";

const app = await buildApp();

try {
  await app.listen({ host: "0.0.0.0", port: env.PORT });
  logger.info({ port: env.PORT }, "server-started");
  startActivitySync();
} catch (error) {
  logger.error({ error }, "server-start-failed");
  process.exit(1);
}
