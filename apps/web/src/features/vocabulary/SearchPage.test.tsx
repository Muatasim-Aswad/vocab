import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { requestTerm } from "../../../test/test-app.tsx";
import {
  apiError,
  capture,
  capturePage,
  deferred,
  json,
  page,
  renderApp,
  summary,
} from "../../../test/test-app.tsx";

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

const terms = (scope: HTMLElement) =>
  within(scope)
    .getAllByRole("listitem")
    .map((item) => item.textContent);

const recentTerms = () =>
  within(recent()!)
    .getAllByRole("listitem")
    .map((item) => item.textContent);

const chips = (name: string) =>
  within(screen.getByRole("region", { name }))
    .getAllByRole("listitem")
    .map((item) => item.textContent);

const wait = (ms: number) => act(() => new Promise((done) => setTimeout(done, ms)));
const searchInput = () => screen.getByRole("searchbox", { name: "Word or phrase" });
const recent = () => screen.queryByRole("region", { name: "Recent searches" });
const offline = () => Promise.reject(new TypeError("fetch failed"));
const resultTerms = () =>
  within(screen.getByRole("list", { hidden: false }))
    .getAllByRole("link")
    .map((link) => link.textContent);

/**
 * Holds the timers of one delay until `run`, so a debounce is checked without depending on how fast
 * the machine is; other timers run normally.
 */
function holdTimers(delay: number) {
  const held = new Map<number, () => void>();
  let nextId = -1;
  const setTimer = window.setTimeout.bind(window);
  const clearTimer = window.clearTimeout.bind(window);
  vi.spyOn(window, "setTimeout").mockImplementation((handler, timeout, ...rest) => {
    if (timeout !== delay || typeof handler !== "function")
      return setTimer(handler, timeout, ...rest);
    held.set(nextId, () => handler(...rest));
    return nextId--;
  });
  vi.spyOn(window, "clearTimeout").mockImplementation((id) => {
    if (id === undefined || !held.delete(id)) clearTimer(id);
  });
  return {
    pending: () => held.size,
    run: () =>
      act(async () => {
        const due = [...held.values()];
        held.clear();
        for (const run of due) run();
      }),
  };
}

/** Observes every write to a form control property, including reverts that settle before an assertion. */
function onWrite(
  element: Element,
  property: "value" | "checked" | "selected",
  record: (value: unknown) => void,
) {
  const native = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), property)!;
  Object.defineProperty(element, property, {
    configurable: true,
    get() {
      return native.get!.call(this);
    },
    set(value) {
      record(value);
      native.set!.call(this, value);
    },
  });
}

