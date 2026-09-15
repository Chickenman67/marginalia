// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, "../../src/style.css"), "utf8");

describe("draft actions row", () => {
  it("lays .draft-actions out as a flex row", () => {
    expect(css).toMatch(/\.draft-actions\s*\{[^}]*display:\s*flex/);
  });
  it("stops forcing #addAll to 100% width", () => {
    expect(css).not.toMatch(/#draft\s+#addAll\s*\{[^}]*width:\s*100%/);
  });
});
