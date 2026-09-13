import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

// public/_headers ships a strict Content-Security-Policy with
// `style-src 'self' fonts.googleapis.com` (no 'unsafe-inline'), so any inline
// `style="..."` attribute is silently stripped in production. This is the
// regression guard that keeps the app fully CSP-clean.
const SRC = resolve(__dirname, "../../src");
const ROOT = resolve(__dirname, "../..");

const files: string[] = [];
(function walk(dir: string) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|html)$/.test(entry)) files.push(p);
  }
})(SRC);
files.push(join(ROOT, "index.html"));

describe("no inline styles (CSP style-src self)", () => {
  it("collects the app sources to scan", () => {
    expect(files.length).toBeGreaterThan(0);
  });
  for (const f of files) {
    const rel = f.replace(ROOT + "\\", "").replace(/\//g, "/");
    it(`${rel} has no inline style="" attributes`, () => {
      const src = readFileSync(f, "utf8");
      const hits = src.match(/style\s*=\s*"/g) ?? [];
      expect(hits, `inline style attribute(s) found: ${hits.join(", ")}`).toEqual([]);
    });
  }
});