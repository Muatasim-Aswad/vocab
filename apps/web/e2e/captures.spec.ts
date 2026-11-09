import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { z } from "zod";

import { uuidV7 } from "../src/shared/uuid.ts";
import { e2eToken } from "./support/fixtures.ts";
import { baseUrl, lookup, resultLink, signIn } from "./support/session.ts";

// Captures against the built API: capture from Search and the Captures page, complete through Add
// with the atomic API consumption, complete a stub in place, and server-kept recent searches on a phone.

const searchbox = (page: Page) => page.getByRole("searchbox", { name: "Word or phrase" });
const bearer = { authorization: `Bearer ${e2eToken}` };

async function search(page: Page, query: string) {
  await searchbox(page).fill(query);
  await searchbox(page).press("Enter");
  await expect(page.getByRole("status").first()).not.toHaveText(/Updating/);
}

async function capturedTerms(request: APIRequestContext) {
  const response = await request.get(`${baseUrl()}/api/captures?limit=100`, { headers: bearer });
  expect(response.status()).toBe(200);
  return z
    .object({ items: z.array(z.object({ term: z.string() })) })
    .parse(await response.json())
    .items.map((item) => item.term);
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test("captures a new word from Search and the Captures page, then adds it through Add", async ({
  page,
  request,
}) => {
  await signIn(page);
  await search(page, "de kater");
  await page.getByRole("button", { name: "Capture for later" }).click();
  await expect(page.getByText("Captured “de kater”.")).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "Word or phrase" })).toHaveValue("");
  await expect(page.getByRole("searchbox", { name: "Word or phrase" })).toBeFocused();
  expect(await capturedTerms(request)).toContain("de kater");

  // A word that is not captured lists the captured terms starting with it.
  await search(page, "de kat");
  await expect(page.getByRole("button", { name: "Capture for later" })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Captured terms starting with “de kat”" }).getByTestId("term"),
  ).toHaveText(["de kater"]);

  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("link", { name: "Captures" }).click();
  const field = page.getByRole("textbox", { name: "Word or phrase to capture" });
  await expect(field).toBeFocused();
  await field.fill("De  KATER");
  await field.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "Captured “de kater”." })).toBeVisible();
  await expect(field).toBeFocused();
  await field.fill("het kaartje");
  await field.press("Enter");
  await expect(page.getByRole("main").getByTestId("term").first()).toHaveText("het kaartje");
  expect((await capturedTerms(request)).filter((term) => term === "de kater")).toHaveLength(1);

  await page.getByRole("button", { name: "Remove het kaartje" }).click();
  await expect(
    page.getByRole("main").getByTestId("term").filter({ hasText: "het kaartje" }),
  ).toHaveCount(0);
  expect(await capturedTerms(request)).not.toContain("het kaartje");

  await page.getByRole("button", { name: "Add entry de kater" }).click();
  await expect(page.getByRole("textbox", { name: "Word or phrase" })).toHaveValue("de kater");
  await page.getByRole("button", { name: "Add notes" }).click();
  await page.getByLabel(/^Notes/).fill("tomcat, or hangover");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Added “de kater”")).toBeVisible();
  expect(await capturedTerms(request)).not.toContain("de kater");
  const [kater] = await lookup(request, "kater");
  expect(kater!.entry).toMatchObject({ lemma: "kater", status: "active" });
});

test("completes a stub in place, keeping its ID and relations, then edits it from its page", async ({
  page,
  request,
}) => {
  const created = await request.post(`${baseUrl()}/api/entries`, {
    headers: bearer,
    data: { mutationId: uuidV7(), entry: { lemma: "kuieren", relatedTokens: ["+slenteren"] } },
  });
  expect(created.status()).toBe(200);
  const [stub] = await lookup(request, "slenteren");
  expect(stub!.entry.status).toBe("stub");

  await signIn(page);
  await page.goto(`${baseUrl()}/add`);
  const term = page.getByRole("textbox", { name: "Word or phrase" });
  await term.fill("slenteren");
  await term.press("Enter");
  await expect(
    page.getByRole("heading", { name: "“slenteren” already has 1 meaning" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit this entry" }).click();
  await expect(page).toHaveURL(new RegExp(`/entries/${stub!.entry.id}/edit$`));
  await page.getByRole("button", { name: "Add notes" }).click();
  await page.getByLabel(/^Notes/).fill("to stroll");
  await expect(page.getByLabel(/^Label for/)).toHaveCount(0);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Completed “slenteren”")).toBeVisible();
  await expect(searchbox(page)).toBeVisible();
  await page.goto(`${baseUrl()}/entries/${stub!.entry.id}`);
  await expect(page.getByText("to stroll", { exact: true })).toBeVisible();

  const [completed] = await lookup(request, "slenteren");
  expect(completed!.entry).toMatchObject({
    id: stub!.entry.id,
    status: "active",
    extra: "to stroll",
  });
  expect(completed!.relations).toEqual(stub!.relations);
  expect(await lookup(request, "slenteren")).toHaveLength(1);

  // The entry page's Edit icon opens the same form; saving returns to Search.
  await page.getByRole("link", { name: "Edit entry" }).click();
  await page.getByLabel(/^Notes/).fill("to stroll slowly");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Updated “slenteren”")).toBeVisible();
  await expect(searchbox(page)).toBeVisible();
  await page.goBack();
  await expect(page.getByText("to stroll slowly", { exact: true })).toBeVisible();
});

test("shows recent searches on an empty phone-width Search without horizontal scrolling", async ({
  browser,
  request,
}) => {
  const cleared = await request.post(`${baseUrl()}/api/search-history/clears`, {
    headers: bearer,
    data: { id: uuidV7(), clearedAt: new Date().toISOString() },
  });
  expect(cleared.status()).toBe(200);
  const context = await browser.newContext({ viewport: { width: 360, height: 800 } });
  const page = await context.newPage();
  await signIn(page);
  // Leaving the field (a tap outside it) records the search; Clear does not.
  for (const query of ["lopen", "de arbeidsongeschiktheidsverzekering", "bank"]) {
    await search(page, query);
    await page.mouse.click(4, 600);
  }
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await searchbox(page).fill("kaas");
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  const recent = page.getByRole("region", { name: "Recent searches" });
  await expect(recent.getByRole("listitem")).toHaveText([
    "bank",
    "de arbeidsongeschiktheidsverzekering",
    "lopen",
  ]);
  await noHorizontalScroll(page);
  const stored = await request.get(`${baseUrl()}/api/search-history`, { headers: bearer });
  expect(z.object({ terms: z.array(z.string()) }).parse(await stored.json()).terms).toEqual([
    "bank",
    "de arbeidsongeschiktheidsverzekering",
    "lopen",
  ]);
  await recent.getByRole("link", { name: "lopen" }).click();
  await expect(searchbox(page)).toHaveValue("lopen");
  await expect(resultLink(page, "lopen")).toBeVisible();

  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("link", { name: "Captures" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Captures" })).toBeVisible();
  await noHorizontalScroll(page);
  await context.close();
});
