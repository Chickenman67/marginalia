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

describe("draft scroll container", () => {
  it("caps .draft-list height with its own scroll", () => {
    expect(css).toMatch(/\.draft-list\s*\{[^}]*max-height:\s*38vh/);
    expect(css).toMatch(/\.draft-list\s*\{[^}]*overflow-y:\s*auto/);
    expect(css).toMatch(/\.draft-list\s*\{[^}]*overscroll-behavior:\s*contain/);
  });
});

describe("draft collapse + mobile", () => {
  it("styles openable group summaries", () => {
    expect(css).toMatch(/\.draft-group\s+summary\s*\{[^}]*cursor:\s*pointer/);
  });
  it("caps the list lower on phones", () => {
    expect(css).toMatch(/@media\s*\(max-width:\s*520px\)[\s\S]*\.draft-list\s*\{[^}]*max-height:\s*30vh/);
  });
});
