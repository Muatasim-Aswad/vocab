import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";
import { z } from "zod";

import { migrate, startApi } from "./support/api-server.ts";
import { e2eToken, werkWords } from "./support/fixtures.ts";
import { baseUrl, lookup, resultLink, signIn, updateSenseCue } from "./support/session.ts";

// Real-browser acceptance against the built API serving the built web app, with a migrated
// disposable database seeded through the API (see global-setup.ts).

test.describe.configure({ timeout: 120_000 });

const visual = resolve(import.meta.dirname, "../node_modules/.playwright/visual");

const searchbox = (page: Page) => page.getByRole("searchbox", { name: "Word or phrase" });

/** A save returns to Search; the footer opens Add again. */
async function addAnother(page: Page) {
  await expect(searchbox(page)).toBeVisible();
  await footerLink(page, "Add").click();
}
/** Search shows the Add icon link in the footer; every other page shows Search. */
const footerLink = (page: Page, name: string) =>
  page.getByRole("contentinfo").getByRole("link", { name, exact: true });

async function openMenu(page: Page) {
  const menu = page.getByRole("button", { name: "Menu" });
  if ((await menu.getAttribute("aria-expanded")) !== "true") await menu.click();
}

/** Result lemmas in order, without the article shown before nouns. */
const resultTerms = (page: Page) =>
  page.getByTestId("term").evaluateAll((terms) =>
    terms.map((term) =>
      [...term.childNodes]
        .filter((node) => !(node instanceof HTMLSpanElement))
        .map((node) => node.textContent)
        .join(""),
    ),
  );

/** The panel the entry page's Entry details button opens. */
async function entryDetails(page: Page) {
  const id = await page
    .getByRole("button", { name: "Entry details" })
    .getAttribute("aria-controls");
  return page.locator(`[id="${id}"]`);
}

