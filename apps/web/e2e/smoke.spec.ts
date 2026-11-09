import { expect, test } from "@playwright/test";

import { e2eToken } from "./support/fixtures.ts";
import { baseUrl, signIn } from "./support/session.ts";

test("signs in against the real API without exposing the token", async ({ page }) => {
  const errors: string[] = [];
  const urls: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("request", (request) => urls.push(request.url()));

  await page.goto(baseUrl());
  await expect(page.getByRole("heading", { name: "Sign in to Vocab" })).toBeVisible();
  await page.getByLabel("Access token").fill("wrong-token");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "This token was not accepted. Check it and try again.",
  );
  await expect(page.getByLabel("Access token")).toHaveValue("");

  await signIn(page);
  expect(urls.filter((url) => url.includes(e2eToken))).toEqual([]);
  const storage = await page.evaluate(() =>
    JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage), document.cookie]),
  );
  expect(storage).not.toContain(e2eToken);
  // The HttpOnly session cookie is invisible to scripts.
  expect(storage).not.toContain("vocab_session");
  // The initial session check and the rejected token are the only expected console errors.
  expect(errors.every((error) => error.includes("status of 401"))).toBe(true);
});

test("serves the app for deep links and contract errors for unknown API paths", async ({
  page,
  request,
}) => {
  await page.goto(`${baseUrl()}/some/deep/link`);
  await expect(page.getByRole("heading", { name: "Sign in to Vocab" })).toBeVisible();

  const res = await request.get(`${baseUrl()}/api/unknown`);
  expect(res.status()).toBe(404);
  expect((await res.json()).error).toMatchObject({
    status: 404,
    code: "not_found",
    request_id: res.headers()["x-request-id"],
  });
});
