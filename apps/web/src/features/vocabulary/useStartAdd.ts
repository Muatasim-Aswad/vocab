import { useCallback } from "react";
import { useNavigate } from "react-router-dom";

import { isDraftEmpty } from "./draft.ts";
import type { CaptureLink } from "./store.ts";
import { useVocabularyStore } from "./vocabulary-context.ts";
import { pendingWrite } from "./workflow/state.ts";

/**
 * Opens Add for `term`, asking AI for suggestions when `withAi`; a different unsaved draft is never
 * replaced without asking.
 */
export function useStartAdd() {
  const navigate = useNavigate();
  const { store } = useVocabularyStore();
  return useCallback(
    (
      term: string,
      { capture, withAi = false }: { capture?: CaptureLink; withAi?: boolean } = {},
    ) => {
      const state = store.add.getState();
      const { draft } = state;
      const pending = pendingWrite(state);
      const empty = isDraftEmpty(draft);
      if (!pending && (empty || draft.term.trim() === term)) {
        if (empty) store.add.startWithTerm(term, capture, withAi);
        else {
          if (capture) store.add.linkCapture(capture);
          if (withAi) store.add.askAi();
        }
        void navigate("/add");
      } else {
        void navigate("/add", {
          state: {
            proposedTerm: term,
            ...(capture && { proposedCapture: capture }),
            ...(withAi && { proposedAi: true }),
          },
        });
      }
    },
    [navigate, store],
  );
}
