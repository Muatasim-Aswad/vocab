import { z } from "zod";

/** Running build (baked in by the `build-info` Vite plugin) and deployed build (`/version.json`). */
const buildInfo = z.object({
  /** `package.json` version, when the app has one. */
  version: z.string().nullable(),
  /** Commit SHA, or `dev` for a build with neither git nor srvr. */
  revision: z.string(),
  committedAt: z.string().nullable(),
  builtAt: z.string(),
});
export type BuildInfo = z.infer<typeof buildInfo>;

export const runningBuild: BuildInfo = buildInfo.parse(JSON.parse(import.meta.env.BUILD_INFO));

const seenRevisionKey = "vocab.seen-revision";

export const shortRevision = (revision: string) => revision.slice(0, 7);

/** `1.2.0 · a1b2c3d`, or the revision alone without a version. */
export function buildLabel(build: BuildInfo): string {
  const revision = shortRevision(build.revision);
  return build.version === null ? revision : `${build.version} · ${revision}`;
}

export function announceBuild(): void {
  console.info(`Vocab ${buildLabel(runningBuild)}, built ${runningBuild.builtAt}`);
}

/** The deployed build, or `null` when it cannot be read (offline, dev server, older deploy). */
export async function fetchDeployedBuild(): Promise<BuildInfo | null> {
  try {
    const response = await fetch("/version.json", { cache: "no-store" });
    if (!response.ok) return null;
    const parsed = buildInfo.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

let notice: BuildInfo | null | undefined;

/**
 * The running build if this device last ran another one; first visits and blocked storage give
 * `null`. Reads and records once per page load, so repeated renders get the same answer.
 */
export function updateNotice(storage: () => Storage = () => localStorage): BuildInfo | null {
  if (notice !== undefined) return notice;
  notice = null;
  try {
    const seen = storage().getItem(seenRevisionKey);
    storage().setItem(seenRevisionKey, runningBuild.revision);
    if (seen !== null && seen !== runningBuild.revision) notice = runningBuild;
  } catch {
    // Without storage there is nothing to compare against.
  }
  return notice;
}

/**
 * Reloads onto the deployed build. The worker takes over as soon as it installs, so this asks it
 * to check, waits briefly for the switch, and reloads either way.
 */
export async function reloadToLatest(): Promise<void> {
  const registration =
    "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
  if (registration) {
    const switched = new Promise<void>((resolve) => {
      navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true });
      window.setTimeout(resolve, 5000);
    });
    await registration.update().catch(() => undefined);
    if (registration.installing || registration.waiting) await switched;
  }
  window.location.reload();
}
