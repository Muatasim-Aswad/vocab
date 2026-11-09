import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { requestTerm } from "../../../test/test-app.tsx";
import { detail, json, renderApp, summary, type FakeRequest } from "../../../test/test-app.tsx";

afterEach(cleanup);

/** The grammar an edit sends when the draft sets none of it. */
const noGrammar = {
  article: null,
  isReflexive: false,
  isSeparable: false,
  irregular: null,
  isDiminutive: false,
  isCountable: null,
  number: null,
};

const entryId = (request: FakeRequest) => Number(request.path.split("/").at(-1));

const fiets = () =>
  json({
    ...detail(5, "fiets", {
      revision: 4,
      extra: "bicycle",
      examples: ["Ik fiets"],
      partOfSpeech: "NOUN",
      grammar: { article: "de" },
      tags: ["transport", "daily"],
    }),
    relations: [{ type: "synonym", entry: summary(9, "rijwiel") }],
  });

const preparedFor =
  (matches: unknown[], inferred: Record<string, unknown> = {}) =>
  () =>
    json({ term: "fiets", matches, inferred: { lemma: "fiets", ...inferred } });

const pathname = (app: ReturnType<typeof renderApp>) => app.router.state.location.pathname;

describe("Edit", () => {
  it("opens from Add's Edit icon with the entry's values, saves every field and returns to Search", async () => {
    const app = renderApp({
      path: "/add",
      handlers: {
        "POST /api/entries/prepare": preparedFor([summary(5, "fiets", { revision: 4 })], {
          partOfSpeech: "VERB",
        }),
        "GET /api/entries/:id": fiets,
        "PATCH /api/entries/:id": () => json(detail(5, "fiets", { revision: 5 })),
      },
    });
    const user = userEvent.setup();
    await user.type(await screen.findByRole("textbox", { name: "Word or phrase" }), "fiets");
    await user.keyboard("{Enter}");
    await user.click(await screen.findByRole("button", { name: "Edit this entry" }));
    expect(pathname(app)).toBe("/entries/5/edit");
    expect(await screen.findByLabelText(/^Notes/)).toHaveProperty("value", "bicycle");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Edit fiets");
    expect(screen.queryByRole("textbox", { name: "Word or phrase" })).toBeNull();
    expect(document.activeElement).toBe(document.getElementById("add-examples"));
    expect(screen.getByRole("textbox", { name: "Example 1" })).toHaveProperty("value", "Ik fiets");
    expect(screen.getByLabelText<HTMLSelectElement>(/^Word type/).value).toBe("NOUN");
    expect(screen.getByLabelText("Related word 1")).toHaveProperty("value", "rijwiel");

    await user.clear(screen.getByLabelText(/^Notes/));
    await user.click(screen.getByRole("button", { name: "Remove daily" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Updated “fiets”")).toBeTruthy();
    expect(pathname(app)).toBe("/");
    expect(app.callsTo("PATCH", "/api/entries/5")[0]!.body).toEqual({
      mutationId: expect.any(String),
      expectedRevision: 4,
      changes: {
        extra: "",
        examples: ["Ik fiets"],
        partOfSpeech: "NOUN",
        grammar: { ...noGrammar, article: "de" },
        forms: [],
        collocations: [],
        tags: ["transport"],
        relatedTokens: ["+id:9"],
      },
    });

    await act(() => app.router.navigate("/add"));
    expect(await screen.findByRole("textbox", { name: "Word or phrase" })).toHaveProperty(
      "value",
      "",
    );
  });

  it("opens from the entry page, cancels back to it, and keeps unsaved changes of another entry", async () => {
    const app = renderApp({
      path: "/entries/5",
      handlers: {
        "POST /api/entries/prepare": (request) => {
          const term = requestTerm(request.body);
          return json({
            term,
            matches: [summary(term === "fiets" ? 5 : 6, term)],
            inferred: { lemma: term },
          });
        },
        "GET /api/entries/:id": (request) =>
          entryId(request) === 5 ? fiets() : json(detail(6, "auto", { extra: "car" })),
      },
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("link", { name: "Edit entry" }));
    const notes = await screen.findByLabelText(/^Notes/);
    await user.type(notes, " and more");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await screen.findByRole("link", { name: "Edit entry" });
    expect(pathname(app)).toBe("/entries/5");

    await user.click(screen.getByRole("link", { name: "Edit entry" }));
    expect(await screen.findByLabelText(/^Notes/)).toHaveProperty("value", "bicycle");
    await user.type(screen.getByLabelText(/^Notes/), "!");
    await act(() => app.router.navigate("/entries/6/edit"));
    const notice = await screen.findByRole("group", {
      name: "You have unsaved changes to “fiets”.",
    });
    expect(screen.queryByLabelText(/^Notes/)).toBeNull();
    await user.click(within(notice).getByRole("link", { name: "Continue editing “fiets”" }));
    expect(await screen.findByLabelText(/^Notes/)).toHaveProperty("value", "bicycle!");
    expect(pathname(app)).toBe("/entries/5/edit");

    await act(() => app.router.navigate("/entries/6/edit"));
    await user.click(
      await screen.findByRole("button", { name: "Discard them and edit this entry" }),
    );
    expect(await screen.findByLabelText(/^Notes/)).toHaveProperty("value", "car");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Edit auto");
  });

  it("retains Add and Edit drafts independently across navigation", async () => {
    const app = renderApp({
      path: "/add",
      handlers: {
        "POST /api/entries/prepare": (request) => {
          const term = requestTerm(request.body);
          return json({
            term,
            matches: term === "fiets" ? [summary(5, term, { revision: 4 })] : [],
            inferred: { lemma: term },
          });
        },
        "GET /api/entries/:id": fiets,
      },
    });
    const user = userEvent.setup();
    await user.type(await screen.findByRole("textbox", { name: "Word or phrase" }), "appel{Enter}");
    await user.type(await screen.findByRole("textbox", { name: "Example 1" }), "apple draft");

    await act(() => app.router.navigate("/entries/5/edit"));
    await user.type(await screen.findByLabelText(/^Notes/), " edited");
    await act(() => app.router.navigate("/add"));
    expect(await screen.findByRole("textbox", { name: "Example 1" })).toHaveProperty(
      "value",
      "apple draft",
    );
    expect(screen.getByRole("textbox", { name: "Word or phrase" })).toHaveProperty(
      "value",
      "appel",
    );

    await act(() => app.router.navigate("/entries/5/edit"));
    expect(await screen.findByLabelText(/^Notes/)).toHaveProperty("value", "bicycle edited");
  });

  it("keeps an entry's forms as chips and shows suggested forms only on request", async () => {
    const app = renderApp({
      path: "/entries/5/edit",
      handlers: {
        "POST /api/entries/prepare": preparedFor([summary(5, "fiets", { revision: 4 })], {
          forms: ["fietsen", "fietsje"],
        }),
        "GET /api/entries/:id": () =>
          json(
            detail(5, "fiets", { revision: 4, forms: ["fietsen"], collocations: ["op de fiets"] }),
          ),
        "PATCH /api/entries/:id": () => json(detail(5, "fiets", { revision: 5 })),
      },
    });
    const user = userEvent.setup();
    const forms = await screen.findByRole("group", { name: /^Forms/ });
    const chips = () =>
      within(forms)
        .getAllByRole("listitem")
        .map((item) => item.textContent);
    expect(chips()).toEqual(["fietsen", ""]);
    await user.click(within(forms).getByRole("button", { name: "Show suggested forms" }));
    expect(chips()).toEqual(["fietsen", "fietsje (suggested)", ""]);

    await user.click(screen.getByRole("button", { name: "Remove op de fiets" }));
    expect(screen.queryByRole("textbox", { name: "Add collocation" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Add collocation" }));
    await user.keyboard("fiets pakken{Enter}{Escape}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Add collocation" }));
    await user.click(within(forms).getByRole("button", { name: "Add form" }));
    await user.keyboard("fietste");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(pathname(app)).toBe("/"));
    expect(app.callsTo("PATCH", "/api/entries/5")[0]!.body).toMatchObject({
      changes: { forms: ["fietsen", "fietste", "fietsje"], collocations: ["fiets pakken"] },
    });
  });

  it("completes a lone stub without a meaning label, retrying an unconfirmed update exactly", async () => {
    let attempts = 0;
    const app = renderApp({
      path: "/entries/7/edit",
      handlers: {
        "POST /api/entries/prepare": () =>
          json({
            term: "wandelen",
            matches: [summary(7, "wandelen", { status: "stub", revision: 3 })],
            inferred: { lemma: "wandelen", partOfSpeech: "VERB" },
          }),
        "GET /api/entries/:id": () => json(detail(7, "wandelen", { status: "stub", revision: 3 })),
        "PATCH /api/entries/:id": () => {
          attempts++;
          if (attempts === 1) throw new TypeError("connection reset");
          return json(detail(7, "wandelen", { revision: 4, extra: "to walk" }));
        },
      },
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Add notes" }));
    expect(screen.queryByLabelText(/^Label for/)).toBeNull();
    await user.type(screen.getByLabelText(/^Notes/), "to walk");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "did not confirm whether “wandelen” was saved",
    );
    await user.click(screen.getByRole("button", { name: "Check again and save" }));
    await screen.findByText(/^Completed/);
    expect(pathname(app)).toBe("/");

    const sent = app.callsTo("PATCH", "/api/entries/7").map((call) => call.body);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0]);
    expect(sent[0]).toEqual({
      mutationId: expect.any(String),
      expectedRevision: 3,
      changes: {
        lemma: "wandelen",
        extra: "to walk",
        examples: [],
        partOfSpeech: "VERB",
        grammar: noGrammar,
        forms: [],
        collocations: [],
        tags: [],
        relatedTokens: [],
      },
    });
    expect(app.callsTo("POST", "/api/entries")).toHaveLength(0);
  });

  it("labels a completed stub beside other meanings and keeps its relations when adding one", async () => {
    const app = renderApp({
      path: "/entries/8/edit",
      handlers: {
        "POST /api/entries/prepare": () =>
          json({
            term: "bank",
            matches: [
              summary(3, "bank", { senseCue: "geld" }),
              summary(8, "bank", { status: "stub", revision: 2 }),
            ],
            inferred: { lemma: "bank" },
          }),
        "GET /api/entries/lookup": () => json([detail(12, "stoel")]),
        "GET /api/entries/:id": () =>
          json({
            ...detail(8, "bank", { status: "stub", revision: 2 }),
            relations: [{ type: "synonym", entry: summary(9, "zetel") }],
          }),
        "PATCH /api/entries/:id": () => json(detail(8, "bank", { senseCue: "meubel" })),
      },
    });
    const user = userEvent.setup();
    const label = await screen.findByLabelText("Label for this meaning");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Enter a meaning label.")).toBeTruthy();
    await user.type(label, "meubel");

    expect(screen.getByLabelText("Related word 1")).toHaveProperty("value", "zetel");
    await user.click(screen.getByRole("button", { name: "Add related word" }));
    await user.type(screen.getByLabelText("Related word 2"), "stoel");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(pathname(app)).toBe("/"));
    expect(app.callsTo("PATCH", "/api/entries/8")[0]!.body).toMatchObject({
      expectedRevision: 2,
      changes: { lemma: "bank", senseCue: "meubel", relatedTokens: ["+id:9", "id:12"] },
    });
  });
});
