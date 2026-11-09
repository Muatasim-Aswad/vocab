/// <reference lib="webworker" />
import { clientsClaim } from "workbox-core";
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";

declare const self: ServiceWorkerGlobalScope & {
  readonly __WB_MANIFEST: readonly ({ url: string; revision: string | null } | string)[];
};

// Only the built shell and its assets are cached. API requests are never routed here, so they
// always reach the network and study data is never served stale.
cleanupOutdatedCaches();
precacheAndRoute(self["__WB_MANIFEST"]);

// Deep links load the shell, as the server does.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL("/index.html"), {
    // `/version.json` opened by hand must be the deployed build's record, not the shell.
    denylist: [/^\/api\//, /^\/version\.json$/],
  }),
);

// A new deploy takes over at once, so an installed app never keeps an old shell against a newer
// API. The running page is not reloaded; it switches on its next load. Safe while the build is one
// eagerly loaded bundle: code splitting would let an old page request chunks that no longer exist.
void self.skipWaiting();
clientsClaim();
