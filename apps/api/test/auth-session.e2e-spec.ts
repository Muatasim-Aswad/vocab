import { routes } from "@vocab/contracts";
import request from "supertest";
import { describe, expect, it } from "vite-plus/test";

import { createTestApp, tempDir, testConfig, testToken } from "./support.js";

const browser = (server: Parameters<typeof request>[0]) => request(server);
const origin = (call: request.Test) =>
  call.set("Host", "127.0.0.1").set("Origin", "http://127.0.0.1");
function cookieOf(response: request.Response): string {
  const cookie = response.headers["set-cookie"]?.[0];
  if (!cookie) throw new Error("Expected session cookie");
  return cookie;
}

describe("browser and CLI authentication", () => {
  it.each([
    {
      name: "loopback access to a container",
      env: { VOCAB_BIND: "0.0.0.0", VOCAB_HOSTS: "127.0.0.1,localhost", VOCAB_PUBLIC_ORIGIN: "" },
      host: "127.0.0.1:3000",
      origin: "http://127.0.0.1:3000",
      secure: false,
    },
    {
      name: "HTTPS proxy to a loopback listener",
      env: {
        VOCAB_BIND: "127.0.0.1",
        VOCAB_HOSTS: "127.0.0.1,localhost",
        VOCAB_PUBLIC_ORIGIN: "https://vocab.example",
      },
      host: "127.0.0.1:3000",
      origin: "https://vocab.example",
      secure: true,
    },
    {
      name: "non-loopback HTTPS access",
      env: { VOCAB_BIND: "0.0.0.0", VOCAB_HOSTS: "vocab.example", VOCAB_PUBLIC_ORIGIN: "" },
      host: "vocab.example",
      origin: "https://vocab.example",
      secure: true,
    },
  ])(
    "uses the browser access settings for $name",
    async ({ env, host, origin: browserOrigin, secure }) => {
      const dir = tempDir();
      const { app } = await createTestApp(testConfig(dir.dir, { env }));
      try {
        const response = await browser(app.getHttpServer())
          .post(routes.login.path)
          .set("Host", host)
          .set("Origin", browserOrigin)
          .send({ token: testToken })
          .expect(200);
        expect(cookieOf(response).split("; ").includes("Secure")).toBe(secure);
      } finally {
        await app.close();
        dir.cleanup();
      }
    },
  );

  it("compatibility: auth:cli — accepts bearer tokens without cookies", async () => {
    const dir = tempDir();
    const { app } = await createTestApp(testConfig(dir.dir));
    try {
      await browser(app.getHttpServer())
        .get(routes.authState.path)
        .set("Authorization", `Bearer ${testToken}`)
        .expect(200);
      await browser(app.getHttpServer()).get(routes.authState.path).expect(401);
    } finally {
      await app.close();
      dir.cleanup();
    }
  });

  it("compatibility: auth:web — exchanges a token for an opaque HttpOnly cookie", async () => {
    const dir = tempDir();
    const { app } = await createTestApp(testConfig(dir.dir));
    try {
      const response = await origin(browser(app.getHttpServer()).post(routes.login.path))
        .send({ token: testToken })
        .expect(200);
      const cookie = cookieOf(response);
      expect(cookie).toMatch(/^vocab_session=[^;]+;/);
      for (const attribute of ["Path=/api", "HttpOnly", "SameSite=Strict", "Max-Age=2592000"])
        expect(cookie).toContain(attribute);
      expect(cookie).not.toContain(testToken);
      await browser(app.getHttpServer())
        .get(routes.authState.path)
        .set("Cookie", cookie)
        .expect(200);
    } finally {
      await app.close();
      dir.cleanup();
    }
  });

  it("compatibility: auth:revoke — logout, restart and A-B-A rotation cannot resurrect sessions", async () => {
    const dir = tempDir();
    let config = testConfig(dir.dir);
    let { app } = await createTestApp(config);
    try {
      const first = await origin(browser(app.getHttpServer()).post(routes.login.path))
        .send({ token: testToken })
        .expect(200);
      const cookie = cookieOf(first);
      await app.close();
      ({ app } = await createTestApp(config));
      await browser(app.getHttpServer())
        .get(routes.authState.path)
        .set("Cookie", cookie)
        .expect(200);
      await origin(
        browser(app.getHttpServer()).post(routes.logout.path).set("Cookie", cookie),
      ).expect(200);
      await browser(app.getHttpServer())
        .get(routes.authState.path)
        .set("Cookie", cookie)
        .expect(401);
      const second = await origin(browser(app.getHttpServer()).post(routes.login.path))
        .send({ token: testToken })
        .expect(200);
      const newer = cookieOf(second);
      await app.close();
      config = testConfig(dir.dir, {
        env: { VOCAB_API_TOKEN: "different-token-0123456789abcdef01234567" },
      });
      ({ app } = await createTestApp(config));
      await browser(app.getHttpServer())
        .get(routes.authState.path)
        .set("Cookie", newer)
        .expect(401);
      await app.close();
      config = testConfig(dir.dir);
      ({ app } = await createTestApp(config));
      await browser(app.getHttpServer())
        .get(routes.authState.path)
        .set("Cookie", newer)
        .expect(401);
    } finally {
      await app.close();
      dir.cleanup();
    }
  });

  it("compatibility: auth:renew — authenticated use renews a persistent cookie", async () => {
    const dir = tempDir();
    const { app } = await createTestApp(testConfig(dir.dir));
    try {
      const login = await origin(browser(app.getHttpServer()).post(routes.login.path))
        .send({ token: testToken })
        .expect(200);
      const cookie = cookieOf(login);
      const state = await browser(app.getHttpServer())
        .get(routes.authState.path)
        .set("Cookie", cookie)
        .expect(200);
      expect(state.headers["set-cookie"]?.[0]).toContain("Max-Age=2592000");
    } finally {
      await app.close();
      dir.cleanup();
    }
  });

  it("compatibility: auth:csrf — rejects absent and foreign origins on cookie mutations and login", async () => {
    const dir = tempDir();
    const { app } = await createTestApp(testConfig(dir.dir));
    try {
      await browser(app.getHttpServer())
        .post(routes.login.path)
        .send({ token: testToken })
        .expect(403);
      await browser(app.getHttpServer())
        .post(routes.login.path)
        .set("Origin", "https://evil.example")
        .send({ token: testToken })
        .expect(403);
      const login = await origin(browser(app.getHttpServer()).post(routes.login.path))
        .send({ token: testToken })
        .expect(200);
      const cookie = cookieOf(login);
      await browser(app.getHttpServer()).post(routes.logout.path).set("Cookie", cookie).expect(403);
      await browser(app.getHttpServer())
        .post(routes.logout.path)
        .set("Cookie", cookie)
        .set("Origin", "https://evil.example")
        .expect(403);
      await browser(app.getHttpServer())
        .get(routes.authState.path)
        .set("Cookie", cookie)
        .expect(200);
    } finally {
      await app.close();
      dir.cleanup();
    }
  });
});
