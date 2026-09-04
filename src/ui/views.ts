import type { Item } from "../types";
import { toggleDone, deleteItem, togglePin } from "../store";
import { colorFor, formatClock, getSettings } from "../settings";

export const STAR_SYMBOL_ID = "starShape";
export const STAR_POLYGON = "12,2 14.85,8.5 22,9.3 16.5,14 18,21 12,17.3 6,21 7.5,14 2,9.3 9.15,8.5";
export const STAR_EMPTY_FILL = "#8a7d63";

export function starSymbolHTML(): string {
  return `<svg width="0" height="0" style="position:absolute" aria-hidden="true">
    <defs>
      <symbol id="${STAR_SYMBOL_ID}" viewBox="0 0 24 24">
        <polygon points="${STAR_POLYGON}"/>
      </symbol>
    </defs>
  </svg>`;
}

export function starHTML(rating: number, itemId: string): string {
  const r = Math.max(0, Math.min(5, Math.round(rating * 2) / 2));
  let stars = "";
  for (let i = 1; i <= 5; i++) {
    if (r >= i) {
      stars += `<span class="star full" data-item="${itemId}" data-value="${i}" data-pos="${i}">
        <svg viewBox="0 0 24 24"><use href="#${STAR_SYMBOL_ID}" fill="#f5c518" stroke="#3a2e10" stroke-width="1.4" stroke-linejoin="round"/></svg>
      </span>`;
    } else if (r >= i - 0.5) {
      stars += `<span class="star half" data-item="${itemId}" data-value="${i - 0.5}" data-pos="${i}">
        <svg viewBox="0 0 24 24">
          <defs><clipPath id="half-${itemId}-${i}"><rect x="0" y="0" width="12" height="24"/></clipPath></defs>
          <use href="#${STAR_SYMBOL_ID}" fill="${STAR_EMPTY_FILL}" stroke="none"/>
          <use href="#${STAR_SYMBOL_ID}" fill="#f5c518" clip-path="url(#half-${itemId}-${i})"/>
          <use href="#${STAR_SYMBOL_ID}" fill="none" stroke="#3a2e10" stroke-width="1.6" stroke-linejoin="round"/>
        </svg>
      </span>`;
    } else {
      stars += `<span class="star empty" data-item="${itemId}" data-value="${i - 1}" data-pos="${i}">
        <svg viewBox="0 0 24 24"><use href="#${STAR_SYMBOL_ID}" fill="${STAR_EMPTY_FILL}" stroke="#3a2e10" stroke-width="1.8" stroke-linejoin="round"/></svg>
      </span>`;
    }
  }
  return `<span class="stars" role="radiogroup" aria-label="Rating" data-item="${itemId}">${stars}</span>`;
}

export function starClickValue(pos: number, zone: "half" | "whole", current: number, shiftKey: boolean): number {
  if (shiftKey) return 0;
  const target = zone === "whole" ? pos : pos - 0.5;
  if (current === target) return 0;
  return target;
}

export type SortMode = "manual" | "date" | "title" | "status" | "priority";
export interface ViewState {
  search: string;
  status: "all" | "pending" | "done";
  sort: SortMode;
}
export type Dir = "asc" | "desc";

export interface LegacyViewState {
  search: string;
  status: "all" | "pending" | "done";
  sort: SortMode;
}

export type ScheduleState = {
  search: string;
  filters: { timeRange: "all" | "today" | "week" | "month"; status: "all" | "pending" | "done" };
  sort: "date" | "title" | "manual";
  dir: Dir;
};

export type TodosState = {
  search: string;
  filters: { priority: "all" | "1" | "2" | "3" | "4" | "5"; status: "all" | "pending" | "done" };
  sort: "priority" | "date" | "title" | "manual";
  dir: Dir;
};

export type DueState = {
  search: string;
  filters: { dueWindow: "overdue" | "now" | "today" | "week"; kind: "all" | "event" | "todo" };
  sort: "date" | "title";
  dir: Dir;
};

export function applyView(items: Item[], v: ViewState): Item[] {
  const q = v.search.trim().toLowerCase();
  let out = items.filter((i) => {
    if (v.status !== "all" && i.status !== v.status) return false;
    if (q && !i.title.toLowerCase().includes(q)) return false;
    return true;
  });
  const cmp = {
    title: (a: Item, b: Item) => a.title.localeCompare(b.title),
    date: (a: Item, b: Item) => {
      if (!a.datetime && !b.datetime) return 0;
      if (!a.datetime) return 1;
      if (!b.datetime) return -1;
      return a.datetime.localeCompare(b.datetime);
    },
    status: (a: Item, b: Item) => (a.status === "done" ? 1 : 0) - (b.status === "done" ? 1 : 0),
    manual: (a: Item, b: Item) => a.order - b.order || a.created_at.localeCompare(b.created_at),
    priority: (a: Item, b: Item) => b.rating - a.rating
  }[v.sort];
  return out.slice().sort(cmp);
}

