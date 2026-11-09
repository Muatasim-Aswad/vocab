import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  apiError,
  json,
  page,
  renderApp,
  summary,
  type FakeRequest,
} from "../../../test/test-app.tsx";

afterEach(cleanup);

const cards = () =>
  within(screen.getByRole("list"))
    .getAllByRole("listitem")
    .map((item) => within(item).getAllByRole("link")[0]!.textContent);

describe("Entries", () => {
  it("lists entries as result cards, ordered and filtered through the URL, with Load more", async () => {
    const app = renderApp({
      path: "/entries?order=modified",
      handlers: {
        "GET /api/entries": (request: FakeRequest) => {
          const order = request.query.get("order");
          if (request.query.get("typeFilter") === "verb")
            return apiError(404, "not_found", "No words");
          if (request.query.get("cursor"))
            return json({ ...page([summary(1, "appel")]), total: 3 });
          const items =
            order === "alphabetical"
              ? [summary(1, "appel"), summary(3, "bank", { article: "de", senseCue: "money" })]
              : [summary(3, "bank", { article: "de", senseCue: "money" }), summary(2, "lopen")];
          return json({ ...page(items, "next"), total: 3 });
        },
      },
    });
    const user = userEvent.setup();

    await waitFor(() => expect(cards()).toEqual(["de bank money", "lopen"]));
    expect(screen.getByRole("heading", { level: 1, name: "All entries" })).toBeTruthy();
    expect(screen.getByText("3 entries")).toBeTruthy();
    expect(screen.getByRole("link", { name: "de bank money" }).getAttribute("href")).toBe(
      "/entries/3",
    );
    expect(screen.getByLabelText<HTMLSelectElement>("Order").value).toBe("modified");

    await user.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(cards()).toEqual(["de bank money", "lopen", "appel"]));

    await user.selectOptions(screen.getByLabelText("Order"), "alphabetical");
    expect(app.router.state.location.search).toBe("?order=alphabetical");
    await waitFor(() => expect(cards()).toEqual(["appel", "de bank money"]));

    await user.selectOptions(screen.getByRole("combobox", { name: "Type" }), "verb");
    expect(app.router.state.location.search).toBe("?order=alphabetical&type=verb");
    expect(await screen.findByText("No entries of this type.")).toBeTruthy();
    expect(app.callsTo("GET", "/api/entries").at(-1)!.query.get("typeFilter")).toBe("verb");
  });
});
