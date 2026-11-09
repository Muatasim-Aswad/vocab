import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { useApi } from "../../infra/api-context.ts";
import { useToast } from "../../shared/toast-context.ts";
import { useSession } from "../session/index.ts";
import { captureKeys } from "./captures.ts";
import { headword } from "./display-model.ts";
import { entryKeys } from "./queries.ts";
import { VocabularyStore, type StoreDeps } from "./store.ts";
import { DraftContext, StoreContext, useVocabularyStore } from "./vocabulary-context.ts";

export function VocabularyProvider({
  children,
  store,
}: {
  children: ReactNode;
  store?: VocabularyStore;
}) {
  const [instance] = useState(() => store ?? new VocabularyStore());
  const api = useApi();
  const queryClient = useQueryClient();
  const { requireLogin, generation } = useSession();
  const { i18n } = useTranslation();
  const toast = useToast();
  const deps = useMemo<StoreDeps>(
    () => ({
      api,
      onUnauthorized: requireLogin,
      onSaved: ({ saved, savedAs, captureKept }) => {
        void queryClient.invalidateQueries({ queryKey: entryKeys.all });
        void queryClient.invalidateQueries({ queryKey: captureKeys.all });
        toast(
          i18n.t(`vocab.add.${savedAs}`, { term: headword(saved.entry) }),
          captureKept ? i18n.t("vocab.add.captureKept", { term: captureKept }) : undefined,
        );
      },
    }),
    [api, queryClient, requireLogin, i18n, toast],
  );

  // After each login, an unresolved save is retried with its original identity.
  useEffect(() => {
    if (generation > 0) void instance.reconcile(deps);
  }, [generation, instance, deps]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (instance.hasUnsavedWork) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [instance]);

  const value = useMemo(() => ({ store: instance, deps }), [instance, deps]);
  return <StoreContext value={value}>{children}</StoreContext>;
}

/** Gives the form fields below it the Add or the Edit draft. */
export function DraftScope({ kind, children }: { kind: "add" | "edit"; children: ReactNode }) {
  const { store } = useVocabularyStore();
  return <DraftContext value={store[kind]}>{children}</DraftContext>;
}
