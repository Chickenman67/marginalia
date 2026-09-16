// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { draftHTML, splitDraftDateTime, combineDraftDateTime, fmtDraftTime } from "../../src/ui/draft";

describe("draftHTML scroll wrap", () => {
  it("wraps groups in .draft-list with actions outside it", () => {
    const html = draftHTML(
      [{ i: { title: "Dentist", kind: "event", datetime: "2026-09-18T08:30", reminder: null }, idx: 0 }],
      [{ i: { title: "Guitar", kind: "todo", datetime: null, reminder: null }, idx: 1 }]
    );
    const root = document.createElement("div");
    root.innerHTML = html;
    expect(root.querySelector(".draft-list")).toBeTruthy();
    expect(root.querySelector(".draft-list .draft-group")).toBeTruthy();
    expect(root.querySelector(".draft-actions #addAll")).toBeTruthy();
    expect(root.querySelector(".draft-actions #draftCancel")).toBeTruthy();
    expect(root.querySelector(".draft-list .draft-actions")).toBeNull();
  });
});

describe("draftHTML collapse", () => {
  it("renders details/summary groups with counts", () => {
    const html = draftHTML(
      [{ i: { title: "Dentist", kind: "event", datetime: "2026-09-18T08:30", reminder: null }, idx: 0 }],
      []
    );
    const root = document.createElement("div");
    root.innerHTML = html;
    const summaries = [...root.querySelectorAll("details.draft-group > summary")].map((s) => s.textContent ?? "");
    expect(summaries.join(" ")).toMatch(/Schedule \(1\)/);
    expect(summaries.join(" ")).toMatch(/Todos \(0\)/);
    expect(root.querySelectorAll("details[open]").length).toBeGreaterThan(0);
  });
});

describe("draftHTML custom pickers (no native datetime-local)", () => {
  it("event rows use picker-trigger date/time buttons like the schedule-add form", () => {
    const html = draftHTML(
      [{ i: { title: "Dentist", kind: "event", datetime: new Date(2026, 8, 18, 8, 30).toISOString(), reminder: null }, idx: 0 }],
      []
    );
    const root = document.createElement("div");
    root.innerHTML = html;
    const row = root.querySelector(".draft-row")!;
    expect(row.querySelector("input.draft-dt")).toBeNull();
    expect(row.querySelector('input[type="datetime-local"]')).toBeNull();
    const dateBtn = row.querySelector<HTMLButtonElement>(".draft-date");
    const timeBtn = row.querySelector<HTMLButtonElement>(".draft-time");
    expect(dateBtn).toBeTruthy();
    expect(timeBtn).toBeTruthy();
    expect(dateBtn!.classList.contains("picker-trigger")).toBe(true);
    expect(timeBtn!.classList.contains("picker-trigger")).toBe(true);
    expect(dateBtn!.textContent).toMatch(/Sep.*18/);
    expect(timeBtn!.textContent).toMatch(/8:30|08:30/);
  });
  it("todo rows render no date controls, event rows do", () => {
    const html = draftHTML(
      [{ i: { title: "Dentist", kind: "event", datetime: new Date(2026, 8, 18, 8, 30).toISOString(), reminder: null }, idx: 0 }],
      [{ i: { title: "Guitar", kind: "todo", datetime: null, reminder: null }, idx: 1 }]
    );
    const root = document.createElement("div");
    root.innerHTML = html;
    const rows = [...root.querySelectorAll(".draft-row")];
    expect(rows.length).toBe(2);
    const todoRow = rows.find((r) => r.querySelector(".draft-title")?.getAttribute("value") === "Guitar")!;
    expect(todoRow.querySelector(".draft-when")).toBeNull();
    expect(todoRow.querySelector(".draft-date")).toBeNull();
    const eventRow = rows.find((r) => r.querySelector(".draft-title")?.getAttribute("value") === "Dentist")!;
    expect(eventRow.querySelector(".draft-when")).toBeTruthy();
  });
  it("title input carries the full AI title (mobile visibility)", () => {
    const title = "Call mom about birthday party preparations tomorrow";
    const html = draftHTML([], [{ i: { title, kind: "todo", datetime: null, reminder: null }, idx: 0 }]);
    const root = document.createElement("div");
    root.innerHTML = html;
    const inp = root.querySelector<HTMLInputElement>(".draft-title")!;
    expect(inp).toBeTruthy();
    expect(inp.getAttribute("value")).toBe(title);
    expect(inp.getAttribute("type")).toBe("text");
  });
  it("all-day events hide the time button but keep the date button", () => {
    const html = draftHTML(
      [{ i: { title: "Holiday", kind: "event", datetime: new Date(2026, 8, 18, 0, 0).toISOString(), allDay: true, reminder: null }, idx: 0 }],
      []
    );
    const root = document.createElement("div");
    root.innerHTML = html;
    const row = root.querySelector(".draft-row")!;
    expect(row.querySelector(".draft-date")).toBeTruthy();
    expect(row.querySelector(".draft-time")?.hasAttribute("hidden")).toBe(true);
    expect(row.querySelector(".draft-allday-cb")?.hasAttribute("checked")).toBe(true);
  });
});

describe("draft schedule-time persistence helpers", () => {
  it("split/combine round-trips the exact wall-clock time", () => {
    const iso = new Date(2026, 8, 18, 15, 45).toISOString();
    const parts = splitDraftDateTime(iso);
    expect(parts.date).toBe("2026-09-18");
    expect(parts.time).toBe("15:45");
    const back = combineDraftDateTime(parts.date, parts.time, false)!;
    const d = new Date(back);
    expect(d.getHours()).toBe(15);
    expect(d.getMinutes()).toBe(45);
  });
  it("switching event->todo->event can restore the same date+time", () => {
    // Simulates input.ts toggle: kind flips but datetime is kept, not nulled.
    const item = { title: "Dentist", kind: "event" as const, datetime: new Date(2026, 8, 18, 15, 45).toISOString(), reminder: null };
    const before = splitDraftDateTime(item.datetime);
    const asTodo = { ...item, kind: "todo" as const }; // datetime preserved
    const restored = splitDraftDateTime(asTodo.datetime);
    expect(restored).toEqual(before);
  });
  it("fmtDraftTime respects military mode", () => {
    expect(fmtDraftTime("15:45", true)).toBe("15:45");
    expect(fmtDraftTime("15:45", false)).toBe("03:45 PM");
    expect(fmtDraftTime("09:00", false)).toBe("09:00 AM");
  });
});

describe("draft row CSS — mobile title visibility", () => {
  const css = readFileSync(resolve(__dirname, "../../src/style.css"), "utf8");
  it("draft-row puts the title on its own grid row area (not squeezed by a datetime input)", () => {
    expect(css).toMatch(/\.draft-row\s*\{[^}]*grid-template-areas:\s*"title move del"/);
    expect(css).toMatch(/\.draft-title\s*\{[^}]*grid-area:\s*title/);
    expect(css).toMatch(/\.draft-when\s*\{[^}]*grid-area:\s*when/);
  });
  it("no longer uses the 4-column datetime-local squeeze layout", () => {
    expect(css).not.toMatch(/\.draft-row\s*\{[^}]*1fr auto auto auto/);
    expect(css).not.toMatch(/\.draft-dt\s*\{/);
  });
});
