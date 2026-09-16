import { esc } from "./views";
import { getSettings } from "../settings";
import type { DraftItem } from "../types";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Split an ISO datetime into local wall-clock { date: "YYYY-MM-DD", time: "HH:MM" }. */
export function splitDraftDateTime(iso: string | null): { date: string; time: string } {
  if (iso) {
    const d = new Date(iso);
    if (!isNaN(d.getTime())) {
      return {
        date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
        time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
      };
    }
  }
  return { date: todayLocal(), time: "09:00" };
}

/**
 * Combine a local wall-clock date + time into an ISO string (interpreted as
 * the user's LOCAL time, not UTC). Mirrors localToISO in ui/input.ts.
 */
export function combineDraftDateTime(date: string, time: string, allDay: boolean): string | null {
  const t = allDay ? "00:00" : time || "09:00";
  const m = `${date}T${t}`.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const [, y, mo, d, h, mi, se] = m;
  const dt = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(se || 0), 0);
  if (isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

export function fmtDraftDate(isoDate: string): string {
  const d = new Date(isoDate + "T00:00:00");
  if (isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function fmtDraftTime(hhmm: string, military?: boolean): string {
  const mil = military ?? getSettings().militaryTime;
  const m = hhmm.match(/^(\d{2}):(\d{2})$/);
  if (!m) return hhmm;
  if (mil) return hhmm;
  const hh = Number(m[1]);
  const mm = m[2];
  return `${String(((hh + 11) % 12) + 1).padStart(2, "0")}:${mm} ${hh >= 12 ? "PM" : "AM"}`;
}

export function toLocalInput(dt: string | null): string {
  if (!dt) return "";
  const d = new Date(dt);
  if (isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function draftHTML(
  events: Array<{ i: DraftItem; idx: number }>,
  todos: Array<{ i: DraftItem; idx: number }>,
  open: { schedule: boolean; todos: boolean } = { schedule: true, todos: true }
): string {
  const row = (i: DraftItem, idx: number) => {
    const moveLabel = i.kind === "event" ? "→ todo" : "→ event";
    if (i.kind !== "event") {
      return `
      <div class="draft-row" data-idx="${idx}">
        <input type="text" class="draft-title" value="${esc(i.title)}" aria-label="Title" />
        <button type="button" class="draft-move" title="Toggle todo/event">${moveLabel}</button>
        <button type="button" class="draft-del" title="Remove">✕</button>
      </div>`;
    }
    const { date, time } = splitDraftDateTime(i.datetime);
    const allDay = i.allDay ?? false;
    return `
      <div class="draft-row" data-idx="${idx}">
        <input type="text" class="draft-title" value="${esc(i.title)}" aria-label="Title" />
        <button type="button" class="draft-move" title="Toggle todo/event">${moveLabel}</button>
        <button type="button" class="draft-del" title="Remove">✕</button>
        <div class="draft-when">
          <button type="button" class="picker-trigger draft-date">${fmtDraftDate(date)}</button>
          <button type="button" class="picker-trigger draft-time"${allDay ? " hidden" : ""}>${fmtDraftTime(time)}</button>
          <label class="draft-allday"><input type="checkbox" class="draft-allday-cb"${allDay ? " checked" : ""} /> all day</label>
        </div>
      </div>`;
  };
  return `
      <div class="draft-list">
      <details class="draft-group"${open.schedule ? " open" : ""}><summary>Schedule (${events.length})</summary>${events.length ? events.map((x) => row(x.i, x.idx)).join("") : `<div class="empty">No events</div>`}</details>
      <details class="draft-group"${open.todos ? " open" : ""}><summary>Todos (${todos.length})</summary>${todos.length ? todos.map((x) => row(x.i, x.idx)).join("") : `<div class="empty">No todos</div>`}</details>
      </div>
      <div class="draft-actions"><button class="btn primary" id="addAll">Add all</button><button class="btn" id="draftCancel">Cancel</button></div>`;
}
