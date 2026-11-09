import { useQueryClient } from "@tanstack/react-query";
import { ApiError, ApiNetworkError } from "@vocab/api-client";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { useApi } from "../../infra/api-context.ts";
import {
  SessionContext,
  isUnauthorized,
  type AccessState,
  type LoginResult,
} from "./session-context.ts";

export function SessionProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [state, setState] = useState<AccessState>("checking");
  const [everAuthenticated, setEverAuthenticated] = useState(false);
  const [generation, setGeneration] = useState(0);

  const check = useCallback(
    (signal?: AbortSignal) => {
      api.authState({ signal }).then(
        () => {
          setState("authenticated");
          setEverAuthenticated(true);
        },
        (error: unknown) => {
          if (signal?.aborted) return;
          setState(isUnauthorized(error) ? "required" : "unreachable");
        },
      );
    },
    [api],
  );

  useEffect(() => {
    const controller = new AbortController();
    check(controller.signal);
    return () => controller.abort();
  }, [check]);

  // Any read that fails authorization turns the app into the access-required state.
  useEffect(() => {
    const onError = (error: unknown) => {
      if (isUnauthorized(error)) setState("required");
    };
    const queries = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === "updated" && event.action.type === "error") onError(event.action.error);
    });
    const mutations = queryClient.getMutationCache().subscribe((event) => {
      if (event.type === "updated" && event.action.type === "error") onError(event.action.error);
    });
    return () => {
      queries();
      mutations();
    };
  }, [queryClient]);

  const requireLogin = useCallback(() => setState("required"), []);
  const recheck = useCallback(() => {
    setState("checking");
    check();
  }, [check]);

  const login = useCallback(
    async (token: string): Promise<LoginResult> => {
      try {
        await api.login({ token });
      } catch (error) {
        if (error instanceof ApiError) {
          const reason =
            error.code === "unauthorized" || error.code === "validation_failed"
              ? "invalid"
              : error.code === "forbidden"
                ? "forbidden"
                : "unexpected";
          return { ok: false, reason, requestId: error.requestId };
        }
        return { ok: false, reason: error instanceof ApiNetworkError ? "network" : "unexpected" };
      }
      setState("authenticated");
      setEverAuthenticated(true);
      setGeneration((value) => value + 1);
      // Reads that failed while signed out refetch; cached results stay visible meanwhile.
      void queryClient.invalidateQueries();
      return { ok: true };
    },
    [api, queryClient],
  );

  const logout = useCallback(async () => {
    await api.logout().finally(() => {
      queryClient.clear();
      setState("required");
    });
  }, [api, queryClient]);

  const value = useMemo(
    () => ({ state, everAuthenticated, generation, requireLogin, login, logout, recheck }),
    [state, everAuthenticated, generation, requireLogin, login, logout, recheck],
  );
  return <SessionContext value={value}>{children}</SessionContext>;
}
