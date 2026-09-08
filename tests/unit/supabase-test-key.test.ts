// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as auth from "../../src/auth";

vi.mock("../../src/auth", () => ({ getSession: vi.fn() }));
vi.mock("../../src/config", () => ({
  config: {
    supabaseUrl: "https://test.supabase.co",
    supabaseAnon: "anon-key",
    parseFunction: "https://test.supabase.co/functions/v1/parse"
  },
  STORAGE_KEYS: { llmKey: "marginalia.llmKey", provider: "marginalia.provider" }
}));

import { testProviderKey } from "../../src/supabase";

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe("testProviderKey nvidia", () => {
  it("posts the real session token (never the anon key) and succeeds", async () => {
    (auth.getSession as any).mockResolvedValue({ access_token: "session-jwt" });
    (globalThis.fetch as any) = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const r = await testProviderKey("nvidia", "");
    expect(r.ok).toBe(true);
    const [url, init] = (fetch as any).mock.calls[0];
    expect(url).toBe("https://test.supabase.co/functions/v1/parse");
    expect(init.headers.Authorization).toBe("Bearer session-jwt");
    expect(init.headers.Authorization).not.toBe("Bearer anon-key");
  });

  it("returns a clear sign-in message when no session exists", async () => {
    (auth.getSession as any).mockResolvedValue(null);
    (globalThis.fetch as any) = vi.fn();
    const r = await testProviderKey("nvidia", "");
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/sign in/i);
    expect(fetch).not.toHaveBeenCalled();
  });
});