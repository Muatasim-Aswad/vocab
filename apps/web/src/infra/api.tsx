import type { ApiClient } from "@vocab/api-client";
import type { ReactNode } from "react";

import { ApiContext } from "./api-context.ts";

export function ApiProvider({ client, children }: { client: ApiClient; children: ReactNode }) {
  return <ApiContext value={client}>{children}</ApiContext>;
}
