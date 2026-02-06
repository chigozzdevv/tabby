import pino, { type LoggerOptions } from "pino";
import { env } from "@/config/env.js";

export const loggerOptions: LoggerOptions = {
  level: env.NODE_ENV === "production" ? "info" : "debug",
  base: undefined,
  messageKey: "message",
  timestamp: pino.stdTimeFunctions.isoTime,
};

export const logger = pino(loggerOptions);
