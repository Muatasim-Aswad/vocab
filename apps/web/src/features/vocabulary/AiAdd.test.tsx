import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { requestTerm } from "../../../test/test-app.tsx";
import {
  apiError,
  deferred,
  detail,
  json,
  page,
  renderApp,
  summary,
  type FakeHandler,
  type FakeRequest,
} from "../../../test/test-app.tsx";
import { button } from "../../shared/ui.ts";

afterEach(cleanup);

const id = (n: number) => `0192a6b4-0000-7000-8000-${String(n).padStart(12, "0")}`;
const generationId = id(100);
const money = id(101);
const seat = id(102);

const moneyDraft = {
  draftId: money,
  term: "bank",
  corrected: false,
  senseCue: "money",
  extra: "financial institution",
  partOfSpeech: "NOUN",
  grammar: { article: "de" },
  examples: ["Ik ga naar de bank."],
};
const seatDraft = {
  draftId: seat,
  term: "bank",
  corrected: false,
  senseCue: "seat",
  extra: "long seat",
  partOfSpeech: "NOUN",
  grammar: { article: "de" },
};

const generated = (items: unknown[] = [moneyDraft, seatDraft]) =>
  json({ generationId, drafts: items, warnings: [], existing: [] });

const prepared =
  (matches: unknown[] = []): FakeHandler =>
  (request) => {
    const term = requestTerm(request.body);
    return json({ term, matches, inferred: { lemma: term } });
  };

const recorded: FakeHandler = () => json({ recorded: true });

function saved(request: FakeRequest) {
  const { entry } = z.object({ entry: z.record(z.string(), z.unknown()) }).parse(request.body);
  return json(detail(40, String(entry.lemma), entry));
}

const eventBody = z.object({
  eventId: z.string(),
  draftId: z.string(),
  eventType: z.enum(["presented", "skipped"]),
});
type EventBody = z.infer<typeof eventBody>;
const events = (app: ReturnType<typeof renderApp>, type?: EventBody["eventType"]) =>
  app
    .callsTo("POST", "/api/ai/draft-events")
    .map((call) => eventBody.parse(call.body))
    .filter((body) => !type || body.eventType === type);

const sameAsThree = (revision = 1) =>
  json({
    decision: "same",
    entryId: 3,
    reason: "Both mean walking.",
    compared: [{ id: 3, revision }],
  });

type User = ReturnType<typeof userEvent.setup>;

async function enterTerm(user: User, value: string) {
  await user.type(await screen.findByRole("textbox", { name: "Word or phrase" }), value);
  await user.keyboard("{Enter}");
}

const notes = () => screen.getByLabelText<HTMLTextAreaElement>(/^Notes/);
const suggestionHeading = () => document.getElementById("add-suggestion")?.textContent;
const status = () => document.querySelector("p[role=status]")?.textContent;

