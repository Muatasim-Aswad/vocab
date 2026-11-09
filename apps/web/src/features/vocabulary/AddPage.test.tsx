import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { requestTerm, requestToken } from "../../../test/test-app.tsx";
import {
  apiError,
  capture,
  capturePage,
  deferred,
  detail,
  json,
  renderApp,
  summary,
  type FakeHandler,
  type FakeRequest,
} from "../../../test/test-app.tsx";

afterEach(cleanup);

const wait = (ms: number) => act(() => new Promise((done) => setTimeout(done, ms)));
const term = () => screen.getByRole("textbox", { name: "Word or phrase" });

const prepared =
  (overrides: Record<string, unknown> = {}): FakeHandler =>
  (request) => {
    const value = requestTerm(request.body);
    return json({ term: value, matches: [], inferred: { lemma: value }, ...overrides });
  };

const createBody = z.object({
  mutationId: z.string(),
  captureId: z.string().optional(),
  entry: z.record(z.string(), z.unknown()),
  senseCueBackfills: z.array(
    z.object({ id: z.number(), expectedRevision: z.number(), senseCue: z.string() }),
  ),
});
const bodies = (calls: FakeRequest[]) => calls.map((call) => createBody.parse(call.body));

const capturedId = capture(1, "").id;

function saved(request: FakeRequest) {
  const { entry } = createBody.parse(request.body);
  return json(detail(40, String(entry.lemma).replace(/^(de|het) /, ""), entry));
}

type User = ReturnType<typeof userEvent.setup>;

/** Types a term and submits it with Enter, as the first step of Add. */
async function enterTerm(user: User, value: string) {
  await user.type(await screen.findByRole("textbox", { name: "Word or phrase" }), value);
  await user.keyboard("{Enter}");
}

