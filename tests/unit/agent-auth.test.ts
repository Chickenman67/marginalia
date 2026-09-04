import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import keytar from "keytar";

const SERVICE = "todoapp-agent-test";
const EMAIL = "vitest-agent@example.invalid";
const PASSWORD = "vitest-password-1234";
const PROJECT_REF = "PROJECT_REF";

beforeAll(async () => {
  await keytar.deletePassword(SERVICE, EMAIL).catch(() => {});
});

afterAll(async () => {
  await keytar.deletePassword(SERVICE, EMAIL).catch(() => {});
});

describe("agent auth: keychain round-trip", () => {
  it("writes and reads a credential under the test service", async () => {
    await keytar.setPassword(SERVICE, EMAIL, PASSWORD);
    const back = await keytar.getPassword(SERVICE, EMAIL);
    expect(back).toBe(PASSWORD);
  });

  it("findCredentials returns the test credential", async () => {
    const creds = await keytar.findCredentials(SERVICE);
    expect(creds.find((c) => c.account === EMAIL)?.password).toBe(PASSWORD);
  });
});

describe("agent auth: storage-state shape", () => {
  it("rejects a missing storage file", async () => {
    const bogus = path.join(os.tmpdir(), `todoapp-agent-${Date.now()}.json`);
    await expect(fs.access(bogus)).rejects.toBeDefined();
  });

  it("recognises a Playwright storage state containing sb-...-auth-token", async () => {
    const tmp = path.join(os.tmpdir(), `todoapp-agent-${Date.now()}.json`);
    const sample = {
      cookies: [],
      origins: [
        {
          origin: "http://localhost:5173",
          localStorage: [
            {
              name: `sb-${PROJECT_REF}-auth-token`,
              value: JSON.stringify({
                access_token: "fake-access",
                refresh_token: "fake-refresh",
                expires_at: Math.floor(Date.now() / 1000) + 3600,
                token_type: "bearer",
                user: { id: "u", email: "x@y.z" }
              })
            }
          ]
        }
      ]
    };
    await fs.writeFile(tmp, JSON.stringify(sample));
    const raw = JSON.parse(await fs.readFile(tmp, "utf8"));
    const entry = raw.origins[0].localStorage[0];
    expect(entry.name.startsWith("sb-")).toBe(true);
    expect(entry.name.endsWith("-auth-token")).toBe(true);
    const parsed = JSON.parse(entry.value);
    expect(parsed.access_token).toBeTruthy();
    expect(parsed.refresh_token).toBeTruthy();
    expect(parsed.expires_at).toBeGreaterThan(0);
    await fs.unlink(tmp);
  });
});

describe("agent auth: refresh deletes pre-existing storage file", () => {
  it("calls fs.unlink once with the storage path before writing a new one", async () => {
    vi.resetModules();
    const unlink = vi.fn().mockResolvedValue(undefined);
    vi.doMock("node:fs", () => ({
      promises: {
        unlink,
        mkdir: vi.fn().mockResolvedValue(undefined),
        writeFile: vi.fn().mockResolvedValue(undefined),
        readFile: vi.fn().mockResolvedValue("{}")
      }
    }));
    vi.doMock("playwright", () => ({
      chromium: {
        launch: vi.fn().mockRejectedValue(new Error("refresh test: chromium launch intentionally short-circuited"))
      }
    }));
    vi.doMock("keytar", () => ({
      default: {
        findCredentials: vi.fn().mockResolvedValue([
          { account: EMAIL, password: PASSWORD }
        ])
      }
    }));

    const STORAGE = path.join(os.homedir(), ".config", "opencode", "todoapp-agent-storage.json");
    try {
      await import("../../scripts/agent-refresh.mjs");
    } catch {
      // expected — the chromium launch mock rejects to skip the login flow
    }

    expect(unlink).toHaveBeenCalledTimes(1);
    expect(unlink).toHaveBeenCalledWith(STORAGE);

    vi.doUnmock("node:fs");
    vi.doUnmock("playwright");
    vi.doUnmock("keytar");
    vi.resetModules();
  });
});
