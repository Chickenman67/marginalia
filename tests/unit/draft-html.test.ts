// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { draftHTML } from "../../src/ui/draft";

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
