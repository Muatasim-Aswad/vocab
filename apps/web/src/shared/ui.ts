import { extendTailwindMerge } from "tailwind-merge";

/**
 * Joins class lists; a later utility replaces an earlier one of the same kind. Text sizes here set
 * no line height, so they never replace a `leading-*`.
 */
export const cn = extendTailwindMerge({
  override: { conflictingClassGroups: { "font-size": [] } },
  extend: {
    theme: {
      text: ["chip", "term-input", "prefix"],
      "font-weight": ["quiet", "chip", "term", "heading"],
      leading: ["heading", "subheading", "term", "entry"],
      tracking: ["heading", "term", "label"],
      container: ["prose", "reading", "help"],
      spacing: ["gutter"],
      shadow: ["menu", "toast"],
    },
  },
});

/** Every button, and links shown as one: a 44px target whose label never breaks mid-word. */
export const control =
  "inline-flex min-h-11 flex-none cursor-pointer items-center justify-center rounded-md border border-transparent px-4 py-2 font-semibold no-underline wrap-normal disabled:cursor-default disabled:opacity-60";

export const button = {
  primary: cn(control, "bg-action text-on-action"),
  secondary: cn(control, "border-control bg-surface text-action"),
  quiet: cn(
    control,
    "px-0 font-medium text-action underline underline-offset-(--underline-offset-link)",
  ),
};

/** A quiet text button at the end of a section header. */
export const smallQuiet = cn(button.quiet, "py-1 text-sm");

export const iconButton = cn(
  control,
  "size-11 rounded-full p-0 text-fg hover:bg-surface hover:text-action aria-expanded:bg-surface aria-expanded:text-action [&_svg]:size-6",
);

/** An icon button inside a field's end, filling its height; its space stays reserved in the field. */
export const fieldIconButton = cn(
  iconButton,
  "absolute inset-y-0 end-0 h-auto rounded-md text-action hover:bg-transparent",
);

/** A list's label row: its name, info icon, and Add icon at the end. */
export const listField = "grid justify-items-start gap-2";

export const listLegend = "flex min-h-11 w-full flex-wrap items-center";

export const addRowButton = cn(iconButton, "ms-auto text-action");

/** A Remove icon, turning to the error color on hover. */
export const removeButton = "text-supporting hover:bg-transparent hover:text-error";

/** Back at the content's start edge, keeping its 44px target. */
export const backButton = cn(iconButton, "-ml-3 justify-self-start");

/** Page sections spaced evenly beneath each other. */
export const pageSections = "[&>*+*]:mt-4";

export const supporting = "text-sm text-supporting";

export const fieldError = "text-sm font-semibold text-error before:content-['!_']";

export const fieldStack = "grid gap-1";
/** A short control beside its label. */
export const inlineField = "flex flex-wrap items-center gap-x-3 gap-y-1";

export const checkLabel = "flex min-h-11 items-center gap-2 font-normal";

export const actions = "flex flex-wrap items-center gap-3";

export const emptyState = "grid justify-items-start gap-3 py-6 text-supporting";

/** A status line that takes no room while empty. */
export const statusLine = cn(supporting, "empty:hidden");

export const chipList = "flex flex-wrap gap-2";

/** A word as a pill: one tap back into it. */
export const chipLink =
  "inline-flex min-h-11 max-w-full items-center rounded-full border border-boundary bg-surface px-4 py-1 text-chip font-chip text-fg no-underline wrap-anywhere hover:border-action";

export const listControls = "flex flex-wrap items-end gap-3 pb-2";

export const loadMore = cn(button.secondary, "mt-4");

/** Rows of results with a rule between them. */
export const result = "border-boundary py-4 [&+&]:border-t";

/** A result whose last child, an action, sits beside its other lines. */
export const resultWithAction =
  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 [&>:not(:last-child)]:col-start-1";

/** A label and its value, as in an entry's details. */
export const factRow = "grid grid-cols-[minmax(7rem,30%)_1fr] gap-4";

/** The vocabulary itself carries the page: large terms, small quiet labels. */
export const resultTerm =
  "text-2xl leading-term font-term tracking-term wrap-anywhere hyphens-auto";

export const entryTerm = cn(resultTerm, "text-4xl leading-entry");

export const termPrefix = "text-prefix font-quiet tracking-normal text-supporting";

/** A relation's icon; its type's name is the tooltip. */
export const relationIcon =
  "flex cursor-help items-center justify-center text-supporting [&_svg]:size-[1.05rem]";

export const senseCue = "text-base font-quiet tracking-normal text-supporting italic";

/** The note closes an entry, kept as written. */
export const entryClosing = "grid justify-items-start gap-2 border-t border-boundary pt-4";

export const entryNote = "max-w-reading whitespace-pre-line";

export const entryTags = "flex flex-wrap gap-x-2 gap-y-1";

export const entryTag = "rounded-full bg-canvas px-2 text-fg";

/** Back at the start, Edit at the end, each keeping its 44px target at the content edge. */
export const pageBar = "flex items-center justify-between [&>:last-child:not(:first-child)]:-mr-3";
