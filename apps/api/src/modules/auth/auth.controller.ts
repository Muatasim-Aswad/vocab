import { Body, Controller, Req, Res } from "@nestjs/common";
import { routes } from "@vocab/contracts";
import type { Request, Response } from "express";
import type { z } from "zod";

import { Contract } from "../../platform/http/contract.js";
import { sessionCookieOf } from "../../platform/http/session-auth.guard.js";
import { AuthService } from "./auth.service.js";

@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Contract(routes.login)
  login(
    @Body() body: z.output<typeof routes.login.body>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = this.auth.login(body.token);
    res.setHeader("Set-Cookie", this.auth.cookieHeader(session));
    return { authenticated: true };
  }

  @Contract(routes.logout)
  logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.auth.revoke(sessionCookieOf(req));
    res.setHeader("Set-Cookie", this.auth.cookieHeader("", 0));
    return { authenticated: false };
  }

  @Contract(routes.authState)
  state() {
    return { authenticated: true };
  }
}
