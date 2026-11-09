import { ConsoleLogger, type LogLevel } from "@nestjs/common";

const levels: LogLevel[] = ["fatal", "error", "warn", "log", "debug", "verbose"];

/** One JSON object per line on stdout/stderr. */
export function createLogger(level: Exclude<LogLevel, "fatal"> = "log"): ConsoleLogger {
  return new ConsoleLogger({
    json: true,
    colors: false,
    logLevels: levels.slice(0, levels.indexOf(level) + 1),
  });
}
