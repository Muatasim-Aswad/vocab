import type { LoggerService } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { requestIdHeader } from "@vocab/contracts";

import { concurrencyLimit, hostGuard, securityHeaders } from "./boundary.js";
import type { HttpOptions } from "./options.js";
import { requestContext } from "./request-context.js";
import { serveWeb } from "./web.js";

/**
 * Express-level boundary, in order: correlation and logging, Host check, CORS, concurrency bound,
 * security headers, optional web app, then a size-limited JSON body parser. Call before `init()`;
 * create the app with `bodyParser: false`.
 */
export function configureHttpApp(
  app: NestExpressApplication,
  options: HttpOptions,
  logger: LoggerService,
): void {
  app.disable("x-powered-by");
  app.use(requestContext(logger));
  app.use(hostGuard(options.allowedHosts));
  if (options.corsOrigins.length) {
    app.enableCors({
      origin: options.corsOrigins,
      credentials: true,
      allowedHeaders: ["authorization", "content-type", requestIdHeader],
      exposedHeaders: [requestIdHeader],
      maxAge: 600,
    });
  }
  app.use(concurrencyLimit(options.maxConcurrentRequests));
  app.use(securityHeaders);
  if (options.webRoot) serveWeb(app, options.webRoot);
  app.useBodyParser("json", { limit: options.bodyLimitBytes });
}