async function search(page: Page, query: string) {
  await searchbox(page).fill(query);
  await searchbox(page).press("Enter");
  await expect(page.getByRole("status")).not.toHaveText(/Updating/);
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test("compatibility: web:search", async ({ page, request }) => {
  await signIn(page);
  const queries: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("/api/entries/search"))
      queries.push(new URL(req.url()).searchParams.get("query")!);
  });

  // Debounced typing sends one request. Lemma/alias matches rank first, then forms, then
  // entries related to a match (the `wandelen` stub is a synonym of `lopen`).
  await searchbox(page).pressSequentially("loop", { delay: 40 });
  await expect.poll(() => resultTerms(page)).toEqual(["loop", "lopen", "wandelen"]);
  expect(queries).toEqual(["loop"]);
  expect(page.url()).toContain("?q=loop");

  // Relation matches rank after the related entry itself.
  await search(page, "wandel");
  await expect.poll(() => resultTerms(page)).toEqual(["wandelen", "lopen"]);

  // Distinct meanings stay distinct and carry their labels in the link name.
  await search(page, "bank");
  await expect(page.getByRole("link", { name: "bank geld" })).toBeVisible();
  await expect(page.getByRole("link", { name: "bank zitmeubel" })).toBeVisible();

  // Type filter and opt-in example/collocation scope.
  await page.getByRole("button", { name: "Search options" }).click();
  await page.getByLabel("Type", { exact: true }).selectOption("verb");
  await search(page, "loop");
  await expect.poll(() => resultTerms(page)).toEqual(["lopen"]);
  await expect(page.getByText("Type: Verb")).toBeVisible();
  await page.getByLabel("Type", { exact: true }).selectOption("");
  await search(page, "*groot*");
  await expect(page.getByRole("button", { name: "Add", exact: true })).toBeVisible();
  // The checkbox reflects the URL, so it changes once navigation commits.
  await page.getByLabel("Include examples and collocations").click();
  await expect(page.getByLabel("Include examples and collocations")).toBeChecked();
  await expect.poll(() => resultTerms(page)).toEqual(["huis"]);
  await page.getByLabel("Include examples and collocations").click();
  await expect(page.getByLabel("Include examples and collocations")).not.toBeChecked();

  // Explicit cursor pagination preserves the server's order to the final page.
  await search(page, "werk");
  await expect.poll(async () => (await resultTerms(page)).length).toBe(20);
  await page.getByRole("button", { name: "Load more" }).click();
  await expect.poll(async () => (await resultTerms(page)).length).toBe(werkWords.length);
  await expect(page.getByRole("button", { name: "Load more" })).toHaveCount(0);
  const serverOrder: string[] = [];
  for (let cursor: string | null | undefined; cursor !== null;) {
    const res = await request.get(
      `${baseUrl()}/api/entries/search?query=werk&limit=20${cursor ? `&cursor=${cursor}` : ""}`,
      { headers: { authorization: `Bearer ${e2eToken}` } },
    );
    const body = z
      .object({
        items: z.array(z.object({ lemma: z.string() })),
        metadata: z.object({ next_cursor: z.string().nullable() }),
      })
      .parse(await res.json());
    serverOrder.push(...body.items.map((item) => item.lemma));
    cursor = body.metadata.next_cursor;
  }
  expect(await resultTerms(page)).toEqual(serverOrder);

  // Read-only detail with relation links, including a minimal stub target.
  await search(page, "lopen");
  await resultLink(page, "lopen").click();
  await expect(page.getByRole("heading", { level: 1, name: "lopen" })).toBeVisible();
  await expect(page.getByText("loop, loopt, liep, liepen, gelopen")).toBeVisible();
  await expect(page.getByTitle("Synonym")).toBeVisible();
  await expect(page.getByTitle("Word family")).toBeVisible();
  const [lopen] = await lookup(request, "lopen");
  await expect(await entryDetails(page)).toBeHidden();
  await page.getByRole("button", { name: "Entry details" }).click();
  await expect(await entryDetails(page)).toBeVisible();
  await expect(await entryDetails(page)).toContainText(String(lopen!.entry.id));
  await page.getByRole("link", { name: "wandelen" }).click();
  await page.getByRole("button", { name: "Entry details" }).click();
  await expect(await entryDetails(page)).toContainText("Statusstub");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Back to search" }).click();
  await expect(searchbox(page)).toHaveValue("lopen");
  await expect(resultLink(page, "lopen")).toBeVisible();
});

