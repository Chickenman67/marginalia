import { describe, it, expect } from "vitest";
import { toCSV, toText, parseFile } from "../../src/backup";
import type { Item } from "../../src/types";

function mk(p: Partial<Item>): Item {
  return {
    id: "id1", space_token: "sp", kind: "event", title: "Dentist",
    datetime: "2026-08-30T15:00:00.000Z", all_day: false,
    reminder: "2026-08-30T15:00:00.000Z", status: "pending",
    created_at: "2026-08-28T10:00:00.000Z", ...p
  };
}

describe("toCSV", () => {
  it("emits a quoted header and one row per item, quoting commas", () => {
    const csv = toCSV([mk({ title: "Call, mom" })]);
    expect(csv.split("\n")[0]).toBe("kind,title,datetime,all_day,reminder,status,created_at");
    expect(csv).toContain('"Call, mom"');
  });
});

describe("toText", () => {
  it("groups events and todos and embeds ISO for round-trip", () => {
    const txt = toText([mk({}), mk({ kind: "todo", title: "Buy milk", datetime: null, reminder: null, status: "done" })]);
    expect(txt).toContain("SCHEDULE");
    expect(txt).toContain("TODOS");
    expect(txt).toContain("[ ] Dentist — 2026-08-30T15:00:00.000Z");
    expect(txt).toContain("[x] Buy milk");
  });
});

describe("parseFile", () => {
  it("round-trips CSV", () => {
    const csv = toCSV([mk({})]);
    const rows = parseFile(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Dentist");
    expect(rows[0].kind).toBe("event");
    expect(rows[0].datetime).toBe("2026-08-30T15:00:00.000Z");
  });
  it("round-trips text", () => {
    const txt = toText([mk({}), mk({ kind: "todo", title: "Buy milk", datetime: null, reminder: null, status: "done" })]);
    const rows = parseFile(txt);
    expect(rows).toHaveLength(2);
    expect(rows[0].status).toBe("pending");
    expect(rows[1].status).toBe("done");
    expect(rows[1].kind).toBe("todo");
  });
  it("skips malformed CSV rows but keeps valid ones", () => {
    const bad = "kind,title\n" + "event,Ok\n" + "NoHeaderRow";
    const rows = parseFile(bad);
    expect(rows).toHaveLength(1);
  });
});
