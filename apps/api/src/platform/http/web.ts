import { join, sep } from "node:path";

import type { NestExpressApplication } from "@nestjs/platform-express";
import type { NextFunction, Request, Response } from "express";

const htmlPolicy =
  "default-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'";

/** Serves the built web app: hashed assets long-cached, other GET HTML requests get `index.html`. */
export function serveWeb(app: NestExpressApplication, root: string): void {
  app.useStaticAssets(root, {
    index: false,
    redirect: false,
    setHeaders: (res, path) => {
      if (path.includes(`${sep}assets${sep}`))
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      // The deployed build's identity, which the web app compares with the build it runs.
      else if (path.endsWith(`${sep}version.json`)) res.setHeader("Cache-Control", "no-store");
    },
  });
  const index = join(root, "index.html");
  app.use((req: Request, res: Response, next: NextFunction) => {
    const isPage = (req.method === "GET" || req.method === "HEAD") && !req.path.startsWith("/api/");
    if (!isPage || !req.accepts("html")) return next();
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Content-Security-Policy", htmlPolicy);
    res.sendFile(index, (error) => {
      if (error) next(error);
    });
  });
}