function inToday(iso: string): boolean {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return false;
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}
function inThisWeek(iso: string): boolean {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return false;
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(now.getDate() - ((now.getDay() + 6) % 7)); // Monday
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return d.getTime() >= start.getTime() && d.getTime() < end.getTime();
}
function inThisMonth(iso: string): boolean {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return false;
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

function priorityComparator(a: Item, b: Item): number {
  return b.rating - a.rating; // higher first
}
function dateComparator(a: Item, b: Item): number {
  if (!a.datetime && !b.datetime) return 0;
  if (!a.datetime) return 1;
  if (!b.datetime) return -1;
  return a.datetime.localeCompare(b.datetime);
}
function titleComparator(a: Item, b: Item): number {
  return a.title.localeCompare(b.title);
}
function manualComparator(a: Item, b: Item): number {
  return a.order - b.order || a.created_at.localeCompare(b.created_at);
}

type V2State = ScheduleState | TodosState | DueState;

export function applyViewV2(items: Item[], state: V2State): Item[] {
  const q = state.search.trim().toLowerCase();
  let out = items.filter((i) => {
    if (q && !i.title.toLowerCase().includes(q)) return false;
    return true;
  });

  // Per-view filter
  const f = (state as any).filters;
  if (f) {
    out = out.filter((i) => {
      // status (Schedule, Todos)
      if (f.status && f.status !== "all" && i.status !== f.status) return false;
      // timeRange (Schedule)
      if (f.timeRange && f.timeRange !== "all") {
        if (!i.datetime) return false;
        if (f.timeRange === "today" && !inToday(i.datetime)) return false;
        if (f.timeRange === "week" && !inThisWeek(i.datetime)) return false;
        if (f.timeRange === "month" && !inThisMonth(i.datetime)) return false;
      }
      // dueWindow (Due)
      if (f.dueWindow) {
        // Resolve the time to compare: reminder takes priority, then datetime.
        const r = i.reminder
          ? new Date(i.reminder).getTime()
          : i.datetime
          ? new Date(i.datetime).getTime()
          : null;
        if (r === null) return false;
        if (isNaN(r)) return false;
        const now = Date.now();
        const todayEnd = (() => { const d = new Date(); d.setHours(23, 59, 59, 999); return d.getTime(); })();
        if (f.dueWindow === "overdue" && r >= now) return false;
        if (f.dueWindow === "now" && (r < now - 5 * 60_000 || r > now + 5 * 60_000)) return false;
        if (f.dueWindow === "today" && (r < now || r > todayEnd)) return false;
        if (f.dueWindow === "week") {
          const settings = getSettings();
          const daysAheadMs = settings.dueDaysAhead * 86_400_000;
          const overdueOk = settings.dueIncludeOverdue && r < now;
          const inWindow = r >= now && r <= now + daysAheadMs;
          if (!overdueOk && !inWindow) return false;
        }
      }
      // kind (Due)
      if (f.kind && f.kind !== "all" && i.kind !== f.kind) return false;
      // priority (Todos)
      if (f.priority && f.priority !== "all") {
        const min = Number(f.priority);
        if (i.rating < min) return false;
      }
      return true;
    });
  }

  // Sort
  const sort = (state as any).sort as string;
  const dir = (state as any).dir as Dir;
  const baseCmp = {
    priority: priorityComparator,
    date: dateComparator,
    title: titleComparator,
    manual: manualComparator
  }[sort] || manualComparator;
  const cmp = (a: Item, b: Item) => {
    const v = baseCmp(a, b);
    if (sort === "manual") return v;
    if (sort === "priority") return dir === "asc" ? -v : v;
    return dir === "desc" ? -v : v;
  };
  return out.slice().sort(cmp);
}

export function dayKey(dt: string): string {
  const d = new Date(dt);
  if (isNaN(d.getTime())) return "";
  const t = new Date();
  const base = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
  const cur = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((cur - base) / 864e5);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff > 1 && diff < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
  return d.toLocaleDateString(undefined, { month: "long", day: "numeric" });
}
export function clock(dt: string | null): string {
  return formatClock(dt);
}

export function weekdayShort(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { weekday: "short" });
}

export function cardHTML(i: Item, opts: { selectable?: boolean; selected?: boolean; showPin?: boolean } = {}): string {
  if (i.kind === "todo") return todoCardHTML(i, opts);
  return eventCardHTML(i, opts);
}

function todoCardHTML(i: Item, opts: { selectable?: boolean; selected?: boolean }): string {
  const accent = colorFor(i.datetime || i.reminder);
  const accentAttr = accent ? ` data-accent="${accent}"` : "";
  const sel = opts.selectable
    ? `<input type="checkbox" class="sel" ${opts.selected ? "checked" : ""} aria-label="Select ${esc(i.title)}" />`
    : "";
  return `<div class="card todo ${i.status === "done" ? "done" : ""} ${opts.selected ? "selected" : ""}" data-id="${i.id}"${accentAttr}>
    ${sel}
    <input type="checkbox" class="check" ${i.status === "done" ? "checked" : ""} aria-label="Complete ${esc(i.title)}" />
    <div class="body">
      <div class="title">${esc(i.title)}</div>
      <div class="meta">
        <span class="badge todo">todo</span>
        ${starHTML(i.rating, i.id)}
      </div>
    </div>
    <button class="del" title="Delete" aria-label="Delete ${esc(i.title)}">🗑</button>
  </div>`;
}

