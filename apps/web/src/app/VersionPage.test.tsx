import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { renderApp } from "../../test/test-app.tsx";
import { runningBuild } from "../infra/build-info.ts";

function serveDeployed(build: object | null) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => (build ? Response.json(build) : new Response("missing", { status: 404 }))),
  );
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("version page", () => {
  it("opens from the footer menu and lists the running build", async () => {
    serveDeployed(runningBuild);
    renderApp();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Menu" }));
    await user.click(screen.getByRole("link", { name: "Version" }));

    expect(await screen.findByRole("heading", { name: "Version" })).toBeTruthy();
    expect(screen.getByText("Revision").nextElementSibling?.textContent).toBe(
      runningBuild.revision.slice(0, 7),
    );
    expect(screen.getByText("Released")).toBeTruthy();
    expect(screen.getByText("Built")).toBeTruthy();
    expect(screen.getByText("App version").nextElementSibling?.textContent).toBe(
      runningBuild.version,
    );
    expect(await screen.findByText("Up to date.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to Search" }).getAttribute("href")).toBe("/");
  });

  it("offers a reload when the server has another build", async () => {
    serveDeployed({ ...runningBuild, revision: "b2c3d4e5f6" });
    renderApp({ path: "/version" });

    expect(
      await screen.findByText(`Update available: ${runningBuild.version} · b2c3d4e.`),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
  });

  it("says so when the deployed build cannot be read", async () => {
    serveDeployed(null);
    renderApp({ path: "/version" });

    expect(await screen.findByText("Couldn't check for updates.")).toBeTruthy();
  });
});
