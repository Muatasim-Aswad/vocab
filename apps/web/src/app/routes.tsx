import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "@vocab/api-client";
import type { RouteObject } from "react-router-dom";

import {
  AddPage,
  CapturesPage,
  EditPage,
  EntriesPage,
  EntryPage,
  SearchHistoryPage,
  SearchPage,
} from "../features/vocabulary/index.ts";
import { NotFoundPage, Shell } from "./Shell.tsx";
import { VersionPage } from "./VersionPage.tsx";

export const appRoutes: RouteObject[] = [
  {
    element: <Shell />,
    children: [
      { index: true, element: <SearchPage /> },
      { path: "add", element: <AddPage /> },
      { path: "captures", element: <CapturesPage /> },
      { path: "entries", element: <EntriesPage /> },
      { path: "entries/:id", element: <EntryPage /> },
      { path: "entries/:id/edit", element: <EditPage /> },
      { path: "search-history", element: <SearchHistoryPage /> },
      { path: "version", element: <VersionPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Contract errors below 500 are final; network and server failures retry twice.
        retry: (failures, error) =>
          failures < 2 && !(error instanceof ApiError && error.status < 500),
        staleTime: 60_000,
        gcTime: 30 * 60_000,
        refetchOnWindowFocus: false,
      },
    },
  });
}
