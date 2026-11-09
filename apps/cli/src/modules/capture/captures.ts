import { parseListArgs } from "../../platform/args.ts";
import type { AppContext } from "../../platform/context.ts";
import { s } from "../../platform/terminal.ts";
import { captureCopy } from "./copy.ts";

/** Fast mode: one request saves the term for later review, with no preparation or prompts. */
export async function handleCapture(ctx: AppContext, input: string): Promise<void> {
  const { view } = ctx.io;
  const term = input.trim();
  if (!term) {
    view(captureCopy.enterTerm);
    return;
  }
  const saved = await ctx.api.createCapture(term);
  view(captureCopy.saved(s.aH("✓"), saved.term));
  view(captureCopy.review(s.aH("captures")));
}

export async function handleCaptures(ctx: AppContext, args: string): Promise<void> {
  const { view } = ctx.io;
  const parsed = parseListArgs(args);
  for (const warning of parsed.warnings) view(s.w(warning));
  if (parsed.value.typeFilter !== undefined || parsed.value.showExtra)
    view(s.w(captureCopy.ignoredFlags));
  if (parsed.errors.length > 0) {
    for (const error of parsed.errors) view(s.e(error));
    return;
  }
  const { cursor, limit } = parsed.value;
  const page = await ctx.api.capturePage(cursor, limit);
  if (page.captures.length === 0) {
    view(captureCopy.empty);
    return;
  }
  const from = page.startIndex + 1;
  const to = page.startIndex + page.captures.length;
  view(s.alert(captureCopy.heading(page.page, from, to)));
  page.captures.forEach((capture, index) =>
    view(
      captureCopy.row(from + index, s.aH(capture.term), s.white(capture.createdAt.slice(0, 10))),
    ),
  );
  view(page.hasMore ? captureCopy.more(page.page, limit) : captureCopy.end(from, to));
}
