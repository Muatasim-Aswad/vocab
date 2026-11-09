import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import { stringifySetCookie } from "cookie";
import { eq } from "drizzle-orm";

import { Database } from "../../infra/db/database.js";
import { AppError } from "../../shared/app-error.js";
import { AUTH_OPTIONS, type AuthOptions } from "./auth.options.js";
import { authSessionsTable } from "./auth.schema.js";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const equal = (left: string, right: string) =>
  timingSafeEqual(Buffer.from(hash(left), "hex"), Buffer.from(hash(right), "hex"));

@Injectable()
export class AuthService {
  private readonly tokenFingerprint: string;

  constructor(
    private readonly database: Database,
    @Inject(AUTH_OPTIONS) private readonly options: AuthOptions,
  ) {
    this.tokenFingerprint = hash(options.apiToken);
    // Any change, including A -> B -> A, permanently revokes prior generations.
    if (
      this.database.sqlite
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'auth_sessions'")
        .get()
    ) {
      this.database.sqlite
        .prepare(
          "UPDATE auth_sessions SET revoked_at = ? WHERE revoked_at IS NULL AND token_fingerprint <> ?",
        )
        .run(new Date().toISOString(), this.tokenFingerprint);
    }
  }

  validBearer(value: string | undefined): boolean {
    const token = value && /^Bearer ([\x21-\x7E]+)$/i.exec(value)?.[1];
    return token !== undefined && equal(token, this.options.apiToken);
  }

  cookieHeader(value: string, maxAge = 2_592_000): string {
    return stringifySetCookie({
      name: "vocab_session",
      value,
      path: "/api",
      httpOnly: true,
      sameSite: "strict",
      secure: this.options.cookieSecure,
      maxAge,
    });
  }

  allowedOrigin(origin: string | undefined, host: string | undefined): boolean {
    if (!origin || !host) return false;
    const sameOrigin =
      this.options.publicOrigin ?? `${this.options.cookieSecure ? "https" : "http"}://${host}`;
    return origin === sameOrigin || this.options.corsOrigins.includes(origin);
  }

  login(token: string): string {
    if (!equal(token, this.options.apiToken))
      throw new AppError("unauthorized", { message: "Invalid token" });
    const id = randomBytes(16).toString("hex");
    const secret = randomBytes(32).toString("base64url");
    this.database.orm
      .insert(authSessionsTable)
      .values({
        id,
        secretHash: hash(secret),
        tokenFingerprint: this.tokenFingerprint,
        createdAt: new Date().toISOString(),
      })
      .run();
    return `${id}.${secret}`;
  }

  validSession(cookie: string | undefined): boolean {
    if (!cookie) return false;
    const match = /^([0-9a-f]{32})\.([A-Za-z0-9_-]{43})$/.exec(cookie);
    if (!match) return false;
    const row = this.database.orm
      .select()
      .from(authSessionsTable)
      .where(eq(authSessionsTable.id, match[1]!))
      .get();
    return (
      !!row &&
      row.revokedAt === null &&
      row.tokenFingerprint === this.tokenFingerprint &&
      timingSafeEqual(Buffer.from(hash(match[2]!), "hex"), Buffer.from(row.secretHash, "hex"))
    );
  }

  revoke(cookie: string | undefined): void {
    if (!cookie || !this.validSession(cookie)) return;
    const id = cookie.slice(0, 32);
    this.database.orm
      .update(authSessionsTable)
      .set({ revokedAt: new Date().toISOString() })
      .where(eq(authSessionsTable.id, id))
      .run();
  }
}
