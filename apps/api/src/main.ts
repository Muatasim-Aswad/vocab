import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";

import { AppModule } from "./app.module.js";
import { ConfigError, loadConfig } from "./config.js";
import { configureHttpApp } from "./platform/http/configure.js";
import { createLogger } from "./platform/logger.js";

async function main() {
  let logger = createLogger();
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    logger.fatal({ event: "config_invalid", issues: error.issues }, "Main");
    process.exitCode = 1;
    return;
  }
  logger = createLogger(config.logLevel);

  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), {
    logger,
    bodyParser: false,
    abortOnError: false,
  });
  configureHttpApp(app, { version: config.version, ...config.http }, logger);

  const server = app.getHttpServer();
  server.requestTimeout = config.http.requestTimeoutMs;
  server.headersTimeout = Math.min(config.http.requestTimeoutMs, 60_000);
  await app.listen(config.http.port, config.http.host);

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : config.http.port;
  logger.log(
    { event: "http_listening", host: config.http.host, port, database: config.database.path },
    "Main",
  );

  // Stop accepting connections, let in-flight requests finish, then close the database; bounded.
  const shutdown = (signal: NodeJS.Signals) => {
    logger.log({ event: "shutdown_started", signal }, "Main");
    setTimeout(() => {
      logger.error(
        { event: "shutdown_timeout", timeout_ms: config.http.shutdownTimeoutMs },
        undefined,
        "Main",
      );
      process.exit(1);
    }, config.http.shutdownTimeoutMs).unref();
    app.close().then(
      () => logger.log({ event: "shutdown_complete" }, "Main"),
      (error: unknown) => {
        logger.error({ event: "shutdown_failed", error: String(error) }, undefined, "Main");
        process.exitCode = 1;
      },
    );
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

try {
  await main();
} catch (error) {
  createLogger().fatal({ event: "startup_failed", error: String(error) }, "Main");
  process.exitCode = 1;
}
