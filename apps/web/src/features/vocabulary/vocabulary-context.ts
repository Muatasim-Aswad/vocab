import { createContext, use, useSyncExternalStore } from "react";

import type {
  DraftState,
  DraftStore,
  StoreDeps,
  VocabularyState,
  VocabularyStore,
} from "./store.ts";

export const StoreContext = createContext<{ store: VocabularyStore; deps: StoreDeps } | null>(null);

export function useVocabularyStore() {
  const value = use(StoreContext);
  if (!value) throw new Error("Vocabulary hooks require VocabularyProvider");
  return value;
}

/** Subscribes to one slice of the store; selectors must return stored references or primitives. */
export function useVocabulary<T>(selector: (state: VocabularyState) => T): T {
  const { store } = useVocabularyStore();
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()));
}

export const DraftContext = createContext<DraftStore | null>(null);

export function useDraftStore() {
  const draft = use(DraftContext);
  const { deps } = useVocabularyStore();
  if (!draft) throw new Error("Draft hooks require DraftScope");
  return { store: draft, deps };
}

/** Subscribes to one slice of the scoped draft; selectors must return stored references or primitives. */
export function useDraft<T>(selector: (state: DraftState) => T): T {
  const { store } = useDraftStore();
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()));
}
