import { z } from "zod";

import type { MatchEntry } from "./meaning-match-prompt.js";

const modelMatch = z.object({
  decision: z.enum(["same", "new"]),
  entryId: z.int().optional(),
  senseCue: z.string().optional(),
  backfills: z.array(z.object({ id: z.int(), senseCue: z.string() })).optional(),
  reason: z.string().trim().min(1),
});

export type MeaningDecision =
  | { decision: "same"; entryId: number; reason: string }
  | {
      decision: "new";
      senseCue: string;
      backfills: Array<{ id: number; senseCue: string }>;
      reason: string;
    };

type Checked = { ok: true; match: MeaningDecision } | { ok: false; issues: string[] };

const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");

function labelIssue(label: string, term: string): string | undefined {
  const words = label.split(" ").filter(Boolean).length;
  if (words < 1 || words > 2) return "label_word_count";
  if (label === normalize(term)) return "label_is_term";
  return undefined;
}

/**
 * The model's decision when it obeys the rules: "same" names a compared entry; "new" gives a
 * one- or two-word label for the candidate and for exactly the unlabeled entries, all distinct
 * from each other and from the existing labels.
 */
export function checkMeaningMatch(payload: unknown, term: string, entries: MatchEntry[]): Checked {
  const parsed = modelMatch.safeParse(payload);
  if (!parsed.success) return { ok: false, issues: ["shape"] };
  const { decision, entryId, senseCue, backfills = [], reason } = parsed.data;
  const ids = new Set(entries.map((entry) => entry.id));
  if (decision === "same")
    return entryId !== undefined && ids.has(entryId)
      ? { ok: true, match: { decision, entryId, reason: reason.trim() } }
      : { ok: false, issues: ["unknown_entry"] };

  const issues: string[] = [];
  if (senseCue === undefined) return { ok: false, issues: ["missing_label"] };
  const unlabeled = new Set(entries.filter((entry) => !entry.senseCue?.trim()).map((e) => e.id));
  const given = new Map(backfills.map((item) => [item.id, normalize(item.senseCue)]));
  if (given.size !== backfills.length) issues.push("duplicate_backfill");
  for (const id of given.keys()) if (!unlabeled.has(id)) issues.push("backfill_not_unlabeled");
  for (const id of unlabeled) if (!given.has(id)) issues.push("missing_backfill");
  const label = normalize(senseCue);
  const labels = [
    label,
    ...given.values(),
    ...entries.flatMap((entry) => (entry.senseCue?.trim() ? [normalize(entry.senseCue)] : [])),
  ];
  for (const item of [label, ...given.values()]) {
    const issue = labelIssue(item, term);
    if (issue) issues.push(issue);
  }
  if (new Set(labels).size !== labels.length) issues.push("label_not_unique");
  if (issues.length) return { ok: false, issues: [...new Set(issues)] };
  return {
    ok: true,
    match: {
      decision,
      senseCue: label,
      backfills: [...given].map(([id, cue]) => ({ id, senseCue: cue })),
      reason: reason.trim(),
    },
  };
}
