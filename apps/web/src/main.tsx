import "./zod-config.ts";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter } from "react-router-dom";

import "./app/styles.css";
import { App } from "./app/App.tsx";
import { createI18n } from "./app/i18n.ts";
import { appRoutes, createQueryClient } from "./app/routes.tsx";
import { createBrowserApi } from "./infra/api-context.ts";
import { announceBuild } from "./infra/build-info.ts";
import { applyTheme, initialLocale, initialTheme } from "./infra/preferences.ts";

applyTheme(initialTheme());
announceBuild();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App
      api={createBrowserApi()}
      queryClient={createQueryClient()}
      i18n={createI18n(initialLocale())}
      router={createBrowserRouter(appRoutes)}
    />
  </StrictMode>,
);
