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

describe("todo titles are never single-line ellipsized", () => {
  it("has no nowrap rule for .card.todo .title", () => {
    expect(css).not.toMatch(/\.card\.todo\s+\.title\s*\{[^}]*white-space:\s*nowrap/);
  });
  it("has no text-overflow clip rule for .card.todo .title", () => {
    expect(css).not.toMatch(/\.card\.todo\s+\.title\s*\{[^}]*text-overflow:\s*ellipsis/);
  });
  it("clamp rule is the winning (last) .card.todo .title rule in the sheet", () => {
    const blocks = [...css.matchAll(/\.card\.todo\s+\.title\s*\{([^}]*)\}/g)].map((m) => m[1]);
    const last = blocks[blocks.length - 1] ?? "";
    expect(last).toMatch(/white-space:\s*normal/);
    expect(last).toMatch(/-webkit-line-clamp:\s*4/);
  });
});

describe("expand indicator gated to clamped titles", () => {
  it("always shows the ▼ on titles that can expand (.can-expand)", () => {
    expect(css).toMatch(/\.card\s+\.title\.can-expand::after\s*\{[^}]*opacity:\s*1/);
  });
  it("does not reveal the indicator on hover for every title", () => {
    expect(css).not.toMatch(/\.card\s+\.title:hover/);
  });
});

describe("overscroll kill-switch", () => {
  it("applies overscroll-behavior-y: none on html as well as body", () => {
    expect(css).toMatch(/html\s*\{[^}]*overscroll-behavior-y:\s*none/);
  });
});

describe("dedicated app scroll container", () => {
  const rule = css.match(/\.app\s*\{([^}]*)\}/)?.[1] ?? "";
  it("makes .app the scroller (overflow-y auto, fixed viewport height)", () => {
    expect(rule).toMatch(/overflow-y:\s*auto/);
    expect(rule).toMatch(/height:\s*100dvh/);
  });
  it("clamps its own bounce with overscroll-behavior-y: contain", () => {
    expect(rule).toMatch(/overscroll-behavior-y:\s*contain/);
  });
  it("no longer uses min-height: 100vh (page-level scroll) on .app", () => {
    expect(rule).not.toMatch(/min-height:\s*100vh/);
  });
});

describe("CSP-safe visibility gating (no inline styles)", () => {
  it("hides the edit date/time row with a .hidden class, CSP-proof", () => {
    expect(css).toMatch(/\.edit-dt-row\.hidden\s*\{[^}]*display:\s*none/);
  });
  it("restores the utility classes previously shipped as inline styles", () => {
    expect(css).toMatch(/\.num-inline\s*\{[^}]*width:\s*64px/);
    expect(css).toMatch(/\.svg-defs\s*\{[^}]*position:\s*absolute/);
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