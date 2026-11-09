import { Inject, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { parseCookie } from "cookie";
import type { Request, Response } from "express";

import { AppError } from "../../shared/app-error.js";
import { routeContractOf } from "./contract.js";

export interface AuthCapability {
  validBearer(value: string | undefined): boolean;
  validSession(value: string | undefined): boolean;
  allowedOrigin(origin: string | undefined, host: string | undefined): boolean;
  cookieHeader(value: string): string;
}
export const AUTH_CAPABILITY = Symbol("AuthCapability");

export function sessionCookieOf(req: Request): string | undefined {
  const header = req.get("cookie");
  return header ? parseCookie(header).vocab_session : undefined;
}

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(AUTH_CAPABILITY) private readonly auth: AuthCapability,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const route = routeContractOf(this.reflector, context);
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const bearer = this.auth.validBearer(req.get("authorization"));
    if (!route) {
      if (bearer) return true;
      throw new AppError("unauthorized", {
        message: "Authentication required",
        internal: "Route missing contract",
      });
    }
    const cookie = sessionCookieOf(req);
    const session = route.auth === "either" && this.auth.validSession(cookie);
    const mutation = !["GET"].includes(req.method);
    // Login and every cookie-authenticated mutation require a browser Origin.
    if (mutation && (route.path === "/api/auth/login" || (session && !bearer))) {
      if (!this.auth.allowedOrigin(req.get("origin"), req.get("host")))
        throw new AppError("forbidden", { message: "Origin not allowed" });
    }
    if (route.auth === "public") return true;
    if (bearer) return true;
    if (session && cookie) {
      res.setHeader("Set-Cookie", this.auth.cookieHeader(cookie));
      return true;
    }
    throw new AppError("unauthorized", {
      message:
        route.auth === "bearer" ? "Missing or invalid bearer token" : "Authentication required",
    });
  }
}
