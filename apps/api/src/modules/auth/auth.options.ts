export const AUTH_OPTIONS = Symbol("AuthOptions");
export interface AuthOptions {
  apiToken: string;
  cookieSecure: boolean;
  corsOrigins: string[];
  publicOrigin: string | undefined;
}
