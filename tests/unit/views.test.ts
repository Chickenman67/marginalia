import { describe, it, expect } from "vitest";
import { applyView, cardHTML, weekdayShort } from "../../src/ui/views";
import type { Item } from "../../src/types";

function mkItem(title: string, datetime: string | null, status: "pending" | "done" = "pending", order = 0): Item {
  return { id: title, space_token: "s", kind: datetime ? "event" : "todo", title,
    datetime, all_day: false, reminder: null, status, created_at: "2026-01-01T00:00:00.000Z", order, pinned: false };
}

describe("applyView", () => {
  const items = [mkItem("Banana", null), mkItem("Apple", "2026-02-01T00:00:00.000Z"), mkItem("Cherry", null, "done")];

  it("filters by status", () => {
    const r = applyView(items, { search: "", status: "done", sort: "manual" });
    expect(r.map((i) => i.title)).toEqual(["Cherry"]);
  });

  it("filters by search (title substring, case-insensitive)", () => {
    const r = applyView(items, { search: "an", status: "all", sort: "manual" });
    expect(r.map((i) => i.title).sort()).toEqual(["Banana"]);
  });

  it("sorts by title", () => {
    const r = applyView(items, { search: "", status: "all", sort: "title" });
    expect(r.map((i) => i.title)).toEqual(["Apple", "Banana", "Cherry"]);
  });

  it("sorts by date (nulls last)", () => {
    const r = applyView(items, { search: "", status: "all", sort: "date" });
    expect(r[0].title).toBe("Apple");
  });
});

import { applyViewV2 } from "../../src/ui/views";

function mkItemFull(o: Partial<import("../../src/types").Item> = {}): import("../../src/types").Item {
  return {
    id: o.id ?? "x", space_token: "s", kind: o.kind ?? "todo",
    title: o.title ?? "T", datetime: o.datetime ?? null, all_day: false,
    reminder: o.reminder ?? null, status: o.status ?? "pending",
    created_at: o.created_at ?? "2026-01-01T00:00:00.000Z",
    order: o.order ?? 0, pinned: false,
    rating: o.rating ?? 0
  };
}

describe("applyViewV2 — sort", () => {
  const items = [
    mkItemFull({ id: "a", title: "Apple", datetime: "2026-02-01T00:00:00.000Z", rating: 2 }),
    mkItemFull({ id: "b", title: "Banana", rating: 5 }),
    mkItemFull({ id: "c", title: "Cherry", rating: 3.5 }),
    mkItemFull({ id: "d", title: "Date", datetime: "2026-01-15T00:00:00.000Z", rating: 1 })
  ];
  it("priority desc: 5, 3.5, 2, 1", () => {
    const r = applyViewV2(items, {
      search: "", filters: { priority: "all", status: "all" },
      sort: "priority", dir: "desc"
    });
    expect(r.map((i) => i.rating)).toEqual([5, 3.5, 2, 1]);
  });
  it("priority asc: 1, 2, 3.5, 5", () => {
    const r = applyViewV2(items, {
      search: "", filters: { priority: "all", status: "all" },
      sort: "priority", dir: "asc"
    });
    expect(r.map((i) => i.rating)).toEqual([1, 2, 3.5, 5]);
  });
  it("date asc puts earlier first", () => {
    const r = applyViewV2(items, {
      search: "", filters: { timeRange: "all", status: "all" },
      sort: "date", dir: "asc"
    });
    // datetimes: d=2026-01-15, a=2026-02-01, b and c have none (nulls last)
    expect(r.slice(0, 2).map((i) => i.id)).toEqual(["d", "a"]);
  });
});

describe("applyViewV2 — filters", () => {
  it("priority >= N", () => {
    const items = [
      mkItemFull({ id: "1", rating: 0.5 }),
      mkItemFull({ id: "2", rating: 2 }),
      mkItemFull({ id: "3", rating: 4 })
    ];
    const r = applyViewV2(items, {
      search: "", filters: { priority: "2", status: "all" },
      sort: "priority", dir: "desc"
    });
    expect(r.map((i) => i.id).sort()).toEqual(["2", "3"]);
  });
  it("search ignores case", () => {
    const items = [mkItemFull({ id: "1", title: "Hello World" })];
    const r = applyViewV2(items, {
      search: "hello", filters: { priority: "all", status: "all" },
      sort: "priority", dir: "desc"
    });
    expect(r).toHaveLength(1);
  });
});

describe("cardHTML — todo matches Schedule height", () => {
  const todo = (): Item => ({
    id: "x", space_token: "s", kind: "todo", title: "T",
    datetime: null, all_day: false, reminder: null, status: "pending",
    created_at: "2026-01-01T00:00:00.000Z", order: 0, pinned: false, rating: 0
  });

  it("does not include the drag handle", () => {
    expect(cardHTML(todo())).not.toContain("drag-h");
  });

  it("renders title inside .body on line 1", () => {
    const html = cardHTML(todo());
    expect(html).toMatch(/<div class="body">\s*<div class="title">T<\/div>/);
  });

  it("renders the badge inside .meta on line 2", () => {
    const html = cardHTML(todo());
    expect(html).toMatch(/<div class="meta">[\s\S]*<span class="badge todo">todo<\/span>[\s\S]*<\/div>/);
  });

  it("renders the stars container inside .meta", () => {
    const html = cardHTML(todo());
    expect(html.replace(/\s+/g, " ")).toContain(
      '<div class="meta"> <span class="badge todo">todo</span> <span class="stars"'
    );
  });

  it("keeps the check and delete buttons outside .body", () => {
    const html = cardHTML(todo());
    const bodyIdx = html.indexOf('<div class="body">');
    const checkIdx = html.indexOf('<input type="checkbox" class="check"');
    const delIdx = html.indexOf('<button class="del"');
    expect(checkIdx).toBeGreaterThan(-1);
    expect(checkIdx).toBeLessThan(bodyIdx);
    expect(delIdx).toBeGreaterThan(bodyIdx);
  });
});

describe("weekdayShort", () => {
  it("returns short weekday for a valid ISO string", () => {
    // 2026-09-07 is a Monday
    expect(weekdayShort("2026-09-07T09:00:00.000Z")).toMatch(/Mon/);
  });
  it("returns empty string for an invalid date", () => {
    expect(weekdayShort("not-a-date")).toBe("");
  });
  it("returns empty string for empty input", () => {
    expect(weekdayShort("")).toBe("");
  });
});

describe("cardHTML — schedule weekday", () => {
  const ev = (o: Partial<Item> = {}): Item => ({
    id: "e", space_token: "s", kind: "event", title: "E",
    datetime: "2026-09-07T09:00:00.000Z", all_day: false,
    reminder: null, status: "pending",
    created_at: "2026-01-01T00:00:00.000Z", order: 0, pinned: false,
    rating: 0, ...o
  });

  it("renders <span class=\"weekday\"> for dated events", () => {
    expect(cardHTML(ev())).toMatch(/<span class="weekday">Mon<\/span>/);
  });
  it("renders weekday + time token for non-all-day events", () => {
    const html = cardHTML(ev());
    expect(html).toMatch(/<span class="weekday">Mon<\/span>[\s\S]*?\d/);
  });
  it("renders weekday + 'all day' for all-day events", () => {
    const html = cardHTML(ev({ all_day: true }));
    expect(html).toMatch(/<span class="weekday">Mon<\/span>[\s\S]*?all day/);
  });
  it("omits weekday for events with no datetime (defensive)", () => {
    const html = cardHTML(ev({ datetime: null }));
    expect(html).not.toContain('<span class="weekday">');
  });
});
