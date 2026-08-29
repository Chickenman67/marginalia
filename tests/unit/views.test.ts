import { describe, it, expect } from "vitest";
import { applyView } from "../../src/ui/views";
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