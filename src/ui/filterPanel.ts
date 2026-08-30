import type { ScheduleState, TodosState, DueState, Dir } from "./views";
import { esc } from "./views";

type AnyState = ScheduleState | TodosState | DueState;
type ChipsDef = { row: string; key: string; options: { value: string; label: string }[] };
type SortOpt = { value: string; label: string; dir: "asc" | "desc" };

const DEFAULTS: Record<string, AnyState> = {
  schedule: { search: "", filters: { timeRange: "all", status: "all" }, sort: "date", dir: "asc" },
  todos: { search: "", filters: { priority: "all", status: "all" }, sort: "priority", dir: "desc" },
  due: { search: "", filters: { dueWindow: "now", kind: "all" }, sort: "date", dir: "asc" }
};

const CHIPS: Record<string, ChipsDef[]> = {
  schedule: [
    { row: "Time range", key: "timeRange", options: [
      { value: "all", label: "All time" },
      { value: "today", label: "Today" },
      { value: "week", label: "This week" },
      { value: "month", label: "This month" }
    ]},
    { row: "Status", key: "status", options: [
      { value: "all", label: "All" },
      { value: "pending", label: "Pending" },
      { value: "done", label: "Done" }
    ]}
  ],
  todos: [
    { row: "Priority", key: "priority", options: [
      { value: "all", label: "All" },
      { value: "1", label: "★1+" },
      { value: "2", label: "★2+" },
      { value: "3", label: "★3+" },
      { value: "4", label: "★4+" },
      { value: "5", label: "★5 only" }
    ]},
    { row: "Status", key: "status", options: [
      { value: "all", label: "All" },
      { value: "pending", label: "Pending" },
      { value: "done", label: "Done" }
    ]}
  ],
  due: [
    { row: "Time", key: "dueWindow", options: [
      { value: "overdue", label: "Overdue" },
      { value: "now", label: "Due now" },
      { value: "today", label: "Due today" }
    ]},
    { row: "Kind", key: "kind", options: [
      { value: "all", label: "All" },
      { value: "event", label: "Events" },
      { value: "todo", label: "Todos" }
    ]}
  ]
};

const SORT_OPTIONS: Record<string, SortOpt[]> = {
  schedule: [
    { value: "date", label: "By date ↑ (soonest)", dir: "asc" },
    { value: "date", label: "By date ↓ (latest)", dir: "desc" },
    { value: "title", label: "By title A→Z", dir: "asc" },
    { value: "title", label: "By title Z→A", dir: "desc" },
    { value: "manual", label: "Manual", dir: "asc" }
  ],
  todos: [
    { value: "priority", label: "By priority ★5 → ★0", dir: "desc" },
    { value: "priority", label: "By priority ★0 → ★5", dir: "asc" },
    { value: "date", label: "By date created ↑", dir: "asc" },
    { value: "date", label: "By date created ↓", dir: "desc" },
    { value: "title", label: "By title A→Z", dir: "asc" },
    { value: "title", label: "By title Z→A", dir: "desc" },
    { value: "manual", label: "Manual", dir: "asc" }
  ],
  due: [
    { value: "date", label: "By date ↑", dir: "asc" },
    { value: "date", label: "By date ↓", dir: "desc" },
    { value: "title", label: "By title A→Z", dir: "asc" },
    { value: "title", label: "By title Z→A", dir: "desc" }
  ]
};

function isDefault(state: AnyState, viewKey: string): boolean {
  return JSON.stringify(state) === JSON.stringify(DEFAULTS[viewKey]);
}

export function mountFilterPanel(opts: {
  viewKey: "schedule" | "todos" | "due";
  initial: AnyState;
  host: HTMLElement;
  onChange: (s: AnyState) => void;
}): { setState: (s: AnyState) => void; open: () => void; close: () => void } {
  const { viewKey, initial, host, onChange } = opts;
  let state: AnyState = JSON.parse(JSON.stringify(initial));
  let open_ = false;

  const pill = document.createElement("button");
  pill.className = "filter-pill";
  pill.type = "button";
  pill.setAttribute("aria-expanded", "false");
  pill.innerHTML = `<span aria-hidden="true">⇅</span> Filter &amp; sort<span class="dot" hidden></span>`;
  host.appendChild(pill);

  const panel = document.createElement("div");
  panel.className = "filter-panel";
  panel.hidden = true;
  host.appendChild(panel);

  function drawPanel() {
    const chips = CHIPS[viewKey];
    const sorts = SORT_OPTIONS[viewKey];
    const dirKey: Dir = state.dir;
    // Build the current sort value, combining sort + dir into a composite token
    const sortValue = `${state.sort}|${dirKey}`;
    const sortOptionsHTML = sorts
      .map((s) => {
        const compositeValue = `${s.value}|${s.dir}`;
        return `<option value="${esc(compositeValue)}" ${compositeValue === sortValue ? "selected" : ""}>${esc(s.label)}</option>`;
      })
      .join("");
    panel.innerHTML = `
      <div class="search"><input type="search" placeholder="Search titles…" aria-label="Search" value="${esc(state.search)}"></div>
      ${chips.map((c) => `
        <div>
          <div class="row-label">${esc(c.row)}</div>
          <div class="chips" data-key="${esc(c.key)}">
            ${c.options.map((o) => `
              <button type="button" class="chip ${(state.filters as any)[c.key] === o.value ? "active" : ""}" data-value="${esc(o.value)}">${esc(o.label)}</button>
            `).join("")}
          </div>
        </div>
      `).join("")}
      <div class="sort-row">
        <span class="label">Sort</span>
        <select aria-label="Sort">${sortOptionsHTML}</select>
        <button type="button" class="reverse" title="Reverse sort direction" aria-label="Reverse sort direction">↑↓</button>
      </div>
    `;
    panel.querySelector<HTMLInputElement>(".search input")!.oninput = (e) => {
      state.search = (e.target as HTMLInputElement).value;
      emit();
    };
    panel.querySelectorAll<HTMLDivElement>(".chips").forEach((row) => {
      const key = row.dataset.key!;
      row.querySelectorAll<HTMLButtonElement>(".chip").forEach((chip) => {
        chip.onclick = () => {
          (state.filters as any)[key] = chip.dataset.value;
          drawPanel();
          emit();
        };
      });
    });
    const sel = panel.querySelector<HTMLSelectElement>(".sort-row select")!;
    sel.onchange = () => {
      const [s, d] = sel.value.split("|");
      state.sort = s as any;
      state.dir = d as Dir;
      emit();
    };
    panel.querySelector<HTMLButtonElement>(".reverse")!.onclick = () => {
      state.dir = state.dir === "asc" ? "desc" : "asc";
      drawPanel();
      emit();
    };
  }

  function emit() {
    onChange(state);
    refreshPill();
  }

  function refreshPill() {
    pill.querySelector(".dot")!.toggleAttribute("hidden", isDefault(state, viewKey));
  }

  function setOpen(v: boolean) {
    open_ = v;
    panel.hidden = !v;
    pill.setAttribute("aria-expanded", String(v));
  }

  pill.onclick = () => setOpen(!open_);
  document.addEventListener("click", (e) => {
    if (!open_) return;
    if (panel.contains(e.target as Node) || pill.contains(e.target as Node)) return;
    setOpen(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && open_) setOpen(false);
  });

  drawPanel();
  refreshPill();
  return {
    setState: (s) => { state = s; drawPanel(); refreshPill(); },
    open: () => setOpen(true),
    close: () => setOpen(false)
  };
}