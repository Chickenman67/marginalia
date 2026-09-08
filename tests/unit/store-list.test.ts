// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { setItems, getItems, reorder, togglePin, deleteOldEvents, addItem } from "../../src/store";
import type { Item } from "../../src/types";

function ev(title: string, datetime: string | null, pinned = false, order = 0, status: "pending" | "done" = "pending"): Item {
  return {
    id: title, space_token: "sp", kind: datetime ? "event" : "todo",
    title, datetime, all_day: false, reminder: datetime, status,
    created_at: new Date().toISOString(), order, pinned
  };
}

describe("reorder", () => {
  beforeEach(() => { localStorage.clear(); setItems([]); });
  it("assigns sequential order to the given id list", async () => {
    setItems([ev("a", null, false, 0), ev("b", null, false, 0), ev("c", null, false, 0)]);
    await reorder(["c", "a", "b"]);
    const byId = Object.fromEntries(getItems().map((i) => [i.id, i.order]));
    expect(byId.c).toBe(0); expect(byId.a).toBe(1); expect(byId.b).toBe(2);
  });
});

describe("togglePin", () => {
  beforeEach(() => { localStorage.clear(); setItems([]); });
  it("flips pinned", async () => {
    setItems([ev("a", null, false)]);
    await togglePin("a");
    expect(getItems()[0].pinned).toBe(true);
    await togglePin("a");
    expect(getItems()[0].pinned).toBe(false);
  });
});

describe("deleteOldEvents", () => {
  beforeEach(() => { localStorage.clear(); setItems([]); });
  it("deletes past unpinned events older than threshold, keeps pinned + future", async () => {
    const old = new Date(Date.now() - 40 * 864e5).toISOString();
    const soon = new Date(Date.now() + 1 * 864e5).toISOString();
    setItems([ev("old", old, false), ev("oldPinned", old, true), ev("future", soon, false)]);
    await deleteOldEvents(30);
    const titles = getItems().map((i) => i.title).sort();
    expect(titles).toEqual(["future", "oldPinned"]);
  });
});

describe("addItem", () => {
  beforeEach(() => { localStorage.clear(); setItems([]); });

  it("persists allDay as all_day on the stored item", async () => {
    await addItem({ title: "Wed thing", kind: "event", datetime: new Date().toISOString(), allDay: true, reminder: null });
    const [item] = getItems();
    expect(item.all_day).toBe(true);
    expect(item.kind).toBe("event");
  });

  it("defaults all_day to false when no allDay flag given", async () => {
    await addItem({ title: "Plain todo", kind: "todo", datetime: null, allDay: undefined, reminder: null });
    const [item] = getItems();
    expect(item.all_day).toBe(false);
  });
});