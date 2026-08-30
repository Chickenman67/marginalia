import { describe, it, expect, beforeEach } from "vitest";
import { JSDOM } from "jsdom";
import { mountFilterPanel, type ScheduleState, type TodosState, type DueState } from "../../src/ui/filterPanel";

type AnyState = ScheduleState | TodosState | DueState;

function mountWith(initial: AnyState, viewKey: "schedule" | "todos" | "due") {
  const dom = new JSDOM(`<!DOCTYPE html><html><body><div id="host"></div></body></html>`);
  (globalThis as any).window = dom.window;
  (globalThis as any).document = dom.window.document;
  (globalThis as any).HTMLElement = dom.window.HTMLElement;
  (globalThis as any).HTMLInputElement = dom.window.HTMLInputElement;
  (globalThis as any).HTMLButtonElement = dom.window.HTMLButtonElement;
  (globalThis as any).HTMLSelectElement = dom.window.HTMLSelectElement;
  const host = dom.window.document.getElementById("host")!;
  let captured: AnyState | null = null;
  const panel = mountFilterPanel({
    viewKey,
    initial,
    host: host as unknown as HTMLElement,
    onChange: (s) => { captured = JSON.parse(JSON.stringify(s)); }
  });
  return { dom, host, panel, getState: () => captured };
}

describe("filter panel - reset button", () => {
  let defaults: AnyState;
  let viewKey: "schedule" | "todos" | "due";

  beforeEach(() => {
    viewKey = "schedule";
    defaults = {
      search: "",
      filters: { timeRange: "all", status: "all" },
      sort: "date",
      dir: "asc"
    };
  });

  it("hides the Reset button when state matches defaults", () => {
    const { host } = mountWith(defaults, viewKey);
    const reset = host.querySelector(".reset") as HTMLButtonElement;
    expect(reset.hidden).toBe(true);
  });

  it("shows the Reset button after a chip is mutated", () => {
    const { host, panel } = mountWith(defaults, viewKey);
    panel.setState({ search: "", filters: { timeRange: "today", status: "all" }, sort: "date", dir: "asc" });
    const reset = host.querySelector(".reset") as HTMLButtonElement;
    expect(reset.hidden).toBe(false);
  });

  it("clicking Reset returns the state to defaults", () => {
    const { host, panel, getState } = mountWith(defaults, viewKey);
    panel.setState({ search: "x", filters: { timeRange: "today", status: "done" }, sort: "title", dir: "desc" });
    const reset = host.querySelector(".reset") as HTMLButtonElement;
    reset.click();
    const state = getState();
    expect(state).toEqual(defaults);
    expect((host.querySelector(".reset") as HTMLButtonElement).hidden).toBe(true);
  });

  it("clicking Reset does not close the panel", () => {
    const { host, panel } = mountWith(defaults, viewKey);
    panel.open();
    panel.setState({ search: "x", filters: { timeRange: "today", status: "all" }, sort: "date", dir: "asc" });
    const reset = host.querySelector(".reset") as HTMLButtonElement;
    reset.click();
    const pill = host.querySelector(".filter-pill") as HTMLButtonElement;
    expect(pill.getAttribute("aria-expanded")).toBe("true");
  });
});
