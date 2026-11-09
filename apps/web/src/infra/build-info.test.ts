import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const key = "vocab.seen-revision";

const blocked = (): Storage => {
  throw new Error("blocked");
};

async function freshModule() {
  vi.resetModules();
  return import("./build-info.ts");
}

beforeEach(() => localStorage.clear());

describe("buildLabel", () => {
  it("pairs the version with the short revision, or shows the revision alone", async () => {
    const { buildLabel } = await freshModule();
    const build = { version: "1.2.0", revision: "a1b2c3d4e5", committedAt: null, builtAt: "" };
    expect(buildLabel(build)).toBe("1.2.0 · a1b2c3d");
    expect(buildLabel({ ...build, version: null })).toBe("a1b2c3d");
  });
});

describe("updateNotice", () => {
  it("records the build silently on a first visit", async () => {
    const { updateNotice, runningBuild } = await freshModule();
    expect(updateNotice()).toBeNull();
    expect(localStorage.getItem(key)).toBe(runningBuild.revision);
  });

  it("announces a new build, with the same answer for the rest of the page load", async () => {
    localStorage.setItem(key, "an-older-revision");
    const { updateNotice, runningBuild } = await freshModule();
    expect(updateNotice()).toEqual(runningBuild);
    expect(updateNotice()).toEqual(runningBuild);
    const next = await freshModule();
    expect(next.updateNotice()).toBeNull();
  });

  it("stays quiet when storage is blocked", async () => {
    const { updateNotice } = await freshModule();
    expect(updateNotice(blocked)).toBeNull();
  });
});