test("compatibility: web:add", async ({ page, request }) => {
  await signIn(page);
  await footerLink(page, "Add").click();
  const term = page.getByRole("textbox", { name: "Word or phrase" });

  // Quick add with only the term.
  await term.fill("de fiets");
  await term.press("Enter");
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeVisible();
  await term.press("Enter");
  await expect(page.getByText("Added “de fiets”")).toBeVisible();
  const [fiets] = await lookup(request, "fiets");
  expect(fiets!.entry).toMatchObject({ lemma: "fiets", grammar: { article: "de" } });

  // API inference, optional details, and relations with a pending stub and an explicit target.
  await addAnother(page);
  await expect(term).toHaveValue("");
  await expect(term).toBeFocused();
  await term.fill("lachen");
  await term.press("Enter");
  await page.getByRole("button", { name: "Add notes" }).click();
  await page.getByLabel(/^Notes/).fill("to laugh");
  await page.getByRole("textbox", { name: "Example 1" }).fill("Wij lachen samen");
  await expect(page.getByLabel(/^Word type/)).toHaveValue("VERB");
  // Suggested forms of a new word are saved unless removed.
  await expect(
    page.locator("#add-forms li").filter({ hasText: "(suggested)" }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add tag" }).click();
  await page.getByRole("textbox", { name: "Add tag" }).fill("emotie");
  await page.getByRole("textbox", { name: "Add tag" }).press("Enter");
  await page.getByRole("button", { name: "Add related word" }).click();
  await page.getByLabel("Relation 1").selectOption("antonym");
  await page.getByRole("textbox", { name: "Related word 1" }).fill("huilen");
  await page.getByRole("button", { name: "Find" }).first().click();
  await expect(
    page.getByTitle("“huilen” is not in your vocabulary yet. Saving adds it as a minimal entry."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add related word" }).click();
  await page.getByRole("textbox", { name: "Related word 2" }).fill("bank");
  await page.getByRole("button", { name: "Find" }).nth(1).click();
  await page.getByRole("radio", { name: /bank \(zitmeubel\)/ }).check();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Added “lachen”")).toBeVisible();
  const [lachen] = await lookup(request, "lachen");
  const [zitmeubel] = (await lookup(request, "bank")).filter(
    (item) => item.entry.senseCue === "zitmeubel",
  );
  expect(lachen!.entry).toMatchObject({
    extra: "to laugh",
    examples: ["Wij lachen samen."],
    partOfSpeech: "VERB",
    tags: expect.arrayContaining(["emotie"]),
  });
  expect(z.array(z.string()).parse(lachen!.entry.forms).length).toBeGreaterThan(0);
  expect(lachen!.relations).toEqual(
    expect.arrayContaining([
      { type: "antonym", entry: expect.objectContaining({ lemma: "huilen", status: "stub" }) },
      { type: "related", entry: expect.objectContaining({ id: zitmeubel!.entry.id }) },
    ]),
  );

  // Another meaning of an existing word backfills the old meaning's label atomically.
  await addAnother(page);
  await term.fill("de band");
  await term.press("Enter");
  await expect(
    page.getByRole("heading", { name: "“de band” already has 1 meaning" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add another meaning" }).click();
  await page.getByLabel(/Label for the existing meaning/).fill("muziekgroep");
  await page.getByLabel("Label for this new meaning").fill("fietsband");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Added “de band”")).toBeVisible();
  expect(
    (await lookup(request, "band"))
      .map((item) => item.entry.senseCue ?? "")
      .toSorted((a, b) => a.localeCompare(b)),
  ).toEqual(["fietsband", "muziekgroep"]);

  // A concurrent change to an existing meaning stops the save with nothing persisted.
  await addAnother(page);
  await term.fill("de bal");
  await term.press("Enter");
  await page.getByRole("button", { name: "Add another meaning" }).click();
  await page.getByLabel(/Label for the existing meaning/).fill("speelgoed");
  await page.getByLabel("Label for this new meaning").fill("dansfeest");
  await page.getByRole("button", { name: "Continue" }).click();
  const [bal] = await lookup(request, "bal");
  await updateSenseCue(request, bal!.entry.id, bal!.entry.revision, "voetbal");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("#add-notice")).toContainText(
    "existing meanings changed since you opened them",
  );
  let balls = await lookup(request, "bal");
  expect(balls.map((item) => item.entry.senseCue)).toEqual(["voetbal"]);
  await expect(page.getByLabel("Label for this new meaning")).toHaveValue("dansfeest");

  // A duplicate label is rejected by the API without partial writes.
  await page.getByLabel("Label for this new meaning").fill("Voetbal");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("#add-notice")).toContainText("already used for this word");
  expect(await lookup(request, "bal")).toHaveLength(1);
  await page.getByLabel("Label for this new meaning").fill("dansfeest");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Added “de bal”")).toBeVisible();
  balls = await lookup(request, "bal");
  expect(
    balls.map((item) => item.entry.senseCue ?? "").toSorted((a, b) => a.localeCompare(b)),
  ).toEqual(["dansfeest", "voetbal"]);

  // A committed write whose response is lost is reconciled with the same identity: one entry.
  await addAnother(page);
  let lose = true;
  const bodies: string[] = [];
  await page.route("**/api/entries", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    bodies.push(route.request().postData()!);
    if (!lose) return route.continue();
    lose = false;
    await route.fetch();
    await route.abort("connectionreset");
  });
  await term.fill("de wortel");
  await term.press("Enter");
  await page.getByRole("button", { name: "Add notes" }).click();
  await page.getByLabel(/^Notes/).fill("carrot");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "did not confirm whether “de wortel” was saved",
  );
  await expect(page.getByLabel(/^Notes/)).toBeDisabled();
  await page.getByRole("button", { name: "Check again and save" }).click();
  await expect(page.getByText("Added “de wortel”")).toBeVisible();
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toBe(bodies[0]);
  expect(await lookup(request, "wortel")).toHaveLength(1);
  await page.unroute("**/api/entries");

  // A double-click sends one save.
  await addAnother(page);
  await term.fill("de peer");
  await term.press("Enter");
  await page.getByRole("button", { name: "Save", exact: true }).dblclick();
  await expect(page.getByText("Added “de peer”")).toBeVisible();
  expect(await lookup(request, "peer")).toHaveLength(1);
});

test("compatibility: web:locale", async ({ page, browser }) => {
  await signIn(page);
  await search(page, "bank");
  await openMenu(page);
  await page.getByRole("button", { name: "Language English" }).click();
  await expect(page.getByRole("heading", { name: "Woordenschat doorzoeken" })).toBeVisible();
  await expect(page.getByRole("link", { name: "bank geld" })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText(/^\d+ resultaten$/);
  await expect(searchbox(page)).toHaveCount(0);
  await expect(page.getByRole("searchbox", { name: "Woord of uitdrukking" })).toHaveValue("bank");
  expect(await page.evaluate(() => document.documentElement.lang)).toBe("nl");
  await expect(page).toHaveTitle("Zoeken – Vocab");
  await page.getByRole("link", { name: "bank geld" }).click();
  await expect(page.getByRole("button", { name: "Gegevens van dit woord" })).toBeVisible();
  await expect(page.getByText("Place that keeps money")).toBeVisible();

  // The per-browser preference survives reload.
  await page.reload();
  await expect(page.getByRole("button", { name: "Gegevens van dit woord" })).toBeVisible();

  // Without a saved preference, the browser's language decides.
  const dutch = await browser.newContext({ locale: "nl-NL" });
  const dutchPage = await dutch.newPage();
  await dutchPage.goto(baseUrl());
  await expect(dutchPage.getByRole("heading", { name: "Aanmelden bij Vocab" })).toBeVisible();

  // Blocked storage falls back to memory and never prevents use.
  const blocked = await browser.newContext({ locale: "nl-NL" });
  await blocked.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("blocked", "SecurityError");
      },
    });
  });
  const blockedPage = await blocked.newPage();
  await blockedPage.goto(baseUrl());
  await expect(blockedPage.getByRole("heading", { name: "Aanmelden bij Vocab" })).toBeVisible();
  await openMenu(blockedPage);
  await blockedPage.getByRole("button", { name: "Taal Nederlands" }).click();
  await expect(blockedPage.getByRole("heading", { name: "Sign in to Vocab" })).toBeVisible();
  await Promise.all([dutch.close(), blocked.close()]);
});

