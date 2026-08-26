import { describe, it, expect } from "vitest";
import { genTokenPair, combineToken, splitToken, isLegacyToken } from "../../src/store";

describe("space token generation", () => {
  it("generates 128-bit id and secret with no space- prefix", () => {
    const { id, secret } = genTokenPair();
    expect(id.startsWith("space-")).toBe(false);
    expect(secret.startsWith("space-")).toBe(false);
    // base64url of 16 bytes = 22 chars
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(secret).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(id).not.toEqual(secret);
  });

  it("combine/split round-trips and split is unambiguous (no dot in id)", () => {
    const { id, secret } = genTokenPair();
    const combined = combineToken(id, secret);
    expect(combined).toBe(`${id}.${secret}`);
    const back = splitToken(combined);
    expect(back.id).toBe(id);
    expect(back.secret).toBe(secret);
  });

  it("detects legacy tokens", () => {
    expect(isLegacyToken("space-abc123")).toBe(true);
    const { id, secret } = genTokenPair();
    expect(isLegacyToken(combineToken(id, secret))).toBe(false);
  });

  it("two generated pairs are unique", () => {
    const a = combineToken(...Object.values(genTokenPair()) as [string, string]);
    const b = combineToken(...Object.values(genTokenPair()) as [string, string]);
    expect(a).not.toEqual(b);
  });
});
