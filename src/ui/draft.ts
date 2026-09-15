import { esc } from "./views";
import type { DraftItem } from "../types";

export function toLocalInput(dt: string | null): string {
  if (!dt) return "";
  const d = new Date(dt);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function draftHTML(
  events: Array<{ i: DraftItem; idx: number }>,
  todos: Array<{ i: DraftItem; idx: number }>,
  open: { schedule: boolean; todos: boolean } = { schedule: true, todos: true }
): string {
  const row = (i: DraftItem, idx: number) => `
      <div class="draft-row" data-idx="${idx}">
        <input class="draft-title" value="${esc(i.title)}" aria-label="Title" />
        ${i.kind === "event" ? `<input type="datetime-local" class="draft-dt" value="${toLocalInput(i.datetime)}" aria-label="When" />` : ""}
        <button class="draft-move" title="Toggle todo/event">${i.kind === "event" ? "→ todo" : "→ event"}</button>
        <button class="draft-del" title="Remove">✕</button>
      </div>`;
  return `
      <div class="draft-list">
      <details class="draft-group"${open.schedule ? " open" : ""}><summary>Schedule (${events.length})</summary>${events.length ? events.map((x) => row(x.i, x.idx)).join("") : `<div class="empty">No events</div>`}</details>
      <details class="draft-group"${open.todos ? " open" : ""}><summary>Todos (${todos.length})</summary>${todos.length ? todos.map((x) => row(x.i, x.idx)).join("") : `<div class="empty">No todos</div>`}</details>
      </div>
      <div class="draft-actions"><button class="btn primary" id="addAll">Add all</button><button class="btn" id="draftCancel">Cancel</button></div>`;
}
