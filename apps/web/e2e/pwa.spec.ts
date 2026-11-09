import { expect, test, type Page } from "@playwright/test";
import { z } from "zod";

import { baseUrl, signIn } from "./support/session.ts";

/** Loads the app until its service worker controls the page. */
async function installAndControl(page: Page) {
  await page.goto(baseUrl());
  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? ""))
    .toBe(`${baseUrl()}/sw.js`);
}

test("publishes an installable manifest", async ({ page, request }) => {
  await page.goto(baseUrl());
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  const response = await request.get(new URL(href!, baseUrl()).href);
  expect(response.headers()["content-type"]).toContain("application/manifest+json");
  const manifest = z
    .object({
      icons: z.array(z.object({ src: z.string(), sizes: z.string(), purpose: z.string() })),
    })
    .passthrough()
    .parse(await response.json());
  expect(manifest).toMatchObject({
    id: "/",
    name: "Vocab",
    start_url: "/",
    scope: "/",
    display: "standalone",
  });
  for (const { size, purpose } of [
    { size: "192x192", purpose: "any" },
    { size: "512x512", purpose: "any" },
    { size: "512x512", purpose: "maskable" },
  ]) {
    const icon = manifest.icons.find((i) => i.sizes === size && i.purpose === purpose);
    expect(icon, `${size} ${purpose} icon`).toBeDefined();
    const res = await request.get(new URL(icon!.src, baseUrl()).href);
    expect(res.headers()["content-type"]).toBe("image/png");
  }
});

test("loads the shell offline and never caches API responses", async ({ context, page }) => {
  await signIn(page);
  await installAndControl(page);
  await expect(page.getByRole("heading", { name: "Search vocabulary" })).toBeVisible();

  const cached = await page.evaluate(async () => {
    const names = await caches.keys();
    const requests = await Promise.all(names.map(async (name) => (await caches.open(name)).keys()));
    return requests.flat().map((r) => new URL(r.url).pathname);
  });
  expect(cached).toContain("/index.html");
  expect(cached.filter((path) => path.startsWith("/api/"))).toEqual([]);

  await context.setOffline(true);
  await page.goto(`${baseUrl()}/some/deep/link`);
  await expect(page.getByText("Vocab could not be reached.", { exact: false })).toBeVisible();
});
