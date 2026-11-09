import { ApiError } from "@vocab/api-client";
import { createContext, use } from "react";

export type AccessState = "checking" | "authenticated" | "required" | "unreachable";

export type LoginResult =
  | { ok: true }
  | { ok: false; reason: "invalid" | "forbidden" | "network" | "unexpected"; requestId?: string };

export interface Session {
  state: AccessState;
  /** True once this page has been authenticated; later access loss keeps the app mounted. */
  everAuthenticated: boolean;
  /** Increments on each successful login, so pending work can reconcile afterwards. */
  generation: number;
  requireLogin: () => void;
  login: (token: string) => Promise<LoginResult>;
  logout: () => Promise<void>;
  recheck: () => void;
}

export const SessionContext = createContext<Session | null>(null);

export const isUnauthorized = (error: unknown) =>
  error instanceof ApiError && error.code === "unauthorized";

export function useSession(): Session {
  const session = use(SessionContext);
  if (!session) throw new Error("useSession requires SessionProvider");
  return session;
}
