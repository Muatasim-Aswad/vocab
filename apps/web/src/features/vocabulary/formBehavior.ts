import { useEffect, type KeyboardEvent } from "react";

import type { DraftState } from "./store.ts";

/** Only the term field submits with Enter; other single-line rows keep Enter for themselves. */
export function keepEnterInRows(event: KeyboardEvent<HTMLFormElement>) {
  const target = event.target;
  if (
    event.key === "Enter" &&
    target instanceof HTMLElement &&
    target.hasAttribute("data-no-submit")
  )
    event.preventDefault();
}

/** Moves focus to the field the draft asks for, by its `add-` element ID. */
export function useDraftFocus(focus: DraftState["focus"]) {
  useEffect(() => {
    if (focus) document.getElementById(`add-${focus.id}`)?.focus();
  }, [focus]);
}
