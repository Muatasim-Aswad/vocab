import { createApiClient, type ApiClient } from "@vocab/api-client";
import { createContext, use } from "react";

export const ApiContext = createContext<ApiClient | null>(null);

/** Same-origin API: served by the API in production, proxied by the dev server. */
export function createBrowserApi(): ApiClient {
  return createApiClient({ credentials: "same-origin" });
}

export function useApi(): ApiClient {
  const client = use(ApiContext);
  if (!client) throw new Error("useApi requires ApiProvider");
  return client;
}
