import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const css = readFileSync(resolve(__dirname, "../../src/style.css"), "utf8");

describe("mobile CSS — writing bar", () => {
  it("slims the mic to 42px inside a 520px breakpoint", () => {
    expect(css).toMatch(/\.bar\s+\.mic\s*,\s*\.dictate-bar\s+\.mic\s*\{[^}]*width:\s*42px[^}]*height:\s*42px/);
  });
  it("reduces .bar input padding to 10px 12px (radius 11px)", () => {
    expect(css).toContain(".bar input { padding: 10px 12px; border-radius: 11px; }");
  });
  it("tightens #quickAdd padding", () => {
    expect(css).toContain("#quickAdd { padding: 10px 13px; }");
  });
});

describe("mobile CSS — title clamp", () => {
  it("clamps mobile titles to 4 lines, including todo cards", () => {
    const rule = css.match(/\.card\s+\.title\s*,\s*\.card\.todo\s+\.title\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(rule, "expected a .card .title, .card.todo .title rule").toBeTruthy();
    expect(rule).toMatch(/-webkit-line-clamp:\s*4/);
    expect(rule).toMatch(/white-space:\s*normal/);
  });
  it("un-clamps .expanded titles", () => {
    expect(css).toMatch(/\.card\.expanded\s+\.title\s*\{[^}]*-webkit-line-clamp:\s*unset/);
  });
});

describe("coarse-pointer scroll collapse", () => {
  it("hides the dock-head and hint when body.dock-min", () => {
    expect(css).toMatch(/body\.dock-min\s+\.dock-head\s*,/);
    expect(css).toMatch(/body\.dock-min\s+\.hint\s*\{[^}]*display:\s*none/);
  });
  it("shrinks the mic to 36px when body.dock-min", () => {
    expect(css).toMatch(/body\.dock-min\s+\.mic\s*\{[^}]*width:\s*36px[^}]*height:\s*36px/);
  });
  it("gates the collapse rules behind @media (pointer: coarse)", () => {
    expect(css).toMatch(/@media\s*\(pointer:\s*coarse\)\s*\{[\s\S]*body\.dock-min/);
  });
});