describe("Add", () => {
  it("shows only the term until it is submitted with Enter or the Continue icon", async () => {
    renderApp({ path: "/add", handlers: { "POST /api/entries/prepare": prepared() } });
    const user = userEvent.setup();
    const field = await screen.findByRole("textbox", { name: "Word or phrase" });
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
    await user.type(field, "fiets");
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByLabelText(/^Notes/)).toBeNull();

    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("button", { name: "Save" })).toBeTruthy();
    expect(screen.queryByLabelText(/^Notes/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Add notes" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText(/^Notes/)));
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();

    await user.type(term(), "en");
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.getByRole("button", { name: "Continue" })).toBeTruthy();
  });

  it("saves a word from the term alone, with API suggestions, then returns to Search with a toast", async () => {
    const app = renderApp({
      path: "/add",
      handlers: {
        "POST /api/entries/prepare": prepared({
          term: "het huis",
          inferred: {
            lemma: "huis",
            partOfSpeech: "NOUN",
            grammar: { article: "het" },
            forms: ["huizen"],
          },
        }),
        "POST /api/entries": () =>
          json(detail(40, "huis", { partOfSpeech: "NOUN", grammar: { article: "het" } })),
      },
    });
    const user = userEvent.setup();
    await enterTerm(user, "het huis");
    const forms = await screen.findByRole("group", { name: /^Forms/ });
    expect(within(forms).getAllByRole("listitem")[0]!.textContent).toBe("huizen (suggested)");
    expect(screen.queryByRole("button", { name: "Show suggested forms" })).toBeNull();

    await user.click(term());
    await user.keyboard("{Enter}");
    await screen.findByText("Added “het huis”");
    expect(app.router.state.location.pathname).toBe("/");
    const [body] = bodies(app.callsTo("POST", "/api/entries"));
    expect(body!.mutationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(body).toEqual({
      mutationId: body!.mutationId,
      entry: {
        lemma: "het huis",
        partOfSpeech: "NOUN",
        grammar: { article: "het" },
        forms: ["huizen"],
      },
      senseCueBackfills: [],
    });

    await act(() => app.router.navigate("/add"));
    expect(await screen.findByPlaceholderText("Add…")).toHaveProperty("value", "");
  });

  it("never overwrites manual choices and ignores preparation for an older term", async () => {
    const slow = deferred<Response>();
    const app = renderApp({
      path: "/add",
      handlers: {
        "POST /api/entries/prepare": (request) =>
          requestTerm(request.body) === "bank"
            ? slow.promise
            : json({
                term: "lopen",
                matches: [],
                inferred: { lemma: "lopen", partOfSpeech: "VERB", forms: ["liep"] },
              }),
        "POST /api/entries": saved,
      },
    });
    const user = userEvent.setup();
    await enterTerm(user, "bank");
    await user.clear(term());
    await user.type(term(), "lopen");
    slow.resolve(
      json({
        term: "de bank",
        matches: [summary(1, "bank")],
        inferred: { lemma: "bank", partOfSpeech: "NOUN" },
      }),
    );
    await wait(20);
    expect(screen.queryByText(/already has/)).toBeNull();

    await user.keyboard("{Enter}");
    await user.click(await screen.findByRole("button", { name: "Remove liep" }));
    expect(screen.queryByText("liep")).toBeNull();
    await user.selectOptions(screen.getByLabelText(/^Word type/), "ADV");
    expect(screen.getByLabelText<HTMLSelectElement>(/^Word type/).value).toBe("ADV");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText(/Added/);
    expect(bodies(app.callsTo("POST", "/api/entries"))[0]!.entry).toEqual({
      lemma: "lopen",
      partOfSpeech: "ADV",
    });
  });

  it("ignores an older preparation after returning to the same term", async () => {
    const oldResponse = deferred<Response>();
    let requests = 0;
    const app = renderApp({
      path: "/add",
      handlers: {
        "POST /api/entries/prepare": (request) => {
          requests++;
          return requests === 1 ? oldResponse.promise : prepared()(request);
        },
      },
    });
    const user = userEvent.setup();
    await enterTerm(user, "bank");
    await waitFor(() => expect(app.callsTo("POST", "/api/entries/prepare")).toHaveLength(1));
    expect(screen.getByText("Checking the word…")).toBeTruthy();
    await user.clear(term());
    await user.type(term(), "fiets");
    await user.clear(term());
    await user.type(term(), "bank");
    await user.keyboard("{Enter}");
    await screen.findByRole("button", { name: "Save" });
    oldResponse.resolve(
      json({ term: "bank", matches: [summary(1, "bank")], inferred: { lemma: "bank" } }),
    );
    await wait(20);
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    expect(screen.queryByText(/already has/)).toBeNull();
  });

  it("keeps the payload and identity after a lost response and creates once on retry", async () => {
    let attempts = 0;
    const app = renderApp({
      path: "/add",
      handlers: {
        "POST /api/entries/prepare": prepared(),
        "POST /api/entries": (request) => {
          attempts++;
          if (attempts === 1) throw new TypeError("connection reset");
          return saved(request);
        },
      },
    });
    const user = userEvent.setup();
    await enterTerm(user, "fiets");
    await user.click(await screen.findByRole("button", { name: "Add notes" }));
    await user.type(screen.getByLabelText(/^Notes/), "bicycle");
    await user.click(screen.getByRole("button", { name: "Save" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("did not confirm whether “fiets” was saved");
    expect(document.activeElement).toBe(alert);
    // The unresolved payload cannot change before it is reconciled.
    expect(term()).toHaveProperty("disabled", true);
    await user.type(screen.getByLabelText(/^Notes/), " changed");
    expect(screen.getByLabelText(/^Notes/)).toHaveProperty("value", "bicycle");
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Check again and save" }));
    await screen.findByText("Added “fiets”");
    const sent = bodies(app.callsTo("POST", "/api/entries"));
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0]);
    expect(sent[0]!.entry).toEqual({ lemma: "fiets", extra: "bicycle" });
  });

  it("sends one request for a double-click while saving", async () => {
    const response = deferred<Response>();
    const app = renderApp({
      path: "/add",
      handlers: {
        "POST /api/entries/prepare": prepared(),
        "POST /api/entries": () => response.promise,
      },
    });
    const user = userEvent.setup();
    await enterTerm(user, "peer");
    await user.dblClick(await screen.findByRole("button", { name: "Save" }));
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("button", { name: "Saving…" })).toHaveProperty("disabled", true);
    expect(document.getElementById("add-saving")!.textContent).toBe("Saving…");
    response.resolve(json(detail(41, "peer")));
    await screen.findByText("Added “peer”");
    expect(app.callsTo("POST", "/api/entries")).toHaveLength(1);
  });

  it("keeps all input after a rejected save and associates the error with its field", async () => {
    const app = renderApp({
      path: "/add",
      handlers: {
        "POST /api/entries/prepare": prepared(),
        "POST /api/entries": () =>
          json(
            {
              error: {
                status: 400,
                code: "bad_request",
                message: "Changed wording",
                reason: "INVALID_RELATION_TOKEN",
                request_id: "req-1",
              },
            },
            400,
          ),
      },
    });
    const user = userEvent.setup();
    await enterTerm(user, "fiets");
    const example = await screen.findByRole("textbox", { name: "Example 1" });
    expect(screen.queryByRole("button", { name: "Add example" })).toBeNull();
    await user.type(example, "Ik fiets");
    await user.click(screen.getByRole("button", { name: "Add example" }));
    expect(screen.queryByRole("button", { name: "Add example" })).toBeNull();
    await user.type(screen.getByRole("textbox", { name: "Example 2" }), "Ik fiets naar huis");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(
      await screen.findByText("A related word could not be understood. Check the related words.", {
        selector: "#add-notice p",
      }),
    ).toBeTruthy();
    expect(document.activeElement).toBe(document.getElementById("add-relations"));
    expect(screen.getByRole("textbox", { name: "Example 2" })).toHaveProperty(
      "value",
      "Ik fiets naar huis",
    );
    expect(term()).toHaveProperty("disabled", false);
    await user.click(screen.getByRole("button", { name: "Save" }));
    const sent = bodies(app.callsTo("POST", "/api/entries"));
    expect(sent).toHaveLength(2);
    expect(sent[1]!.mutationId).not.toBe(sent[0]!.mutationId);
  });

  it("shows an existing word as a card to edit or add another meaning, and detects changed meanings", async () => {
    let revision = 1;
    const app = renderApp({
      path: "/add",
      handlers: {
        "POST /api/entries/prepare": () =>
          json({
            term: "de bank",
            matches: [
              summary(3, "bank", {
                revision,
                extra: "money place",
                examples: ["Op de bank."],
                article: "de",
              }),
            ],
            inferred: { lemma: "bank", grammar: { article: "de" } },
          }),
        "POST /api/entries": saved,
      },
    });
    const user = userEvent.setup();
    await enterTerm(user, "de bank");
    const heading = await screen.findByRole("heading", { name: "“de bank” already has 1 meaning" });
    expect(document.activeElement).toBe(heading);
    const card = within(screen.getByRole("list")).getByRole("listitem");
    expect(within(card).getByRole("link").getAttribute("href")).toBe("/entries/3");
    expect(within(card).getByRole("link").textContent).toBe("de bank");
    expect(within(card).getByText("Op de bank.")).toBeTruthy();
    expect(within(card).getByRole("button", { name: "Edit this entry" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByLabelText(/^Notes/)).toBeNull();

    await user.click(screen.getByRole("button", { name: "Add another meaning" }));
    expect(document.activeElement).toBe(screen.getByLabelText("Label for this new meaning"));
    expect(screen.queryByRole("heading", { name: /already has/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit this entry" })).toBeNull();
    expect(within(card).getByPlaceholderText("Label for this entry…")).toBe(
      screen.getByLabelText("Label for the existing meaning: money place"),
    );
    expect(screen.queryByRole("textbox", { name: "Word or phrase" })).toBeNull();
    const cards = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(cards).toHaveLength(2);
    expect(cards[1]!.textContent).toBe("de bank");
    expect(within(cards[1]!).getByLabelText("Label for this new meaning")).toBeTruthy();
    expect(within(cards[1]!).queryByRole("link")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("textbox", { name: "Word or phrase" })).toBeTruthy();
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: "“de bank” already has 1 meaning" }),
    );
    await user.click(screen.getByRole("button", { name: "Add another meaning" }));
    expect(screen.queryByLabelText(/^Notes/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getAllByText("Enter a meaning label.")).toHaveLength(2);
    expect(screen.queryByLabelText(/^Notes/)).toBeNull();
    await user.type(screen.getByLabelText("Label for the existing meaning: money place"), "money");
    await user.type(screen.getByLabelText("Label for this new meaning"), "furniture");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.queryByRole("heading", { name: /already has/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Add notes" })).toBeTruthy();
    expect(screen.getByLabelText("Label for this new meaning")).toHaveProperty(
      "value",
      "furniture",
    );

    revision = 2;
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(
      await screen.findByText(/existing meanings changed since you opened them/, {
        selector: "#add-notice p",
      }),
    ).toBeTruthy();
    expect(app.callsTo("POST", "/api/entries")).toHaveLength(0);
    expect(screen.queryByLabelText(/^Notes/)).toBeNull();
    expect(screen.getByLabelText("Label for the existing meaning: money place")).toHaveProperty(
      "value",
      "money",
    );
    expect(screen.getByLabelText("Label for this new meaning")).toHaveProperty(
      "value",
      "furniture",
    );

    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText(/Added/);
    expect(bodies(app.callsTo("POST", "/api/entries"))[0]).toMatchObject({
      entry: { lemma: "de bank", senseCue: "furniture" },
      senseCueBackfills: [{ id: 3, expectedRevision: 2, senseCue: "money" }],
    });
  });

  it("shows the entry a term is a form of, to proceed with the term, edit that entry or cancel", async () => {
    const lopen = summary(3, "lopen", { partOfSpeech: "VERB", examples: ["Ik loop naar huis."] });
    const app = renderApp({
      path: "/add",
      handlers: {
        "POST /api/entries/prepare": prepared({ formOf: [lopen] }),
        "GET /api/entries/:id": () => json(detail(3, "lopen", { forms: ["liep"] })),
        "POST /api/entries": saved,
      },
    });
    const user = userEvent.setup();
    await enterTerm(user, "liep");
    const heading = await screen.findByRole("heading", {
      name: "“liep” is a form of an existing word",
    });
    expect(document.activeElement).toBe(heading);
    const card = within(screen.getByRole("list")).getByRole("listitem");
    expect(within(card).getByRole("link").getAttribute("href")).toBe("/entries/3");
    expect(within(card).getByText("Ik loop naar huis.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Proceed" }));
    expect(await screen.findByRole("button", { name: "Save" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /is a form of/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(app.callsTo("POST", "/api/entries")).toHaveLength(1));
    expect(bodies(app.callsTo("POST", "/api/entries"))[0]!.entry.lemma).toBe("liep");
    await waitFor(() => expect(app.router.state.location.pathname).toBe("/"));

    await act(() => app.router.navigate("/add"));
    await enterTerm(user, "liep");
    await user.click(await screen.findByRole("button", { name: "Edit" }));
    await waitFor(() => expect(app.router.state.location.pathname).toBe("/entries/3/edit"));

    await act(() => app.router.navigate("/add"));
    await enterTerm(user, "liep");
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(app.router.state.location.pathname).toBe("/"));
    await act(() => app.router.navigate("/add"));
    expect(await screen.findByRole("textbox", { name: "Word or phrase" })).toHaveProperty(
      "value",
      "",
    );
  });

  it("shows pending minimal entries and explicit meaning choices for related words", async () => {
    const app = renderApp({
      path: "/add",
      handlers: {
        "POST /api/entries/prepare": prepared(),
        "GET /api/entries/lookup": (request) =>
          json(
            request.query.get("term") === "bank"
              ? [detail(3, "bank", { senseCue: "money" }), detail(4, "bank", { senseCue: "seat" })]
              : [],
          ),
        "POST /api/entries": saved,
      },
    });
    const user = userEvent.setup();
    await enterTerm(user, "stoel");
    await user.click(screen.getByRole("button", { name: "Add related word" }));
    await user.type(screen.getByLabelText("Related word 1"), "zetel");
    await user.click(screen.getByRole("button", { name: "Add related word" }));
    await user.selectOptions(screen.getByLabelText("Relation 2"), "synonym");
    await user.type(screen.getByLabelText("Related word 2"), "bank");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByTitle(
        "“zetel” is not in your vocabulary yet. Saving adds it as a minimal entry.",
      ),
    ).toBeTruthy();
    expect(await screen.findByText("Choose which meaning this word relates to.")).toBeTruthy();
    expect(app.callsTo("POST", "/api/entries")).toHaveLength(0);

    await user.click(screen.getByRole("radio", { name: /bank \(seat\)/ }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText(/Added/);
    expect(bodies(app.callsTo("POST", "/api/entries"))[0]!.entry.relatedTokens).toEqual([
      "zetel",
      "+id:4",
    ]);
  });

  it("preserves the draft when access is lost and finishes the same save after login", async () => {
    let signedIn = true;
    const app = renderApp({
      path: "/add",
      handlers: {
        "POST /api/entries/prepare": prepared(),
        "POST /api/entries": (request) =>
          signedIn ? saved(request) : apiError(401, "unauthorized", "Authentication required"),
        "POST /api/auth/login": (request) => {
          signedIn = requestToken(request.body) === "right-token";
          return signedIn
            ? json({ authenticated: true })
            : apiError(401, "unauthorized", "Invalid token");
        },
      },
    });
    const user = userEvent.setup();
    await enterTerm(user, "kaas");
    const save = await screen.findByRole("button", { name: "Save" });
    signedIn = false;
    await user.click(save);

    expect(await screen.findByRole("heading", { name: "Sign in again" })).toBeTruthy();
    expect(document.querySelector("main")!.hidden).toBe(true);
    await user.type(screen.getByLabelText("Access token"), "wrong-token");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(
      await screen.findByText("This token was not accepted. Check it and try again."),
    ).toBeTruthy();
    expect(screen.getByLabelText("Access token")).toHaveProperty("value", "");

    await user.type(screen.getByLabelText("Access token"), "right-token");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await screen.findByText("Added “kaas”");
    const sent = bodies(app.callsTo("POST", "/api/entries"));
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0]);
  });

  it("keeps the draft across navigation and asks before replacing it", async () => {
    const app = renderApp({
      path: "/add",
      handlers: {
        "POST /api/entries/prepare": prepared(),
        "GET /api/entries/search": () =>
          json({ items: [], total: 0, metadata: { next_cursor: null } }),
      },
    });
    const user = userEvent.setup();
    await user.type(await screen.findByRole("textbox", { name: "Word or phrase" }), "appel");
    await act(() => app.router.navigate("/?q=peer"));
    await user.click(await screen.findByRole("button", { name: "Add" }));
    expect(await screen.findByText(/You have an unsaved draft for “appel”/)).toBeTruthy();
    expect(term()).toHaveProperty("value", "appel");
    await user.click(screen.getByRole("button", { name: "Start with “peer”" }));
    expect(term()).toHaveProperty("value", "peer");

    await user.click(await screen.findByRole("button", { name: "Clear" }));
    expect(term()).toHaveProperty("value", "");
    expect(app.router.state.location.pathname).toBe("/add");

    await user.type(term(), "kaas{Enter}");
    await user.click(await screen.findByRole("link", { name: "Keep draft" }));
    expect(app.router.state.location.pathname).toBe("/");
    expect(app.router.state.location.search).toBe("");
    await act(() => app.router.navigate("/add"));
    expect(term()).toHaveProperty("value", "kaas");
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(app.router.state.location.search).toBe("");
    await act(() => app.router.navigate("/add"));
    expect(term()).toHaveProperty("value", "");
  });

  it("removes a typed term's exact capture with the save", async () => {
    const app = renderApp({
      path: "/add",
      handlers: {
        "GET /api/captures": (request) =>
          json(capturePage(request.query.get("term") === "fiets" ? [capture(1, "fiets")] : [])),
        "POST /api/entries/prepare": prepared(),
        "POST /api/entries": saved,
      },
    });
    const user = userEvent.setup();
    await enterTerm(user, "fiets");
    await waitFor(() => expect(app.callsTo("GET", "/api/captures")).not.toHaveLength(0));
    await user.click(await screen.findByRole("button", { name: "Save" }));
    await screen.findByText("Added “fiets”");
    expect(bodies(app.callsTo("POST", "/api/entries"))[0]!.captureId).toBe(capturedId);
  });

  it("sends the entry again without its capture when the API will not consume that capture", async () => {
    let attempts = 0;
    const app = renderApp({
      path: "/captures",
      handlers: {
        "GET /api/captures": () => json(capturePage([capture(1, "fiets")])),
        "POST /api/entries/prepare": prepared(),
        "POST /api/entries": (request) => {
          attempts++;
          if (attempts === 1)
            return json(
              {
                error: {
                  status: 400,
                  code: "bad_request",
                  message: "Changed wording",
                  reason: "CAPTURE_MISMATCH",
                  request_id: "req-1",
                },
              },
              400,
            );
          return saved(request);
        },
      },
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Add entry fiets" }));
    await user.click(await screen.findByRole("button", { name: "Save" }));
    await screen.findByText("Added “fiets”");
    expect(
      screen.getByText("“fiets” stays in Captures, because the saved word is different."),
    ).toBeTruthy();
    const sent = bodies(app.callsTo("POST", "/api/entries"));
    expect(sent).toHaveLength(2);
    expect(sent[0]!.captureId).toBe(capturedId);
    expect(sent[1]!.captureId).toBeUndefined();
    expect(sent[1]!.mutationId).not.toBe(sent[0]!.mutationId);
    expect(sent[1]!.entry).toEqual(sent[0]!.entry);
  });
});
