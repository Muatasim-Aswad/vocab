import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { requestTerm, requestToken } from "../../test/test-app.tsx";
import { apiError, detail, json, page, renderApp, summary } from "../../test/test-app.tsx";

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("application shell", () => {
  it("exchanges the token once for a session and never stores it in the browser", async () => {
    let signedIn = false;
    renderApp({
      handlers: {
        "GET /api/auth/session": () =>
          signedIn
            ? json({ authenticated: true })
            : apiError(401, "unauthorized", "Authentication required"),
        "POST /api/auth/login": (request) => {
          signedIn = requestToken(request.body) === "personal-token";
          return signedIn
            ? json({ authenticated: true })
            : apiError(401, "unauthorized", "Invalid token");
        },
        "POST /api/auth/logout": () => {
          signedIn = false;
          return json({ authenticated: false });
        },
      },
    });
    const user = userEvent.setup();
    expect(await screen.findByRole("heading", { name: "Sign in to Vocab" })).toBeTruthy();
    expect(screen.queryByRole("navigation")).toBeNull();

    await user.type(screen.getByLabelText("Access token"), "personal-token");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("heading", { name: "Search vocabulary" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Add" }).getAttribute("href")).toBe("/add");
    expect(
      JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]) +
        document.cookie,
    ).not.toContain("personal-token");

    await user.click(screen.getByRole("button", { name: "Menu" }));
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("heading", { name: "Sign in again" })).toBeTruthy();
  });

  it("keeps search results mounted while access is required and restores them after login", async () => {
    let signedIn = true;
    const app = renderApp({
      path: "/?q=kat",
      handlers: {
        "GET /api/entries/search": () =>
          signedIn
            ? json(page([summary(1, "kat")], "c1"))
            : apiError(401, "unauthorized", "Authentication required"),
        "POST /api/auth/login": () => {
          signedIn = true;
          return json({ authenticated: true });
        },
      },
    });
    const user = userEvent.setup();
    await screen.findByRole("link", { name: "kat" });
    signedIn = false;
    await user.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByRole("heading", { name: "Sign in again" })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Sign in again" }));
    expect(screen.getByText("kat", { selector: "mark" })).toBeTruthy();

    await user.type(screen.getByLabelText("Access token"), "personal-token");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(document.querySelector("main")!.hidden).toBe(false));
    expect(screen.getByRole("link", { name: "kat" })).toBeTruthy();
    expect(app.router.state.location.search).toBe("?q=kat");
  });

  it("switches English and Dutch without losing route, query or draft, and remembers the choice", async () => {
    const app = renderApp({
      path: "/add",
      handlers: {
        "POST /api/entries/prepare": (request) =>
          json({ term: requestTerm(request.body), matches: [], inferred: {} }),
      },
    });
    const user = userEvent.setup();
    await user.type(await screen.findByRole("textbox", { name: "Word or phrase" }), "de fiets");
    expect(screen.getByRole("link", { name: "Search" }).getAttribute("href")).toBe("/");
    await user.click(screen.getByRole("button", { name: "Menu" }));
    await user.click(screen.getByRole("button", { name: "Language English" }));

    expect(await screen.findByRole("heading", { name: "Woord toevoegen" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Woord of uitdrukking" })).toHaveProperty(
      "value",
      "de fiets",
    );
    expect(screen.getByRole("button", { name: "Verder" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Zoeken" })).toBeTruthy();
    expect(document.documentElement.lang).toBe("nl");
    await waitFor(() => expect(document.title).toBe("Toevoegen – Vocab"));
    expect(app.router.state.location.pathname).toBe("/add");
    expect(JSON.parse(localStorage.getItem("vocab.preferences")!)).toEqual({
      version: 1,
      locale: "nl",
    });

    await user.click(screen.getByRole("button", { name: "Taal Nederlands" }));
    expect(await screen.findByRole("heading", { name: "Add a word" })).toBeTruthy();
    expect(document.documentElement.lang).toBe("en");
  });

  it("cycles the theme through light, dark and device, and remembers the choice", async () => {
    renderApp({ path: "/" });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Menu" }));
    const theme = screen.getByRole("button", { name: /^Theme/ });
    expect(theme.textContent).toBe("ThemeDevice");
    expect(document.documentElement.dataset.theme).toBeUndefined();

    await user.click(theme);
    expect(document.documentElement.dataset.theme).toBe("light");
    await user.click(theme);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(JSON.parse(localStorage.getItem("vocab.preferences")!)).toMatchObject({ theme: "dark" });
    await user.click(theme);
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(theme.textContent).toBe("ThemeDevice");

    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Menu" }).getAttribute("aria-expanded")).toBe(
      "false",
    );
  });

  it("shows a localized page for unknown routes", async () => {
    renderApp({ path: "/nowhere", locale: "nl" });
    expect(await screen.findByRole("heading", { name: "Pagina niet gevonden" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Naar Zoeken" }).getAttribute("href")).toBe("/");
  });
});

describe("entry view", () => {
  const bank = {
    ...detail(3, "bank", {
      senseCue: "money",
      extra: "Place that keeps money",
      partOfSpeech: "NOUN",
      grammar: { article: "de", number: "both", isCountable: true, legacyFlag: "kept" },
      examples: ["Ik ga naar de bank."],
      collocations: ["geld op de bank zetten"],
      forms: ["banken"],
      tags: ["finance"],
      memory: {
        strength: 12.4,
        difficulty: 3.8,
        streak: 5,
        lastReviewed: "2024-03-05T08:00:00.000Z",
      },
    }),
    relations: [
      { type: "synonym", entry: summary(8, "geldinstelling", { article: "de" }) },
      { type: "related", entry: summary(9, "rente", { status: "stub" }) },
    ],
    siblings: [summary(4, "bank", { senseCue: "seat" })],
  };

  it("shows every stored field without headings, and details behind the more button", async () => {
    const app = renderApp({
      path: "/entries/3",
      handlers: {
        "GET /api/entries/:id": (request) =>
          request.path.endsWith("/3") ? json(bank) : json(detail(9, "rente", { status: "stub" })),
      },
    });
    const user = userEvent.setup();
    expect(await screen.findByRole("heading", { level: 1, name: "de bank money" })).toBeTruthy();
    expect(screen.getAllByRole("heading")).toHaveLength(1);
    const article = screen.getByRole("article");
    expect(article.querySelector("header p")!.textContent).toBe(
      "noun, countable, singular and plural, legacyFlag: kept · banken",
    );
    for (const text of ["Ik ga naar de bank.", "Place that keeps money"])
      expect(screen.getByText(text)).toBeTruthy();
    // The collocation stays whole; the headword inside it steps back.
    const collocation = within(article).getByText(
      (_, element) => element?.tagName === "LI" && element.textContent === "geld op de bank zetten",
    );
    expect(collocation.querySelector("span")!.textContent).toBe("bank");
    // The note closes the entry.
    expect(article.lastElementChild!.firstElementChild!.textContent).toBe("Place that keeps money");

    // Relations are labelled by icon (tooltip and screen-reader text) and linked words keep their article.
    expect(screen.getByTitle("Synonym")).toBeTruthy();
    expect(screen.getByText("Synonym:")).toBeTruthy();
    expect(screen.getByRole("link", { name: "geldinstelling" }).parentElement!.textContent).toBe(
      "de geldinstelling",
    );

    // Other meanings are tabs; the current one is marked, not linked.
    const meanings = screen.getByRole("navigation", { name: "Meanings" });
    expect(meanings.querySelector("[aria-current]")!.textContent).toBe("money");
    expect(screen.getByRole("link", { name: "seat" }).getAttribute("href")).toBe("/entries/4");

    const more = screen.getByRole("button", { name: "Entry details" });
    const details = document.getElementById(more.getAttribute("aria-controls")!)!;
    expect(details.hidden).toBe(true);
    await user.click(more);
    expect(details.hidden).toBe(false);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    for (const text of [
      "finance",
      "January 2, 2024",
      "about 12 days",
      "3.8 of 10",
      "5 correct in a row",
      "Statusactive",
    ])
      expect(details.textContent).toContain(text);
    // A direct link offers Search rather than history navigation.
    expect(screen.getByRole("link", { name: "Go to Search" })).toBeTruthy();

    await user.click(screen.getByRole("link", { name: "rente" }));
    const stubMore = await screen.findByRole("button", { name: "Entry details" });
    await user.click(stubMore);
    expect(document.getElementById(stubMore.getAttribute("aria-controls")!)!.textContent).toContain(
      "Statusstub",
    );
    await user.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(app.router.state.location.pathname).toBe("/entries/3"));
  });

  it("marks a separable verb's split point without changing its text", async () => {
    renderApp({
      path: "/entries/5",
      handlers: {
        "GET /api/entries/:id": () =>
          json({
            ...detail(5, "opstaan", { grammar: { isSeparable: true } }),
            separablePart: "op",
          }),
      },
    });
    const heading = await screen.findByRole("heading", { level: 1, name: /staan/ });
    expect(heading.textContent).toBe("opstaan");
    expect(heading.querySelector("span:empty")!.previousSibling!.textContent).toBe("op");
    await act(async () => {});
  });

  it("explains a missing entry and offers Search", async () => {
    renderApp({
      path: "/entries/77",
      handlers: { "GET /api/entries/:id": () => apiError(404, "not_found", "Entry not found") },
    });
    expect(await screen.findByRole("heading", { name: "Entry not found" })).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Go to Search" }).length).toBeGreaterThan(0);
    await act(async () => {});
  });
});
