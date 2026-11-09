/** HTTP boundary settings, supplied by the composition root. */
export interface HttpOptions {
  version: string;
  apiToken: string;
  allowedHosts: string[];
  corsOrigins: string[];
  webRoot: string | undefined;
  bodyLimitBytes: number;
  requestTimeoutMs: number;
  maxConcurrentRequests: number;
}

export const HTTP_OPTIONS = Symbol("HttpOptions");
