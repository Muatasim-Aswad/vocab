import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { z } from "zod";

import { uuidV7 } from "../../src/shared/uuid.ts";
import { e2eToken } from "./fixtures.ts";

export const baseUrl = () => process.env.E2E_BASE_URL!;

/** Token-once browser login through the real sign-in form. */
export async function signIn(page: Page, token = e2eToken, url = baseUrl()) {
  await page.goto(url);
  await page.getByLabel("Access token").fill(token);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Search vocabulary" })).toBeVisible();
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

/** Direct API reads for verifying persisted state, independent of the browser session. */
export async function lookup(
  request: APIRequestContext,
  term: string,
  { url = baseUrl(), token = e2eToken } = {},
) {
  const response = await request.get(`${url}/api/entries/lookup?term=${encodeURIComponent(term)}`, {
    headers: bearer(token),
  });
  expect(response.status()).toBe(200);
  return z
    .array(
      z.object({
        entry: z
          .object({
            id: z.number(),
            revision: z.number(),
            lemma: z.string(),
            senseCue: z.string().optional(),
          })
          .passthrough(),
        relations: z.array(
          z.object({
            type: z.string(),
            entry: z
              .object({ id: z.number(), lemma: z.string(), status: z.string().optional() })
              .passthrough(),
          }),
        ),
      }),
    )
    .parse(await response.json());
}

export async function updateSenseCue(
  request: APIRequestContext,
  id: number,
  expectedRevision: number,
  senseCue: string,
) {
  const response = await request.patch(`${baseUrl()}/api/entries/${id}`, {
    headers: bearer(e2eToken),
    data: { mutationId: uuidV7(), expectedRevision, changes: { senseCue } },
  });
  expect(response.status()).toBe(200);
}

/** A result card's headword link, apart from related-word links to the same entry. */
export const resultLink = (page: Page, lemma: string) =>
  page
    .getByRole("link")
    .filter({ has: page.getByTestId("term") })
    .filter({ hasText: new RegExp(`^${lemma}$`) });
