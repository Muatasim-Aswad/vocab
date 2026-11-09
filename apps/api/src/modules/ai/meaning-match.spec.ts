import { describe, expect, it } from "vite-plus/test";

import type { MatchEntry } from "./meaning-match-prompt.js";
import { checkMeaningMatch } from "./meaning-match.js";

const entries: MatchEntry[] = [
  { id: 3, status: "active", senseCue: "money", extra: "financial institution" },
  { id: 4, status: "active", extra: "long seat" },
  { id: 5, status: "stub", relations: [{ type: "related", term: "zitten" }] },
];

function issues(payload: object) {
  const checked = checkMeaningMatch({ decision: "new", reason: "x", ...payload }, "bank", [
    ...entries,
  ]);
  return checked.ok ? [] : checked.issues;
}

describe("checkMeaningMatch", () => {
  it("accepts a same decision only for a compared entry", () => {
    expect(
      checkMeaningMatch(
        { decision: "same", entryId: 4, reason: " Both a seat. " },
        "bank",
        entries,
      ),
    ).toEqual({ ok: true, match: { decision: "same", entryId: 4, reason: "Both a seat." } });
    expect(
      checkMeaningMatch({ decision: "same", entryId: 9, reason: "x" }, "bank", entries),
    ).toEqual({ ok: false, issues: ["unknown_entry"] });
    expect(checkMeaningMatch({ decision: "same", reason: "x" }, "bank", entries).ok).toBe(false);
  });

  it("normalizes the labels of a new meaning and requires one for every unlabeled entry", () => {
    expect(
      checkMeaningMatch(
        {
          decision: "new",
          senseCue: " Sand  Bank ",
          backfills: [
            { id: 4, senseCue: "Seat" },
            { id: 5, senseCue: "furniture" },
          ],
          reason: "A sandbank.",
        },
        "bank",
        entries,
      ),
    ).toEqual({
      ok: true,
      match: {
        decision: "new",
        senseCue: "sand bank",
        backfills: [
          { id: 4, senseCue: "seat" },
          { id: 5, senseCue: "furniture" },
        ],
        reason: "A sandbank.",
      },
    });
  });

  it("refuses labels that break the rules", () => {
    const both = [
      { id: 4, senseCue: "seat" },
      { id: 5, senseCue: "furniture" },
    ];
    expect(issues({ backfills: both })).toEqual(["missing_label"]);
    expect(issues({ senseCue: "river", backfills: [both[0]] })).toEqual(["missing_backfill"]);
    expect(
      issues({ senseCue: "river", backfills: [...both, { id: 3, senseCue: "cash" }] }),
    ).toEqual(["backfill_not_unlabeled"]);
    expect(issues({ senseCue: "the river side", backfills: both })).toEqual(["label_word_count"]);
    expect(issues({ senseCue: "Bank", backfills: both })).toEqual(["label_is_term"]);
    expect(issues({ senseCue: "Money", backfills: both })).toEqual(["label_not_unique"]);
    expect(
      issues({
        senseCue: "river",
        backfills: [
          { id: 4, senseCue: "seat" },
          { id: 5, senseCue: "seat" },
        ],
      }),
    ).toEqual(["label_not_unique"]);
    expect(issues({ senseCue: 3 })).toEqual(["shape"]);
  });
});