describe("AI suggestions in Add", () => {
  it("accepts a suggestion with related words that are not saved yet, adding them as new", async () => {
    const app = renderApp({
      path: "/add",
      handlers: {
        "POST /api/entries/prepare": prepared(),
        "POST /api/ai/generate": () => generated([{ ...seatDraft, relatedTokens: ["+zitbank"] }]),
        "POST /api/ai/draft-events": recorded,
        "GET /api/entries/lookup": () => json([]),
        "POST /api/entries": saved,
      },
    });
    const user = userEvent.setup();
    await enterTerm(user, "bank");
    await user.click(await screen.findByRole("button", { name: "Suggest with AI" }));
    await waitFor(() => expect(suggestionHeading()).toBe("de bank seat"));
    expect(screen.getByText("zitbank")).toBeTruthy();
    expect(status()).toBe("");

    await user.click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(app.router.state.location.pathname).toBe("/"));
    expect(app.callsTo("POST", "/api/entries")[0]!.body).toMatchObject({
      entry: { lemma: "bank", senseCue: "seat", relatedTokens: ["+zitbank"] },
    });
  });

  it("keeps a suggestion under review when a related word cannot be looked up, and Accept tries again", async () => {
    let lookups = 0;
    const app = renderApp({
      path: "/add",
      handlers: {
        "POST /api/entries/prepare": prepared(),
        "POST /api/ai/generate": () => generated([{ ...seatDraft, relatedTokens: ["+zitbank"] }]),
        "POST /api/ai/draft-events": recorded,
        "GET /api/entries/lookup": () => {
          if (++lookups === 1) throw new TypeError("connection reset");
          return json([]);
        },
        "POST /api/entries": saved,
      },
    });
    const user = userEvent.setup();
    await enterTerm(user, "bank");
    await user.click(await screen.findByRole("button", { name: "Suggest with AI" }));
    await waitFor(() => expect(suggestionHeading()).toBe("de bank seat"));

    await user.click(screen.getByRole("button", { name: "Accept" }));
    expect(await screen.findByText(/could not be reached.*Nothing was saved/)).toBeTruthy();
    expect(suggestionHeading()).toBe("de bank seat");
    expect(screen.queryByLabelText(/^Notes/)).toBeNull();
    expect(app.callsTo("POST", "/api/entries")).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(app.router.state.location.pathname).toBe("/"));
    expect(lookups).toBe(2);
    expect(app.callsTo("POST", "/api/entries")).toHaveLength(1);
  });

  it("shows a suggestion as an entry only on request, records what is shown, accepts it with provenance and opens the next one", async () => {
    const app = renderApp({
      path: "/add",
      handlers: {
        "POST /api/entries/prepare": prepared(),
        "POST /api/ai/generate": () => generated(),
        "POST /api/ai/draft-events": recorded,
        "POST /api/entries": saved,
      },
    });
    const user = userEvent.setup();
    await enterTerm(user, "bank");
    await screen.findByRole("button", { name: "Save" });
    expect(app.callsTo("POST", "/api/ai/generate")).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Suggest with AI" }));
    await waitFor(() => expect(status()).toBe("AI suggestion 1 of 2."));
    expect(app.callsTo("POST", "/api/ai/generate")[0]!.body).toEqual({
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      term: "bank",
      allowExisting: false,
    });
    expect(suggestionHeading()).toBe("de bank money");
    expect(screen.getByText("financial institution")).toBeTruthy();
    expect(screen.getByText("Ik ga naar de bank.")).toBeTruthy();
    expect(screen.queryByLabelText(/^Notes/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
    await waitFor(() => expect(events(app, "presented")).toHaveLength(1));
    expect(events(app, "presented")[0]!.draftId).toBe(money);

    await user.click(screen.getByRole("button", { name: "Accept" }));
    await screen.findByText("Added “de bank”");
    expect(app.callsTo("POST", "/api/entries")[0]!.body).toEqual({
      mutationId: expect.any(String),
      entry: {
        lemma: "bank",
        senseCue: "money",
        extra: "financial institution",
        examples: ["Ik ga naar de bank."],
        partOfSpeech: "NOUN",
        grammar: { article: "de" },
      },
      senseCueBackfills: [],
      ai: {
        generationId,
        drafts: [
          {
            draftId: money,
            editableBaseline: {
              lemma: "bank",
              senseCue: "money",
              extra: "financial institution",
              examples: ["Ik ga naar de bank."],
              partOfSpeech: "NOUN",
              grammar: { article: "de" },
              inferred: [],
            },
          },
        ],
        adapterVersion: "web-ai-draft-v1",
      },
    });

    await waitFor(() => expect(status()).toBe("AI suggestion 2 of 2."));
    expect(app.router.state.location.pathname).toBe("/add");
    expect(suggestionHeading()).toBe("de bank seat");
    expect(screen.getByText("long seat")).toBeTruthy();
    await waitFor(() => expect(events(app, "presented")).toHaveLength(2));
    expect(screen.queryByRole("button", { name: "Next suggestion" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Previous suggestion" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(app.router.state.location.pathname).toBe("/"));
  });

  it("opens a suggestion in the form with Edit, keeps edits across Previous and Next, and returns to Search after the last skip", async () => {
    const app = renderApp({
      path: "/add",
      handlers: {
        "POST /api/entries/prepare": prepared(),
        "POST /api/ai/generate": () => generated(),
        "POST /api/ai/draft-events": recorded,
        "POST /api/entries": saved,
      },
    });
    const user = userEvent.setup();
    await enterTerm(user, "bank");
    await user.click(await screen.findByRole("button", { name: "Add notes" }));
    await user.type(notes(), "my own words");
    await user.click(screen.getByRole("button", { name: "Suggest with AI" }));
    await waitFor(() => expect(suggestionHeading()).toBe("de bank money"));

    await user.click(screen.getByRole("button", { name: "Edit suggestion" }));
    expect(notes().value).toBe("financial institution");
    expect(screen.getByLabelText("Label for this meaning")).toHaveProperty("value", "money");
    expect(screen.queryByRole("button", { name: "Edit suggestion" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Keep draft" })).toBeNull();
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    await user.type(notes(), " (edited)");

    await user.click(screen.getByRole("button", { name: "Next suggestion" }));
    await waitFor(() => expect(suggestionHeading()).toBe("de bank seat"));
    expect(screen.queryByLabelText(/^Notes/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Previous suggestion" }));
    await waitFor(() => expect(notes().value).toBe("financial institution (edited)"));

    await user.click(screen.getByRole("button", { name: "Skip" }));
    await waitFor(() => expect(suggestionHeading()).toBe("de bank seat"));
    expect(screen.queryByRole("button", { name: "Next suggestion" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Skip" }));
    await waitFor(() => expect(app.router.state.location.pathname).toBe("/"));
    expect(events(app, "skipped").map((event) => event.draftId)).toEqual([money, seat]);
    expect(events(app, "presented")).toHaveLength(2);

    // The user's own draft held more than the term, so it is kept for later.
    await act(() => app.router.navigate("/add"));
    await waitFor(() => expect(notes().value).toBe("my own words"));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Added “bank”");
    expect(app.callsTo("POST", "/api/entries")[0]!.body).toEqual({
      mutationId: expect.any(String),
      entry: { lemma: "bank", extra: "my own words" },
      senseCueBackfills: [],
    });
  });

  it("asks AI from the term field, at once for a new term and after Add another meaning for a known one, without a form while it works", async () => {
    const responses = [deferred<Response>(), deferred<Response>()];
    const existing = summary(3, "bank", { senseCue: "money" });
    const app = renderApp({
      path: "/add",
      handlers: {
        "POST /api/entries/prepare": (request) =>
          prepared(requestTerm(request.body) === "bank" ? [existing] : [])(request),
        "POST /api/ai/generate": () =>
          responses[app.callsTo("POST", "/api/ai/generate").length - 1]!.promise,
        "POST /api/ai/draft-events": recorded,
      },
    });
    const user = userEvent.setup();
    const term = await screen.findByRole("textbox", { name: "Word or phrase" });
    await user.type(term, "bank");
    await user.click(screen.getByRole("button", { name: "Suggest with AI" }));
    await screen.findByRole("heading", { name: "“bank” already has 1 meaning" });
    expect(app.callsTo("POST", "/api/ai/generate")).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Add another meaning" }));
    await waitFor(() => expect(status()).toMatch(/Asking AI for suggestions/));
    expect(app.callsTo("POST", "/api/ai/generate")[0]!.body).toMatchObject({
      term: "bank",
      allowExisting: true,
    });
    expect(screen.queryByLabelText("Label for this new meaning")).toBeNull();
    expect(screen.queryByRole("heading", { name: /already has/ })).toBeNull();

    await act(async () => responses[0]!.resolve(generated([seatDraft])));
    await waitFor(() => expect(suggestionHeading()).toBe("de bank seat"));
    await user.click(screen.getByRole("button", { name: "Skip" }));
    await waitFor(() => expect(app.router.state.location.pathname).toBe("/"));

    await act(() => app.router.navigate("/add"));
    const fresh = await screen.findByRole("textbox", { name: "Word or phrase" });
    expect(fresh).toHaveProperty("value", "");
    await user.type(fresh, "stoel");
    await user.click(screen.getByRole("button", { name: "Suggest with AI" }));
    await waitFor(() => expect(app.callsTo("POST", "/api/ai/generate")).toHaveLength(2));
    expect(app.callsTo("POST", "/api/ai/generate")[1]!.body).toMatchObject({
      term: "stoel",
      allowExisting: false,
    });
    expect(screen.queryByRole("button", { name: "Add notes" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("asks AI straight from Search when nothing matches", async () => {
    const app = renderApp({
      path: "/?q=fiets",
      handlers: {
        "GET /api/entries/search": () => json(page([])),
        "POST /api/entries/prepare": prepared(),
        "POST /api/ai/generate": () => deferred<Response>().promise,
      },
    });
    const user = userEvent.setup();
    expect(await screen.findByRole("button", { name: "Add" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Suggest with AI" }));
    await waitFor(() => expect(app.router.state.location.pathname).toBe("/add"));
    await waitFor(() => expect(app.callsTo("POST", "/api/ai/generate")).toHaveLength(1));
    expect(app.callsTo("POST", "/api/ai/generate")[0]!.body).toMatchObject({ term: "fiets" });
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  const walk = {
    draftId: seat,
    term: "lopen",
    corrected: true,
    senseCue: "walk",
    extra: "to walk",
    partOfSpeech: "VERB",
    examples: ["Wij lopen samen."],
    forms: ["loop", "liep", "gelopen"],
  };

  /**
   * Asks AI about "liep", corrected to "lopen", which has `existing` as its one meaning; `match`
   * answers the comparison.
   */
  function correctedApp(
    existing: Record<string, unknown>,
    stored: Record<string, unknown>,
    match: FakeHandler = () => apiError(503, "unavailable", "AI returned an invalid decision"),
  ) {
    return renderApp({
      path: "/add",
      handlers: {
        "POST /api/entries/prepare": (request) =>
          prepared(requestTerm(request.body) === "lopen" ? [existing] : [])(request),
        "POST /api/ai/generate": () => generated([walk]),
        "POST /api/ai/draft-events": recorded,
        "POST /api/ai/meaning-match": match,
        "POST /api/entries": saved,
        "GET /api/entries/:id": () => json(detail(3, "lopen", stored)),
        "PATCH /api/entries/:id": (request) =>
          json(
            detail(
              3,
              "lopen",
              z.object({ changes: z.record(z.string(), z.unknown()) }).parse(request.body).changes,
            ),
          ),
      },
    });
  }

  it("asks whether a corrected suggestion is one of its term's meanings; New meaning labels it beside them", async () => {
    const app = correctedApp(summary(3, "lopen", { examples: ["Ik loop naar huis."] }), {});
    const user = userEvent.setup();
    await enterTerm(user, "liep");
    await user.click(await screen.findByRole("button", { name: "Suggest with AI" }));
    expect(
      await screen.findByRole("heading", { name: "“lopen” already has 1 meaning" }),
    ).toBeTruthy();
    expect(status()).toBe(
      "Corrected from “liep” to “lopen”. AI could not compare it with the existing meanings.",
    );
    expect(suggestionHeading()).toBeUndefined();
    expect(screen.queryByText(/is recommended:/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
    let cards = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(cards).toHaveLength(2);
    expect(within(cards[0]!).getByRole("button", { name: "Same meaning" })).toBeTruthy();
    expect(within(cards[1]!).getByText("Wij lopen samen.")).toBeTruthy();
    expect(within(cards[1]!).queryByRole("textbox")).toBeNull();

    await user.click(screen.getByRole("button", { name: "New meaning" }));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByLabelText("Label for this new meaning")),
    );
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Same meaning" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Word or phrase" })).toBeNull();
    cards = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(cards).toHaveLength(2);
    expect(within(cards[1]!).getByText("verb")).toBeTruthy();
    expect(within(cards[1]!).getByLabelText("Label for this new meaning")).toHaveProperty(
      "value",
      "walk",
    );
    expect(within(cards[0]!).getByPlaceholderText("Label for this entry…")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("button", { name: "Same meaning" })).toBeTruthy();
    expect(app.callsTo("POST", "/api/entries")).toHaveLength(0);
  });

  it("completes an active entry with a suggestion of the same meaning, noting the values it replaced", async () => {
    const comparison = deferred<Response>();
    const app = correctedApp(
      summary(3, "lopen", { revision: 2 }),
      {
        revision: 2,
        extra: "to run",
        partOfSpeech: "VERB",
        examples: ["Ik loop naar huis."],
        forms: ["loop", "liep"],
        tags: ["movement"],
      },
      () => comparison.promise,
    );
    const user = userEvent.setup();
    await enterTerm(user, "liep");
    await user.click(await screen.findByRole("button", { name: "Suggest with AI" }));
    await waitFor(() => expect(status()).toBe("Comparing with the existing meanings of “lopen”…"));
    expect(screen.queryByRole("button", { name: "Same meaning" })).toBeNull();
    expect(app.callsTo("POST", "/api/ai/meaning-match")[0]!.body).toMatchObject({
      draftId: seat,
      draft: { term: "lopen", senseCue: "walk", extra: "to walk", examples: ["Wij lopen samen."] },
      entryIds: [3],
    });
    comparison.resolve(sameAsThree(2));
    const same = await screen.findByRole("button", { name: "Same meaning" });
    expect(same.className).toBe(button.primary);
    expect(screen.getByRole("button", { name: "New meaning" }).className).toBe(button.secondary);
    expect(screen.getByText("“Same meaning” is recommended: Both mean walking.")).toBeTruthy();
    await user.click(same);

    expect(await screen.findByRole("button", { name: "Save" })).toBeTruthy();
    expect(notes().value).toBe("to walk");
    expect(screen.getByText("Was: to run")).toBeTruthy();
    expect(screen.getByText("Was: loop, liep")).toBeTruthy();
    expect(screen.queryByText(/^Was: verb/)).toBeNull();
    expect(
      screen
        .getAllByRole<HTMLInputElement>("textbox", { name: /^Example/ })
        .map((field) => field.value),
    ).toEqual(["Wij lopen samen.", "Ik loop naar huis."]);

    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(app.callsTo("PATCH", "/api/entries/3")).toHaveLength(1));
    const body = z
      .object({
        expectedRevision: z.number(),
        changes: z.record(z.string(), z.unknown()),
        ai: z.object({
          drafts: z.array(z.object({ editableBaseline: z.record(z.string(), z.unknown()) })),
        }),
      })
      .parse(app.callsTo("PATCH", "/api/entries/3")[0]!.body);
    expect(body.expectedRevision).toBe(2);
    expect(body.changes).toMatchObject({
      extra: "to walk",
      examples: ["Wij lopen samen.", "Ik loop naar huis."],
      forms: ["loop", "liep", "gelopen"],
      tags: ["movement"],
    });
    expect(body.changes.lemma).toBeUndefined();
    expect(body.ai.drafts[0]!.editableBaseline).toMatchObject({ entryId: 3, expectedRevision: 2 });
    expect(app.callsTo("POST", "/api/entries")).toHaveLength(0);
    await waitFor(() => expect(app.router.state.location.pathname).toBe("/"));
  });

  it("fills the labels a new-meaning recommendation gives, so the suggestion is ready to accept", async () => {
    const app = correctedApp(summary(3, "lopen", { examples: ["Ik loop naar huis."] }), {}, () =>
      json({
        decision: "new",
        senseCue: "stroll",
        backfills: [{ id: 3, senseCue: "run" }],
        reason: "Walking differs from running.",
        compared: [{ id: 3, revision: 1 }],
      }),
    );
    const user = userEvent.setup();
    await enterTerm(user, "liep");
    await user.click(await screen.findByRole("button", { name: "Suggest with AI" }));
    const newMeaning = await screen.findByRole("button", { name: "New meaning" });
    expect(newMeaning.className).toBe(button.primary);
    expect(screen.getByRole("button", { name: "Same meaning" }).className).toBe(button.secondary);
    expect(
      screen.getByText("“New meaning” is recommended: Walking differs from running."),
    ).toBeTruthy();

    await user.click(newMeaning);
    await waitFor(() => expect(suggestionHeading()).toBe("lopen stroll"));
    await user.click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(app.callsTo("POST", "/api/entries")).toHaveLength(1));
    expect(app.callsTo("POST", "/api/entries")[0]!.body).toMatchObject({
      entry: { lemma: "lopen", senseCue: "stroll" },
      senseCueBackfills: [{ id: 3, expectedRevision: 1, senseCue: "run" }],
    });
  });

  it("compares later suggestions in the background, so they open with their recommendation", async () => {
    const stroll = { ...walk, draftId: money, senseCue: "stroll", extra: "to stroll" };
    const app = renderApp({
      path: "/add",
      handlers: {
        "POST /api/entries/prepare": (request) =>
          prepared(requestTerm(request.body) === "lopen" ? [summary(3, "lopen")] : [])(request),
        "POST /api/ai/generate": () => generated([walk, stroll]),
        "POST /api/ai/draft-events": recorded,
        "POST /api/ai/meaning-match": (request) =>
          z.object({ draftId: z.string() }).parse(request.body).draftId === money
            ? sameAsThree()
            : apiError(503, "unavailable", "AI returned an invalid decision"),
      },
    });
    const user = userEvent.setup();
    await enterTerm(user, "liep");
    await user.click(await screen.findByRole("button", { name: "Suggest with AI" }));
    expect(await screen.findByRole("button", { name: "New meaning" })).toBeTruthy();
    await waitFor(() => expect(app.callsTo("POST", "/api/ai/meaning-match")).toHaveLength(2));
    expect(screen.queryByText(/is recommended:/)).toBeNull();

    await user.click(screen.getByRole("button", { name: "Next suggestion" }));
    expect(
      await screen.findByText("“Same meaning” is recommended: Both mean walking."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Same meaning" }).className).toBe(button.primary);
    expect(app.callsTo("POST", "/api/ai/meaning-match")).toHaveLength(2);
  });

  it("completes a stub with a suggestion of the same meaning, shown as the entry to accept", async () => {
    const app = correctedApp(summary(3, "lopen", { status: "stub" }), { status: "stub" }, () =>
      sameAsThree(),
    );
    const user = userEvent.setup();
    await enterTerm(user, "liep");
    await user.click(await screen.findByRole("button", { name: "Suggest with AI" }));
    await user.click(await screen.findByRole("button", { name: "Same meaning" }));
    await waitFor(() => expect(suggestionHeading()).toBe("lopen walk"));

    await user.click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(app.callsTo("PATCH", "/api/entries/3")).toHaveLength(1));
    expect(
      z
        .object({ changes: z.object({}).passthrough() })
        .parse(app.callsTo("PATCH", "/api/entries/3")[0]!.body).changes,
    ).toMatchObject({ lemma: "lopen", extra: "to walk", forms: ["loop", "liep", "gelopen"] });
    expect(app.callsTo("POST", "/api/entries")).toHaveLength(0);
  });

  it("replays generation and events with their original IDs after failures and lost access", async () => {
    let generateAttempts = 0;
    let signedIn = true;
    const failedOnce = new Set<string>();
    const app = renderApp({
      path: "/add",
      handlers: {
        "POST /api/entries/prepare": prepared(),
        "POST /api/ai/generate": () => {
          generateAttempts++;
          if (generateAttempts === 1) throw new TypeError("connection reset");
          if (!signedIn) return apiError(401, "unauthorized", "Authentication required");
          return generated();
        },
        "POST /api/ai/draft-events": (request) => {
          const { eventId } = eventBody.parse(request.body);
          if (failedOnce.has(eventId)) return recorded(request);
          failedOnce.add(eventId);
          throw new TypeError("connection reset");
        },
        "POST /api/auth/login": () => {
          signedIn = true;
          return json({ authenticated: true });
        },
      },
    });
    const user = userEvent.setup();
    await enterTerm(user, "bank");
    await user.click(await screen.findByRole("button", { name: "Suggest with AI" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "AI suggestions could not be generated. Vocab could not be reached. Check the connection.",
    );

    signedIn = false;
    await user.click(screen.getByRole("button", { name: "Ask AI again" }));
    await user.type(await screen.findByLabelText("Access token"), "right-token");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(status()).toBe("AI suggestion 1 of 2."));
    const requests = app.callsTo("POST", "/api/ai/generate").map((call) => call.body);
    expect(requests).toHaveLength(3);
    expect(requests[1]).toEqual(requests[0]);
    expect(requests[2]).toEqual(requests[0]);

    // The failed presentation is resent under its ID by the next action.
    await waitFor(() => expect(events(app, "presented")).toHaveLength(1));
    await user.click(screen.getByRole("button", { name: "Next suggestion" }));
    await waitFor(() => expect(events(app, "presented")).toHaveLength(3));
    await user.click(screen.getByRole("button", { name: "Skip" }));
    await waitFor(() => expect(events(app, "skipped")).toHaveLength(1));
    await act(() => new Promise((done) => setTimeout(done, 50)));
    expect(events(app, "presented")).toHaveLength(4);
    const ids = (draftId: string) =>
      new Set(
        events(app, "presented")
          .filter((e) => e.draftId === draftId)
          .map((e) => e.eventId),
      );
    expect(ids(money).size).toBe(1);
    expect(ids(seat).size).toBe(1);
  });

  it("drops a response that arrives after the term changed, without any event", async () => {
    const response = deferred<Response>();
    const app = renderApp({
      path: "/add",
      handlers: {
        "POST /api/entries/prepare": prepared(),
        "POST /api/ai/generate": () => response.promise,
        "POST /api/ai/draft-events": recorded,
      },
    });
    const user = userEvent.setup();
    await enterTerm(user, "bank");
    await user.dblClick(await screen.findByRole("button", { name: "Suggest with AI" }));
    await waitFor(() => expect(status()).toMatch(/Asking AI for suggestions/));
    expect(app.callsTo("POST", "/api/ai/generate")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Add notes" })).toBeNull();

    await user.type(screen.getByRole("textbox", { name: "Word or phrase" }), "je");
    await act(async () => response.resolve(generated()));
    expect(screen.queryByText(/AI suggestion/)).toBeNull();
    expect(events(app)).toHaveLength(0);
  });

  it("offers AI beside existing meanings and saves the suggestion as another meaning, resending it unchanged", async () => {
    let attempts = 0;
    const existing = summary(3, "bank", { senseCue: "money", examples: ["Naar de bank."] });
    const app = renderApp({
      path: "/add",
      handlers: {
        "POST /api/entries/prepare": prepared([existing]),
        "POST /api/ai/generate": () => generated([seatDraft]),
        "POST /api/ai/draft-events": recorded,
        "POST /api/entries": (request) => {
          attempts++;
          if (attempts === 1) throw new TypeError("connection reset");
          return saved(request);
        },
      },
    });
    const user = userEvent.setup();
    await enterTerm(user, "bank");
    await screen.findByRole("heading", { name: "“bank” already has 1 meaning" });
    await user.click(screen.getByRole("button", { name: "Suggest with AI" }));
    expect(app.callsTo("POST", "/api/ai/generate")[0]!.body).toMatchObject({
      allowExisting: true,
      excludeSenses: [{ senseCue: "money", example: "Naar de bank." }],
    });

    await waitFor(() => expect(suggestionHeading()).toBe("de bank seat"));
    expect(screen.getByText("long seat")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Accept" }));
    await screen.findByText(/did not confirm whether “bank” was saved/);
    await user.click(screen.getByRole("button", { name: "Check again and save" }));
    await screen.findByText("Added “de bank”");

    const writes = app.callsTo("POST", "/api/entries").map((call) => call.body);
    expect(writes).toHaveLength(2);
    expect(writes[1]).toEqual(writes[0]);
    expect(writes[0]).toMatchObject({
      entry: { lemma: "bank", senseCue: "seat", extra: "long seat" },
      senseCueBackfills: [],
      ai: {
        generationId,
        drafts: [{ draftId: seat, editableBaseline: { senseCue: "seat", extra: "long seat" } }],
      },
    });
  });
});
