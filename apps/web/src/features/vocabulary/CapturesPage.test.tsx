import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { requestTerm } from "../../../test/test-app.tsx";
import {
  apiError,
  capture,
  capturePage,
  detail,
  json,
  renderApp,
  summary,
} from "../../../test/test-app.tsx";

const pointer = window.matchMedia;
beforeEach(() => {
  window.matchMedia = vi.fn((query: string): MediaQueryList => ({
    matches: query === "(pointer: fine)",
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
  }));
});
afterEach(() => {
  cleanup();
  window.matchMedia = pointer;
});

const field = () => screen.getByRole("textbox", { name: "Word or phrase to capture" });
const rows = () =>
  within(screen.getByRole("list"))
    .getAllByRole("listitem")
    .map((row) => within(row).getByTestId("term").textContent);

describe("Captures", () => {
  it("asks AI for a captured term from its row, keeping the capture linked", async () => {
    const app = renderApp({
      path: "/captures",
      handlers: {
        "GET /api/captures": () => json(capturePage([capture(3, "de fiets")])),
        "POST /api/entries/prepare": (request) => {
          const term = requestTerm(request.body);
          return json({ term, matches: [], inferred: { lemma: term } });
        },
        "POST /api/ai/generate": () =>
          json({
            generationId: "0192a6b4-0000-7000-8000-000000000100",
            drafts: [
              {
                draftId: "0192a6b4-0000-7000-8000-000000000101",
                term: "fiets",
                corrected: false,
                partOfSpeech: "NOUN",
                grammar: { article: "de" },
              },
            ],
            warnings: [],
            existing: [],
          }),
        "POST /api/ai/draft-events": () => json({ recorded: true }),
      },
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Suggest with AI de fiets" }));
    await waitFor(() => expect(app.router.state.location.pathname).toBe("/add"));
    await waitFor(() => expect(app.callsTo("POST", "/api/ai/generate")).toHaveLength(1));
    expect(app.callsTo("POST", "/api/ai/generate")[0]!.body).toMatchObject({ term: "de fiets" });
  });

  it("captures terms one after another from the focused field, and pages with a cursor", async () => {
    const stored = [capture(3, "de fiets"), capture(2, "lopen")];
    const app = renderApp({
      path: "/captures",
      handlers: {
        "GET /api/captures": (request) =>
          request.query.get("cursor") === "c1"
            ? json(capturePage([capture(1, "huis")]))
            : json(capturePage(stored, "c1")),
        "POST /api/captures": (request) => {
          const term = requestTerm(request.body);
          const saved = capture(4, term);
          stored.unshift(saved);
          return json(saved);
        },
      },
    });
    const user = userEvent.setup();
    expect(await screen.findByRole("heading", { level: 1, name: "Captures" })).toBeTruthy();
    await waitFor(() => expect(rows()).toEqual(["de fiets", "lopen"]));
    expect(document.activeElement).toBe(field());

    await user.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(rows()).toEqual(["de fiets", "lopen", "huis"]));
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();

    await user.click(field());
    await user.keyboard("  zwemmen {Enter}");
    expect(await screen.findByText("Captured “zwemmen”.")).toBeTruthy();
    expect(field()).toHaveProperty("value", "");
    expect(document.activeElement).toBe(field());
    await waitFor(() => expect(rows()[0]).toBe("zwemmen"));
    const [body] = app.callsTo("POST", "/api/captures").map((call) => call.body);
    expect(body).toEqual({ mutationId: expect.any(String), term: "zwemmen" });
  });

  it("keeps an unconfirmed capture's identity for the retry and never moves focus from the list", async () => {
    let attempts = 0;
    let release: (() => void) | undefined;
    const app = renderApp({
      path: "/captures",
      handlers: {
        "GET /api/captures": () => json(capturePage([capture(1, "huis")])),
        "POST /api/captures": async (request) => {
          attempts++;
          if (attempts === 1) throw new TypeError("connection reset");
          await new Promise<void>((resolve) => (release = resolve));
          return json(capture(2, requestTerm(request.body)));
        },
      },
    });
    const user = userEvent.setup();
    await screen.findByText("huis", { selector: "[data-testid=term]" });
    await user.type(field(), "kaas{Enter}");
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Vocab did not confirm whether “kaas” was captured.",
    );
    expect(field()).toHaveProperty("value", "kaas");

    await user.click(screen.getByRole("button", { name: "Capture" }));
    await waitFor(() => expect(release).toBeDefined());
    const addHuis = screen.getByRole("button", { name: "Add entry huis" });
    addHuis.focus();
    act(() => release!());
    expect(await screen.findByText("Captured “kaas”.")).toBeTruthy();
    expect(document.activeElement).toBe(addHuis);
    const sent = app.callsTo("POST", "/api/captures").map((call) => call.body);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0]);
  });

  it("removes a capture directly, treats an already removed one as gone, and moves focus to the next row", async () => {
    const app = renderApp({
      path: "/captures",
      handlers: {
        "GET /api/captures": () =>
          json(capturePage([capture(3, "fiets"), capture(2, "huis"), capture(1, "kaas")])),
        "DELETE /api/captures/:id": (request) =>
          request.path.endsWith("2")
            ? apiError(404, "not_found", "Capture not found")
            : json(capture(3, "fiets")),
      },
    });
    const user = userEvent.setup();
    await screen.findByText("fiets", { selector: "[data-testid=term]" });
    await user.click(screen.getByRole("button", { name: "Remove fiets" }));
    await waitFor(() => expect(rows()).toEqual(["huis", "kaas"]));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Add entry huis" })),
    );
    await user.click(screen.getByRole("button", { name: "Remove huis" }));
    await waitFor(() => expect(rows()).toEqual(["kaas"]));
    const removals = app.callsTo("DELETE", "/api/captures/0192a6b4-0000-7000-8000-000000000003");
    expect(removals[0]!.body).toEqual({ mutationId: expect.any(String) });
  });

  it("reviews a capture in Add and consumes it with the saved entry, not a separate delete", async () => {
    const app = renderApp({
      path: "/captures",
      handlers: {
        "GET /api/captures": () => json(capturePage([capture(1, "de fiets")])),
        "POST /api/entries/prepare": () =>
          json({ term: "de fiets", matches: [], inferred: { lemma: "fiets" } }),
        "POST /api/entries": () => json(detail(40, "fiets", { grammar: { article: "de" } })),
      },
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Add entry de fiets" }));
    await waitFor(() => expect(app.router.state.location.pathname).toBe("/add"));
    expect(screen.getByRole("textbox", { name: "Word or phrase" })).toHaveProperty(
      "value",
      "de fiets",
    );
    await user.click(await screen.findByRole("button", { name: "Save" }));
    await screen.findByText("Added “de fiets”");
    const [created] = app.callsTo("POST", "/api/entries");
    expect(created!.body).toMatchObject({
      captureId: capture(1, "").id,
      entry: { lemma: "de fiets" },
    });
    expect(app.calls.some((call) => call.method === "DELETE")).toBe(false);
  });

  it("lists an exactly captured term as a capture row before ranked results", async () => {
    const saved = capture(5, "fiets");
    let removed = false;
    renderApp({
      path: "/?q=fiets",
      handlers: {
        "GET /api/entries/search": () =>
          json({ items: [summary(1, "fietsen")], total: 1, metadata: { next_cursor: null } }),
        "GET /api/captures": (request) =>
          json(capturePage(request.query.get("term") === "fiets" && !removed ? [saved] : [])),
        "DELETE /api/captures/:id": () => {
          removed = true;
          return json(saved);
        },
      },
    });
    const user = userEvent.setup();
    const remove = await screen.findByRole("button", { name: "Remove fiets" });
    const [row, result] = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(row!.contains(remove)).toBe(true);
    expect(within(row!).getByText(/^Captured /)).toBeTruthy();
    expect(within(result!).getByRole("link").textContent).toBe("fietsen");
    await user.click(remove);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Remove fiets" })).toBeNull());
    expect(within(screen.getByRole("list")).getAllByRole("listitem")).toHaveLength(1);
    expect(document.activeElement).toBe(screen.getByRole("searchbox"));
  });

  it("shows Captures in Dutch", async () => {
    renderApp({
      path: "/captures",
      locale: "nl",
      handlers: { "GET /api/captures": () => json(capturePage([capture(1, "de fiets")])) },
    });
    expect(await screen.findByRole("heading", { level: 1, name: "Voor later" })).toBeTruthy();
    expect(
      screen.getByRole("textbox", { name: "Woord of uitdrukking om te bewaren" }),
    ).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Woord toevoegen de fiets" })).toBeTruthy();
    expect(screen.getByText(/^Bewaard op /)).toBeTruthy();
  });
});
