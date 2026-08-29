// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { setItems, getItems, importItems } from "../../src/store";
import type { ImportRow } from "../../src/backup";

function row(title: string, kind: "todo" | "event" = "todo"): ImportRow {
  return { kind, title, datetime: null, all_day: false, reminder: null, status: "pending" };
}

describe("importItems (demo mode)", () => {
  beforeEach(() => { localStorage.clear(); setItems([]); });
  it("merge appends rows as new items", async () => {
    setItems([{ id: "a", space_token: "sp", kind: "todo", title: "Existing", datetime: null, all_day: false, reminder: null, status: "pending", created_at: new Date().toISOString() }]);
    await importItems([row("Imported")], "merge");
    const all = getItems();
    expect(all).toHaveLength(2);
    expect(all.some((i) => i.title === "Imported")).toBe(true);
  });
  it("replace clears then loads only imported rows", async () => {
    setItems([{ id: "a", space_token: "sp", kind: "todo", title: "Existing", datetime: null, all_day: false, reminder: null, status: "pending", created_at: new Date().toISOString() }]);
    await importItems([row("Only")], "replace");
    const all = getItems();
    expect(all).toHaveLength(1);
    expect(all[0].title).toBe("Only");
  });
});