function eventCardHTML(i: Item, opts: { selectable?: boolean; selected?: boolean; showPin?: boolean }): string {
  const isPast = i.kind === "event" && !!i.datetime && new Date(i.datetime) < new Date() && i.status !== "done";
  const wd = i.datetime ? weekdayShort(i.datetime) : "";
  const weekdayPart = wd ? `<span class="weekday">${wd}</span>` : "";
  const time = i.kind === "event" && i.datetime
    ? (i.all_day ? `${weekdayPart}<span class="badge allday">all day</span>` : `${weekdayPart}<span>${clock(i.datetime)}</span>`)
    : "";
  // Suppress the bell when reminder equals datetime — that's the old auto-default
  // (notifications.ts already filters this out at the notifier; we mirror that here
  // so the UI never shows two copies of the same time).
  const remind = i.reminder && i.reminder !== i.datetime ? `<span class="remind">🔔 ${clock(i.reminder)}</span>` : "";
  const accent = colorFor(i.datetime || i.reminder);
  const accentAttr = accent ? ` data-accent="${accent}"` : "";
  const sel = opts.selectable
    ? `<input type="checkbox" class="sel" ${opts.selected ? "checked" : ""} aria-label="Select ${esc(i.title)}" />`
    : "";
  const pin = opts.showPin === false
    ? ""
    : `<button type="button" class="pin-btn ${i.pinned ? "on" : ""}" title="${i.pinned ? "Unpin" : "Pin"}">${i.pinned ? "📌" : "📍"}</button>`;
  return `<div class="card ${i.status === "done" ? "done" : ""} ${isPast ? "past" : ""} ${opts.selected ? "selected" : ""}" data-id="${i.id}"${accentAttr}>
    ${sel}
    <input type="checkbox" class="check" ${i.status === "done" ? "checked" : ""} aria-label="Complete ${esc(i.title)}" />
    <div class="body">
      <div class="title">${esc(i.title)}</div>
      <div class="meta">
        <span class="badge ${i.kind}">${i.kind}</span>
        ${time}
        ${remind}
      </div>
    </div>
    ${pin}
    <button class="del" title="Delete" aria-label="Delete ${esc(i.title)}">🗑</button>
  </div>`;
}

export function bindCardEvents(
  root: HTMLElement,
  onDelete: (id: string) => void = (id) => deleteItem(id),
  selCtx?: { selected: Set<string>; onChange: () => void }
) {
  // Accent border color is applied via the CSSOM (not an inline style attribute)
  // so it survives a strict Content-Security-Policy that forbids inline styles.
  root.querySelectorAll<HTMLElement>(".card[data-accent]").forEach((c) => {
    c.style.borderLeft = `4px solid ${c.dataset.accent}`;
  });
  root.querySelectorAll<HTMLInputElement>(".check").forEach((c) => {
    c.onchange = () => {
      const id = (c.closest(".card") as HTMLElement).dataset.id!;
      toggleDone(id);
    };
  });
  root.querySelectorAll<HTMLButtonElement>(".del").forEach((d) => {
    d.onclick = () => {
      const id = (d.closest(".card") as HTMLElement).dataset.id!;
      onDelete(id);
    };
  });
  if (selCtx) {
    root.querySelectorAll<HTMLInputElement>(".sel").forEach((c) => {
      c.onchange = () => {
        const id = (c.closest(".card") as HTMLElement).dataset.id!;
        if (c.checked) selCtx.selected.add(id); else selCtx.selected.delete(id);
        selCtx.onChange();
      };
    });
    root.querySelectorAll<HTMLButtonElement>(".day-del").forEach((b) => {
      b.onclick = () => {
        const ids = (b.dataset.ids || "").split(",").filter(Boolean);
        ids.forEach((id) => deleteItem(id));
        selCtx.onChange();
      };
    });
  }
  // pin button (drag handlers removed in Task 3 — UI affordance gone)
  root.querySelectorAll<HTMLButtonElement>(".pin-btn").forEach((b) => {
    b.onclick = () => {
      const id = (b.closest(".card") as HTMLElement).dataset.id!;
      togglePin(id);
    };
  });
}

export function groupByDay(items: Item[], selectable = false): string {
  const groups: Record<string, Item[]> = {};
  let html = "";
  items.forEach((i) => {
    const k = dayKey(i.datetime || i.created_at);
    (groups[k] = groups[k] || []).push(i);
  });
  Object.keys(groups).forEach((k) => {
    const ids = groups[k].map((i) => i.id).join(",");
    html += `<div class="day-label">${esc(k)}${selectable ? `<button type="button" class="day-del" data-ids="${ids}">delete all</button>` : ""}</div>` + groups[k].map((i) => cardHTML(i, { selectable })).join("");
  });
  return html;
}
export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
