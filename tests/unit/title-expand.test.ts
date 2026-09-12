// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { cardHTML, bindCardEvents, setExpandedTitle, expandedTitle } from "../../src/ui/views";
import type { Item } from "../../src/types";

function mkItem(o: Partial<Item> = {}): Item {
  return {
    id: o.id ?? "x", space_token: "s", kind: o.kind ?? "todo",
    title: o.title ?? "T", datetime: o.datetime ?? null, all_day: false,
    reminder: null, status: "pending", created_at: "2026-01-01T00:00:00.000Z",
    order: 0, rating: 0, pinned: false, ...o
  };
}

function render(i: Item, clamped = true): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = cardHTML(i);
  bindCardEvents(root, undefined, undefined, undefined, () => clamped);
  return root;
}

describe("expanded-title state", () => {
  beforeEach(() => { setExpandedTitle("a", false); setExpandedTitle("e", false); });

  it("renders collapsed by default with no button semantics on the title", () => {
    const root = render(mkItem({ id: "a" }), false);
    const title = root.querySelector<HTMLElement>(".title")!;
    expect(root.querySelector(".card")!.classList.contains("expanded")).toBe(false);
    expect(title.hasAttribute("aria-expanded")).toBe(false);
    expect(title.hasAttribute("role")).toBe(false);
    expect(title.hasAttribute("tabindex")).toBe(false);
  });

  it("renders the expanded class when set expanded", () => {
    setExpandedTitle("a", true);
    const root = render(mkItem({ id: "a" }));
    expect(root.querySelector(".card")!.classList.contains("expanded")).toBe(true);
  });

  it("applies to event cards too", () => {
    setExpandedTitle("e", true);
    const root = render(mkItem({ id: "e", kind: "event", datetime: "2026-09-07T09:00:00.000Z" }));
    expect(root.querySelector(".card")!.classList.contains("expanded")).toBe(true);
  });

  it("only makes a clamped title interactive (role button + aria-expanded=false)", () => {
    const root = render(mkItem({ id: "a" }), true);
    const title = root.querySelector<HTMLElement>(".title")!;
    expect(title.classList.contains("can-expand")).toBe(true);
    expect(title.getAttribute("role")).toBe("button");
    expect(title.getAttribute("aria-expanded")).toBe("false");
  });

  it("clicking a clamped title toggles expand and updates aria-expanded", () => {
    const root = render(mkItem({ id: "a" }), true);
    const title = root.querySelector<HTMLElement>(".title")!;
    title.click();
    expect(expandedTitle("a")).toBe(true);
    expect(root.querySelector(".card")!.classList.contains("expanded")).toBe(true);
    expect(title.getAttribute("aria-expanded")).toBe("true");
    title.click();
    expect(expandedTitle("a")).toBe(false);
    expect(title.getAttribute("aria-expanded")).toBe("false");
  });

  it("toggles on Enter and Space for keyboard users", () => {
    const root = render(mkItem({ id: "a" }), true);
    const title = root.querySelector<HTMLElement>(".title")!;
    title.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(expandedTitle("a")).toBe(true);
    title.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    expect(expandedTitle("a")).toBe(false);
  });

  it("does not affect the done checkbox", () => {
    const root = render(mkItem({ id: "a" }), true);
    const check = root.querySelector<HTMLInputElement>(".check")!;
    root.querySelector<HTMLElement>(".title")!.click();
    expect(check.checked).toBe(false);
  });

  it("leaves titles that are not cut off non-interactive", () => {
    const root = render(mkItem({ id: "a" }), false);
    const title = root.querySelector<HTMLElement>(".title")!;
    expect(title.classList.contains("can-expand")).toBe(false);
    expect(title.hasAttribute("role")).toBe(false);
    expect(title.hasAttribute("tabindex")).toBe(false);
    expect(title.hasAttribute("aria-expanded")).toBe(false);
    title.click();
    expect(expandedTitle("a")).toBe(false);
    expect(root.querySelector(".card")!.classList.contains("expanded")).toBe(false);
  });

  it("drops the affordance when an expanded title is collapsed and no longer clamped", () => {
    setExpandedTitle("a", true);
    const root = render(mkItem({ id: "a" }), false);
    const title = root.querySelector<HTMLElement>(".title")!;
    expect(title.classList.contains("can-expand")).toBe(true);
    expect(title.getAttribute("aria-expanded")).toBe("true");
    title.click();
    expect(expandedTitle("a")).toBe(false);
    expect(title.hasAttribute("role")).toBe(false);
    expect(title.hasAttribute("aria-expanded")).toBe(false);
    expect(title.classList.contains("can-expand")).toBe(false);
  });
});