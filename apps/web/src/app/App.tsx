import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import type { ApiClient } from "@vocab/api-client";
import type { i18n } from "i18next";
import { Component, type ReactNode } from "react";
import { I18nextProvider, useTranslation } from "react-i18next";
import { RouterProvider } from "react-router-dom";

import { SessionProvider } from "../features/session/index.ts";
import { VocabularyProvider } from "../features/vocabulary/index.ts";
import { ApiProvider } from "../infra/api.tsx";
import { Notice } from "../shared/Notice.tsx";
import { ToastProvider } from "../shared/toast.tsx";
import { button, pageSections } from "../shared/ui.ts";

interface AppProps {
  api: ApiClient;
  queryClient: QueryClient;
  i18n: i18n;
  router: Parameters<typeof RouterProvider>[0]["router"];
}

export function App({ api, queryClient, i18n, router }: AppProps) {
  return (
    <I18nextProvider i18n={i18n}>
      <CrashBoundary>
        <ApiProvider client={api}>
          <QueryClientProvider client={queryClient}>
            <SessionProvider>
              <ToastProvider>
                <VocabularyProvider>
                  {/* URL-bound controls would revert until a transition commits; routes load nothing. */}
                  <RouterProvider router={router} useTransitions={false} />
                </VocabularyProvider>
              </ToastProvider>
            </SessionProvider>
          </QueryClientProvider>
        </ApiProvider>
      </CrashBoundary>
    </I18nextProvider>
  );
}

class CrashBoundary extends Component<{ children: ReactNode }, { crashed: boolean }> {
  override state = { crashed: false };

  static getDerivedStateFromError() {
    return { crashed: true };
  }

  override render() {
    return this.state.crashed ? <Crashed /> : this.props.children;
  }
}

function Crashed() {
  const { t } = useTranslation();
  return (
    <main id="main" className={pageSections}>
      <Notice tone="error" role="alert">
        <p>{t("app.crashed")}</p>
        <button type="button" className={button.secondary} onClick={() => window.location.reload()}>
          {t("app.reload")}
        </button>
      </Notice>
    </main>
  );
}