describe("Search", () => {
  it("debounces typing by 250 ms, flushes on Enter, and ignores whitespace", async () => {
    const app = renderApp({
      handlers: {
        "GET /api/entries/search": (request) =>
          json(page([summary(1, request.query.get("query")!)])),
      },
    });
    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "Search vocabulary" });
    const debounce = holdTimers(250);
    const searches = () => app.callsTo("GET", "/api/entries/search");

    await user.type(searchInput(), "   ");
    await debounce.run();
    expect(searches()).toHaveLength(0);
    expect(screen.queryByRole("list")).toBeNull();

    await user.clear(searchInput());
    await user.type(searchInput(), "ban");
    // Each keystroke restarts the wait, so one search is due, and none runs before it.
    expect(debounce.pending()).toBe(1);
    await wait(50);
    expect(searches()).toHaveLength(0);
    await debounce.run();
    await waitFor(() => expect(searches()).toHaveLength(1));
    expect(searches()[0]!.query.get("query")).toBe("ban");
    expect(app.router.state.location.search).toBe("?q=ban");

    // Enter searches at once and cancels the wait.
    await user.type(searchInput(), "k{Enter}");
    await waitFor(() => expect(searches()).toHaveLength(2));
    expect(debounce.pending()).toBe(0);
    expect(searches()[1]!.query.get("query")).toBe("bank");
    expect(await screen.findByRole("link", { name: "bank" })).toBeTruthy();
    // Typing replaced the history entry instead of adding one per keystroke.
    expect(app.router.state.historyAction).toBe("REPLACE");
  });

  it("waits for input-method composition to end", async () => {
    const app = renderApp({
      handlers: { "GET /api/entries/search": () => json(page([summary(1, "één")])) },
    });
    await screen.findByRole("heading", { name: "Search vocabulary" });
    const input = searchInput();
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "e" } });
    fireEvent.change(input, { target: { value: "é" } });
    await wait(350);
    expect(app.callsTo("GET", "/api/entries/search")).toHaveLength(0);
    fireEvent.compositionEnd(input, { target: { value: "é" } });
    await waitFor(() => expect(app.callsTo("GET", "/api/entries/search")).toHaveLength(1));
    expect(app.callsTo("GET", "/api/entries/search")[0]!.query.get("query")).toBe("é");
  });

  it("never shows a late response for an older query as current results", async () => {
    const slow = deferred<Response>();
    const app = renderApp({
      path: "/?q=ba",
      handlers: {
        "GET /api/entries/search": (request) =>
          request.query.get("query") === "ba"
            ? slow.promise
            : json(page([summary(2, "bank", { senseCue: "money" })])),
      },
    });
    await waitFor(() => expect(app.callsTo("GET", "/api/entries/search")).toHaveLength(1));
    const first = app.callsTo("GET", "/api/entries/search")[0]!;

    await act(() => app.router.navigate("/?q=bank", { replace: true }));
    expect(await screen.findByRole("link", { name: "bank money" })).toBeTruthy();
    expect(first.signal?.aborted).toBe(true);

    slow.resolve(json(page([summary(1, "baan")])));
    await wait(50);
    expect(screen.queryByRole("link", { name: "baan" })).toBeNull();
    expect(screen.getByRole("link", { name: "bank money" })).toBeTruthy();
  });

  it("labels previous results while a new query loads", async () => {
    const pending = deferred<Response>();
    const app = renderApp({
      path: "/?q=huis",
      handlers: {
        "GET /api/entries/search": (request) =>
          request.query.get("query") === "huis"
            ? json(page([summary(1, "huis")]))
            : pending.promise,
      },
    });
    await screen.findByRole("link", { name: "huis" });
    await act(() => app.router.navigate("/?q=huisje", { replace: true }));
    expect(
      await screen.findByText("Still showing results for “huis” while the new search loads."),
    ).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Updating results…");
    pending.resolve(json(page([summary(5, "huisje")])));
    expect(await screen.findByRole("link", { name: "huisje" })).toBeTruthy();
    expect(screen.queryByText(/Still showing results/)).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("1 result");
  });

  it("preserves server order, paginates explicitly, and keeps results when a page fails", async () => {
    let failNext = true;
    renderApp({
      path: "/?q=werk&type=noun&examples=1",
      handlers: {
        "GET /api/entries/search": (request) => {
          expect(request.query.get("typeFilter")).toBe("noun");
          expect(request.query.get("includeAllFields")).toBe("true");
          expect(request.query.get("limit")).toBe("20");
          if (!request.query.get("cursor"))
            return json(
              page([summary(9, "werkdag"), summary(3, "werk"), summary(4, "werkgever")], "c1"),
            );
          if (failNext) {
            failNext = false;
            return apiError(503, "unavailable", "Service unavailable");
          }
          return json(page([summary(4, "werkgever"), summary(7, "werkplaats")]));
        },
      },
    });
    const user = userEvent.setup();
    await waitFor(() => expect(resultTerms()).toEqual(["werkdag", "werk", "werkgever"]));
    expect(screen.getByText("Type: Noun, including examples and collocations")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText(/More results could not be loaded/)).toBeTruthy();
    expect(resultTerms()).toEqual(["werkdag", "werk", "werkgever"]);

    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(resultTerms()).toHaveLength(4));
    expect(resultTerms()).toEqual(["werkdag", "werk", "werkgever", "werkplaats"]);
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("offers Retry when a search fails and Add when nothing matches", async () => {
    let fail = true;
    const app = renderApp({
      path: "/?q=fiets",
      handlers: {
        "GET /api/entries/search": () => {
          if (fail) {
            fail = false;
            return apiError(500, "internal", "Internal error");
          }
          return json(page([]));
        },
      },
    });
    const user = userEvent.setup();
    expect(await screen.findByText(/Search could not complete/)).toBeTruthy();
    expect(searchInput()).toHaveProperty("value", "fiets");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await user.click(await screen.findByRole("button", { name: "Add" }));
    await waitFor(() => expect(app.router.state.location.pathname).toBe("/add"));
    expect(screen.getByLabelText("Word or phrase")).toHaveProperty("value", "fiets");
  });

  it("shows the matching example instead of the note, highlighted as text, and keeps the search options open across navigation", async () => {
    const app = renderApp({
      path: "/?q=loop",
      handlers: {
        "GET /api/entries/search": () =>
          json(
            page([
              {
                ...summary(5, "loop", { status: "stub" }),
                relations: [
                  { type: "related", entry: summary(9, "renbaan", { article: "de" }) },
                  { type: "wordFamily", entry: summary(10, "loper") },
                  { type: "synonym", entry: summary(7, "rennen") },
                  { type: "antonym", entry: summary(8, "stilstaan") },
                ],
              },
              {
                ...summary(6, "lopen", { partOfSpeech: "VERB", extra: "to walk" }),
                examples: ["ik ga lopen", "<b>ik</b> loop"],
              },
            ]),
          ),
      },
    });
    const user = userEvent.setup();
    await screen.findByRole("link", { name: "loop" });
    expect(document.querySelectorAll("mark")).toHaveLength(2);
    expect(screen.getByText("<b>ik</b>", { exact: false })).toBeTruthy();
    expect(document.querySelector("b")).toBeNull();
    expect(screen.queryByText("to walk")).toBeNull();
    expect(screen.queryByText("ik ga lopen")).toBeNull();
    expect(screen.getByText(/^Synonym:/).closest("p")!.textContent).toBe(
      "Synonym: rennenOpposite: stilstaanWord family: loper+1",
    );
    expect(screen.getByRole("link", { name: "rennen" }).getAttribute("href")).toBe("/entries/7");
    expect(screen.getByRole("link", { name: "rennen" }).getAttribute("href")).toBe("/entries/7");
    expect(screen.getByText("verb")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Search options" }));
    await user.click(screen.getByRole("link", { name: "lopen" }));
    await waitFor(() => expect(app.router.state.location.pathname).toBe("/entries/6"));
    await act(() => app.router.navigate(-1));
    await screen.findByRole("link", { name: "lopen" });
    expect(
      screen.getByRole("button", { name: "Search options" }).getAttribute("aria-expanded"),
    ).toBe("true");
    expect(searchInput()).toHaveProperty("value", "loop");
  });

  it("never reverts typed text or option controls while the URL catches up", async () => {
    const app = renderApp({
      handlers: {
        "GET /api/entries/search": (request) =>
          json(page([summary(1, request.query.get("query")!)])),
      },
    });
    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "Search vocabulary" });

    await user.type(searchInput(), "ba");
    await wait(300);
    const texts: string[] = [];
    onWrite(searchInput(), "value", (value) => texts.push(String(value)));
    await user.type(searchInput(), "n");
    await wait(300);
    expect(app.router.state.location.search).toBe("?q=ban");
    expect(texts.filter((text) => text !== "ban")).toEqual([]);

    await user.click(screen.getByRole("button", { name: "Search options" }));
    const examples = screen.getByRole("checkbox", { name: "Include examples and collocations" });
    const checks: unknown[] = [];
    onWrite(examples, "checked", (checked) => checks.push(checked));
    await user.click(examples);
    expect(checks.filter((checked) => checked !== true)).toEqual([]);

    const type = screen.getByRole("combobox", { name: "Type" });
    const selections: string[] = [];
    for (const option of Array.from(type.querySelectorAll("option")))
      onWrite(option, "selected", (value) => value && selections.push(option.value));
    await user.selectOptions(type, "noun");
    expect(selections.filter((value) => value !== "noun")).toEqual([]);

    // An outside URL change still replaces the typed text.
    await act(() => app.router.navigate("/?q=fiets", { replace: true }));
    expect(searchInput()).toHaveProperty("value", "fiets");
  });

  it("adds a search to the server's recent list when focus leaves the field, never on Clear", async () => {
    let stored = ["kaas"];
    const app = renderApp({
      handlers: {
        "GET /api/entries/search": (request) =>
          json(page([summary(1, request.query.get("query")!)])),
        "GET /api/search-history": () => json({ terms: stored }),
        "POST /api/search-history": (request) => {
          const term = requestTerm(request.body);
          stored = [term, ...stored.filter((item) => item.toLowerCase() !== term.toLowerCase())];
          return json(request.body);
        },
      },
    });
    const user = userEvent.setup();
    const heading = await screen.findByRole("heading", { name: "Search vocabulary" });

    // Typing, Enter and Clear stay inside the field: nothing is recorded.
    await waitFor(() => expect(recentTerms()).toEqual(["kaas"]));
    await user.type(searchInput(), "fiets{Enter}");
    await screen.findByRole("link", { name: "fiets" });
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(document.activeElement).toBe(searchInput());
    expect(recentTerms()).toEqual(["kaas"]);
    expect(app.callsTo("POST", "/api/search-history")).toEqual([]);

    // Leaving the field records the text it holds.
    for (const term of ["huis", "  Fiets "]) {
      await user.type(searchInput(), term);
      await user.click(heading);
      await user.click(screen.getByRole("button", { name: "Clear" }));
    }
    await user.click(heading);
    expect(recentTerms()).toEqual(["Fiets", "huis", "kaas"]);
    const writes = app.callsTo("POST", "/api/search-history").map((call) => call.body);
    expect(writes).toEqual([
      { id: expect.any(String), term: "huis", searchedAt: expect.stringMatching(/Z$/) },
      { id: expect.any(String), term: "Fiets", searchedAt: expect.stringMatching(/Z$/) },
    ]);
    expect(within(recent()!).getByRole("link", { name: "huis" }).getAttribute("href")).toBe(
      "/?q=huis",
    );

    within(recent()!).getByRole("link", { name: "huis" }).focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(app.router.state.location.search).toBe("?q=huis"));
    expect(searchInput()).toHaveProperty("value", "huis");
    expect(await screen.findByRole("link", { name: "huis" })).toBeTruthy();
  });

  it("lists the whole search history on its own page, where it is cleared", async () => {
    let stored = Array.from({ length: 7 }, (_, index) => `woord${index}`);
    const app = renderApp({
      handlers: {
        "GET /api/entries/search": (request) =>
          json(page([summary(1, request.query.get("query")!)])),
        "GET /api/search-history": () => json({ terms: stored }),
        "POST /api/search-history": (request) => json(request.body),
        "POST /api/search-history/clears": (request) => {
          stored = [];
          return json(request.body);
        },
      },
    });
    const user = userEvent.setup();

    await waitFor(() => expect(terms(recent()!)).toEqual(stored.slice(0, 5)));
    expect(app.callsTo("GET", "/api/search-history")[0]!.query.get("limit")).toBe("50");
    expect(screen.queryByRole("button", { name: "Clear search history" })).toBeNull();
    await user.click(within(recent()!).getByRole("link", { name: "All searches" }));
    expect(app.router.state.location.pathname).toBe("/search-history");
    await screen.findByRole("heading", { level: 1, name: "Search history" });
    expect(terms(screen.getByRole("list"))).toEqual(stored);

    await user.click(screen.getByRole("link", { name: "woord6" }));
    await waitFor(() => expect(app.router.state.location.search).toBe("?q=woord6"));
    expect(searchInput()).toHaveProperty("value", "woord6");
    expect(app.callsTo("POST", "/api/search-history")[0]!.body).toMatchObject({ term: "woord6" });

    await act(() => app.router.navigate("/search-history"));
    await user.click(await screen.findByRole("button", { name: "Clear search history" }));
    expect(await screen.findByText("No searches yet.")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Search history" }));
    expect(app.callsTo("POST", "/api/search-history/clears")).toHaveLength(1);
    await waitFor(() => expect(stored).toEqual([]));
  });

  it("shows a search offline and drops it once the server's list is readable again", async () => {
    let online = true;
    const app = renderApp({
      handlers: {
        "GET /api/entries/search": () => json(page([])),
        "GET /api/search-history": () => (online ? json({ terms: [] }) : offline()),
        "POST /api/search-history": offline,
      },
    });
    const user = userEvent.setup();
    const heading = await screen.findByRole("heading", { name: "Search vocabulary" });
    await waitFor(() => expect(app.callsTo("GET", "/api/search-history")).toHaveLength(1));
    online = false;
    for (const term of ["fiets", "huis", "  FIETS "]) {
      await user.type(searchInput(), term);
      await user.click(heading);
      await user.click(screen.getByRole("button", { name: "Clear" }));
    }
    await user.click(heading);
    await waitFor(() => expect(app.callsTo("GET", "/api/search-history")).toHaveLength(4));
    expect(
      within(recent()!)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["FIETS", "huis"]);

    online = true;
    await act(() => app.queryClient.invalidateQueries({ queryKey: ["recent-searches"] }));
    await waitFor(() => expect(recent()).toBeNull());
  });

  it("offers Capture for later and Add, with captured terms starting with the query below", async () => {
    let saved: ReturnType<typeof capture> | undefined;
    let attempts = 0;
    const app = renderApp({
      path: "/?q=fiets",
      handlers: {
        "GET /api/entries/search": () => json(page([])),
        "GET /api/captures": (request) =>
          request.query.get("prefix")
            ? json(capturePage([capture(3, "fietsbel"), capture(2, "fietspomp")], "c1"))
            : json(capturePage(request.query.get("term") && saved ? [saved] : [])),
        "POST /api/captures": () => {
          attempts++;
          if (attempts === 1) throw new TypeError("connection reset");
          saved = capture(1, "fiets");
          return json(saved);
        },
      },
    });
    const user = userEvent.setup();
    const captureButton = await screen.findByRole("button", { name: "Capture for later" });
    const actions = screen.getAllByRole("button").map((button) => button.textContent);
    expect(actions.indexOf("Capture for later")).toBeLessThan(actions.indexOf("Add"));
    expect(screen.queryByText(/No matches/)).toBeNull();
    const matches = await screen.findByRole("region", {
      name: "Captured terms starting with “fiets”",
    });
    expect(
      within(matches)
        .getAllByRole("listitem")
        .map((item) => within(item).getByTestId("term").textContent),
    ).toEqual(["fietsbel", "fietspomp"]);
    expect([...matches.querySelectorAll("mark")].map((mark) => mark.textContent)).toEqual([
      "fiets",
      "fiets",
    ]);
    expect(within(matches).getByRole("button", { name: "Load more" })).toBeTruthy();
    expect(
      app.callsTo("GET", "/api/captures").some((call) => call.query.get("prefix") === "fiets"),
    ).toBe(true);

    await user.click(captureButton);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Vocab did not confirm whether “fiets” was captured.",
    );
    await user.click(screen.getByRole("button", { name: "Capture for later" }));
    expect(await screen.findByText("Captured “fiets”.")).toBeTruthy();
    await waitFor(() => expect(app.router.state.location.search).toBe(""));
    expect(searchInput()).toHaveProperty("value", "");
    expect(document.activeElement).toBe(searchInput());
    const sent = app.callsTo("POST", "/api/captures").map((call) => call.body);
    expect(sent[1]).toEqual(sent[0]);
    expect(sent[0]).toEqual({ mutationId: expect.any(String), term: "fiets" });
  });

  it("empties the search when Add or AI is chosen for a word nothing matched", async () => {
    const app = renderApp({
      path: "/?q=fiets",
      handlers: { "GET /api/entries/search": () => json(page([])) },
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Add" }));
    await waitFor(() => expect(app.router.state.location.pathname).toBe("/add"));
    await act(() => app.router.navigate(-1));
    await waitFor(() => expect(app.router.state.location.pathname).toBe("/"));
    expect(app.router.state.location.search).toBe("");
    expect(searchInput()).toHaveProperty("value", "");
  });

  it("shows recently changed entries and the newest captures below recent searches when the query is empty", async () => {
    const app = renderApp({
      handlers: {
        "GET /api/search-history": () => json({ terms: ["kaas"] }),
        "GET /api/entries": () =>
          json(
            page([summary(3, "bank", { article: "de", senseCue: "money" }), summary(2, "lopen")]),
          ),
        "GET /api/captures": () =>
          json(
            capturePage(Array.from({ length: 12 }, (_, index) => capture(index, `woord${index}`))),
          ),
      },
    });
    const user = userEvent.setup();

    await waitFor(() => expect(chips("Recent entries")).toEqual(["de bank money", "lopen"]));
    expect(chips("Recent searches")).toEqual(["kaas"]);
    expect(chips("Recent captures")).toEqual(
      Array.from({ length: 5 }, (_, index) => `woord${index}`),
    );
    const [entries] = app.callsTo("GET", "/api/entries");
    expect(entries!.query.get("limit")).toBe("10");
    expect(entries!.query.get("order")).toBe("modified");
    expect(screen.getByRole("link", { name: "de bank money" }).getAttribute("href")).toBe(
      "/entries/3",
    );
    expect(screen.getByRole("link", { name: "All entries" }).getAttribute("href")).toBe(
      "/entries?order=modified",
    );
    expect(screen.getByRole("link", { name: "All captures" }).getAttribute("href")).toBe(
      "/captures",
    );

    await user.click(screen.getByRole("link", { name: "woord4" }));
    expect(app.router.state.location.search).toBe("?q=woord4");
    expect(screen.queryByRole("region", { name: "Recent entries" })).toBeNull();
  });
});