test("compatibility: web:theme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await signIn(page);
  await searchbox(page).fill("hui");
  const colors = () =>
    page.evaluate(() => {
      const body = getComputedStyle(document.body);
      return [body.backgroundColor, body.color];
    });
  expect(await colors()).toEqual(["rgb(247, 249, 252)", "rgb(24, 36, 53)"]);
  await page.emulateMedia({ colorScheme: "dark" });
  expect(await colors()).toEqual(["rgb(20, 28, 39)", "rgb(237, 242, 247)"]);
  // A live system change keeps typed state.
  await expect(searchbox(page)).toHaveValue("hui");
  const fontLoaded = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].some(
      (face) => face.family.includes("Source Sans 3") && face.status === "loaded",
    );
  });
  expect(fontLoaded).toBe(true);
  const transition = await page
    .getByRole("button", { name: "Search options" })
    .evaluate((element) => getComputedStyle(element, "::before").transitionDuration);
  expect(transition).toBe("0s");
});

test("compatibility: web:auth", async ({ browser, request }) => {
  const dir = mkdtempSync(join(tmpdir(), "vocab-e2e-auth-"));
  const databasePath = join(dir, "auth.db");
  const tokenA = "auth-token-a-not-a-secret-0123456789abcdef";
  const tokenB = "auth-token-b-not-a-secret-0123456789abcdef";
  migrate(databasePath);
  let server = await startApi(databasePath, tokenA);
  const port = server.port;
  try {
    const context = await browser.newContext();
    let page = await context.newPage();
    await signIn(page, tokenA, server.baseUrl);
    const cookie = (await context.cookies()).find((item) => item.name === "vocab_session")!;
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Strict", path: "/api" });
    expect(cookie.expires * 1000).toBeGreaterThan(Date.now() + 20 * 86_400_000);

    // Persistent login: reload, a reopened browser context, and an API restart.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Search vocabulary" })).toBeVisible();
    const state = await context.storageState();
    await context.close();
    const reopened = await browser.newContext({ storageState: state });
    page = await reopened.newPage();
    await server.stop();
    server = await startApi(databasePath, tokenA, port);
    await page.goto(server.baseUrl);
    await expect(page.getByRole("heading", { name: "Search vocabulary" })).toBeVisible();

    // Authenticated use renews the cookie; cookie writes from a foreign origin are refused.
    const cookieHeader = `vocab_session=${cookie.value}`;
    const renewed = await request.get(`${server.baseUrl}/api/auth/session`, {
      headers: { cookie: cookieHeader },
    });
    expect(renewed.headers()["set-cookie"]).toContain("vocab_session=");
    const forged = await request.post(`${server.baseUrl}/api/entries/prepare`, {
      headers: { cookie: cookieHeader, origin: "http://evil.example" },
      data: { term: "huis" },
    });
    expect(forged.status()).toBe(403);

    // Logout revokes this session, even for a saved copy of the cookie.
    await openMenu(page);
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("heading", { name: "Sign in again" })).toBeVisible();
    const stale = await browser.newContext({ storageState: state });
    const stalePage = await stale.newPage();
    await stalePage.goto(server.baseUrl);
    await expect(stalePage.getByRole("heading", { name: "Sign in to Vocab" })).toBeVisible();
    await stale.close();

    // Token rotation revokes sessions; the draft survives and saves after signing in again.
    await signIn(page, tokenA, server.baseUrl);
    await footerLink(page, "Add").click();
    await page.getByRole("textbox", { name: "Word or phrase" }).fill("de ui");
    await page.getByRole("textbox", { name: "Word or phrase" }).press("Enter");
    await page.getByRole("button", { name: "Add notes" }).click();
    await page.getByLabel(/^Notes/).fill("onion");
    await server.stop();
    server = await startApi(databasePath, tokenB, port);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Sign in again" })).toBeVisible();
    await expect(page.locator("main")).toBeHidden();
    await page.getByLabel("Access token").fill(tokenA);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(
      page.getByText("This token was not accepted. Check it and try again."),
    ).toBeVisible();
    await page.getByLabel("Access token").fill(tokenB);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Added “de ui”")).toBeVisible();
    const saved = await lookup(request, "ui", { url: server.baseUrl, token: tokenB });
    expect(saved).toHaveLength(1);
    expect(saved[0]!.entry.extra).toBe("onion");
    await reopened.close();
  } finally {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("compatibility: web:direct-links", async ({ page, request }) => {
  await signIn(page);
  const [huis] = await lookup(request, "huis");

  // Direct links and refresh work; direct entry links fall back to Search.
  await page.goto(`${baseUrl()}/entries/${huis!.entry.id}`);
  await expect(page.getByRole("heading", { level: 1, name: "het huis" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "het huis" })).toBeVisible();
  await page.getByRole("link", { name: "Go to Search" }).click();
  await expect(page).toHaveURL(`${baseUrl()}/`);
  await page.goto(`${baseUrl()}/entries/999999`);
  await expect(page.getByRole("heading", { name: "Entry not found" })).toBeVisible();
  await page.goto(`${baseUrl()}/add`);
  await expect(page.getByRole("heading", { name: "Add a word" })).toBeVisible();

  // Back/Forward restore the query, loaded pages and scroll position.
  await page.goto(`${baseUrl()}/?q=werk`);
  await expect.poll(async () => (await resultTerms(page)).length).toBe(20);
  const historyLength = await page.evaluate(() => history.length);
  await page.getByRole("button", { name: "Load more" }).click();
  await expect.poll(async () => (await resultTerms(page)).length).toBe(werkWords.length);
  const last = page
    .getByRole("link")
    .filter({ has: page.getByTestId("term") })
    .last();
  await last.scrollIntoViewIfNeeded();
  const scrolled = await page.evaluate(() => window.scrollY);
  expect(scrolled).toBeGreaterThan(0);
  await last.click();
  await expect(page).toHaveURL(/\/entries\/\d+$/);
  await page.goBack();
  await expect(searchbox(page)).toHaveValue("werk");
  await expect.poll(async () => (await resultTerms(page)).length).toBe(werkWords.length);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(scrolled - 60);
  await page.goForward();
  await expect(page).toHaveURL(/\/entries\/\d+$/);
  await page.goBack();

  // Typing replaces history instead of adding entries.
  await searchbox(page).pressSequentially("dag", { delay: 300 });
  await expect(page).toHaveURL(/q=werkdag/);
  expect(await page.evaluate(() => history.length)).toBe(historyLength + 1);

  // The Add draft survives Search, entries, and browser history.
  await footerLink(page, "Add").click();
  await page.getByRole("textbox", { name: "Word or phrase" }).fill("de kaas");
  await page.getByRole("textbox", { name: "Word or phrase" }).press("Enter");
  await page.getByRole("button", { name: "Add notes" }).click();
  await page.getByLabel(/^Notes/).fill("cheese");
  // The Add form's actions sit in a pinned header, so the footer stays.
  await expect(page.getByRole("contentinfo")).toBeVisible();
  await page.getByRole("link", { name: "Keep draft" }).click();
  await search(page, "bank");
  await page.getByRole("link", { name: "bank geld" }).click();
  await page.goBack();
  await page.goBack();
  await expect(page.getByRole("textbox", { name: "Word or phrase" })).toHaveValue("de kaas");
  await expect(page.getByLabel(/^Notes/)).toHaveValue("cheese");
  await page.goForward();
  await expect(searchbox(page)).toHaveValue("bank");
});

test("compatibility: web:responsive", async ({ browser }) => {
  mkdirSync(visual, { recursive: true });
  const sizes = [
    ["narrow", 360],
    ["medium", 768],
    ["wide", 1440],
  ] as const;
  for (const [name, width] of sizes)
    for (const colorScheme of ["light", "dark"] as const) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        colorScheme,
        reducedMotion: "reduce",
      });
      const page = await context.newPage();
      await signIn(page);
      await search(page, "*ver*");
      await expect(
        page.getByRole("link", { name: /arbeidsongeschiktheidsverzekering/ }),
      ).toBeVisible();
      await expect(footerLink(page, "Add")).toBeVisible();
      await noHorizontalScroll(page);
      await page.screenshot({ path: join(visual, `${name}-${colorScheme}.png`), fullPage: true });

      await openMenu(page);
      await page.getByRole("button", { name: "Language English" }).click();
      await footerLink(page, "Toevoegen").click();
      await page
        .getByRole("textbox", { name: "Woord of uitdrukking" })
        .fill("de arbeidsongeschiktheidsverzekering");
      await page.getByRole("textbox", { name: "Woord of uitdrukking" }).press("Enter");
      await page.getByRole("button", { name: "Dit woord bewerken" }).click();
      await noHorizontalScroll(page);
      await page.screenshot({
        path: join(visual, `${name}-${colorScheme}-add-nl.png`),
        fullPage: true,
      });
      await page.getByRole("button", { name: "Annuleren" }).click();
      await openMenu(page);
      await page.getByRole("button", { name: "Taal Nederlands" }).click();
      await context.close();
    }

  // 200% zoom of a 1440 px window: long entries and the full Add form stay usable.
  const zoomed = await browser.newContext({
    viewport: { width: 720, height: 450 },
    deviceScaleFactor: 2,
  });
  const zoomPage = await zoomed.newPage();
  await signIn(zoomPage);
  await search(zoomPage, "arbeid");
  await zoomPage.getByRole("link", { name: /arbeidsongeschiktheidsverzekering/ }).click();
  await expect(zoomPage.getByRole("heading", { level: 1 })).toContainText(
    "arbeidsongeschiktheidsverzekering",
  );
  await noHorizontalScroll(zoomPage);
  await zoomPage.screenshot({ path: join(visual, "zoom-200-entry.png"), fullPage: true });
  await footerLink(zoomPage, "Search").click();
  await footerLink(zoomPage, "Add").click();
  const zoomTerm = zoomPage.getByRole("textbox", { name: "Word or phrase" });
  await zoomTerm.fill("de fietsenstallingsbeheerder");
  await zoomTerm.press("Enter");
  await zoomPage.getByRole("button", { name: "Save", exact: true }).scrollIntoViewIfNeeded();
  await expect(zoomPage.getByRole("button", { name: "Save", exact: true })).toBeVisible();
  await noHorizontalScroll(zoomPage);
  await zoomed.close();

  // Keyboard-only: sign in, search, open an entry, go back, add a word; focus stays visible.
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const steps: { action: string; focus: string; outline: string }[] = [];
  const focused = () =>
    page.evaluate(() => {
      const element = document.activeElement;
      if (!(element instanceof HTMLElement)) throw new Error("No focused HTML element");
      const style = getComputedStyle(element);
      const name = element.getAttribute("aria-label") ?? element.textContent?.trim() ?? "";
      const label = element.id
        ? document.querySelector(`label[for="${element.id}"]`)?.textContent
        : "";
      return {
        focus: `${element.tagName.toLowerCase()} ${label || name}`.slice(0, 80),
        outline: `${style.outlineStyle} ${style.outlineWidth}`,
      };
    });
  const press = async (key: string) => {
    await page.keyboard.press(key);
    const state = await focused();
    steps.push({ action: key, ...state });
    return state;
  };
  const tabTo = async (pattern: RegExp, key = "Tab") => {
    for (let count = 0; count < 40; count++) {
      const state = await press(key);
      expect(state.outline, state.focus).toMatch(/^solid [2-9]/);
      if (pattern.test(state.focus)) return;
    }
    throw new Error(`Keyboard focus never reached ${pattern}`);
  };

  await page.goto(baseUrl());
  await expect(page.getByRole("heading", { name: "Sign in to Vocab" })).toBeVisible();
  const skip = await press("Tab");
  expect(skip.focus).toContain("Skip to content");
  await tabTo(/Access token/);
  await page.keyboard.type(e2eToken);
  await press("Enter");
  await expect(page.getByRole("heading", { name: "Search vocabulary" })).toBeVisible();
  await expect(searchbox(page)).toBeFocused();
  await page.keyboard.type("lopen");
  await press("Enter");
  await expect(resultLink(page, "lopen")).toBeVisible();
  await tabTo(/^a lopen/);
  await press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "lopen" })).toBeFocused();
  await tabTo(/Back to search/, "Shift+Tab");
  await press("Enter");
  await expect(searchbox(page)).toHaveValue("lopen");
  await tabTo(/^a Add/);
  await press("Enter");
  await expect(page.getByRole("textbox", { name: "Word or phrase" })).toBeFocused();
  await page.keyboard.type("de sla");
  await press("Enter");
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeVisible();
  await tabTo(/^button Save$/, "Shift+Tab");
  await press("Enter");
  await expect(page.getByText("Added “de sla”")).toBeVisible();
  await expect(searchbox(page)).toBeFocused();
  writeFileSync(join(visual, "keyboard.json"), JSON.stringify({ viewport: 1440, steps }, null, 2));
  await context.close();
});
