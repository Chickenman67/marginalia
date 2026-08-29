import type { Item } from "../types";
import { toggleDone, deleteItem, reorder, togglePin } from "../store";
import { colorFor, formatClock } from "../settings";

export type SortMode = "manual" | "date" | "title" | "status";
export interface ViewState {
  search: string;
  status: "all" | "pending" | "done";
  sort: SortMode;
}
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
    manual: (a: Item, b: Item) => a.order - b.order || a.created_at.localeCompare(b.created_at)
  }[v.sort];
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

export function cardHTML(i: Item, opts: { selectable?: boolean; selected?: boolean } = {}): string {
  const isPast = i.kind === "event" && !!i.datetime && new Date(i.datetime) < new Date() && i.status !== "done";
  const time = i.kind === "event" && i.datetime ? (i.all_day ? "" : clock(i.datetime)) : "";
  const remind = i.reminder ? `<span class="remind">🔔 ${clock(i.reminder)}</span>` : "";
  const accent = colorFor(i.datetime || i.reminder);
  const accentAttr = accent ? ` data-accent="${accent}"` : "";
  const sel = opts.selectable
    ? `<input type="checkbox" class="sel" ${opts.selected ? "checked" : ""} aria-label="Select ${esc(i.title)}" />`
    : "";
  const pin = `<button type="button" class="pin-btn ${i.pinned ? "on" : ""}" title="${i.pinned ? "Unpin" : "Pin"}">${i.pinned ? "📌" : "📍"}</button>`;
  const handle = `<span class="drag-h" title="Drag to reorder" draggable="true">⠿</span>`;
  return `<div class="card ${i.status === "done" ? "done" : ""} ${isPast ? "past" : ""} ${opts.selected ? "selected" : ""}" data-id="${i.id}"${accentAttr}>
    ${handle}
    ${sel}
    <input type="checkbox" class="check" ${i.status === "done" ? "checked" : ""} aria-label="Complete ${esc(i.title)}" />
    <div class="body">
      <div class="title">${esc(i.title)}</div>
      <div class="meta">
        <span class="badge ${i.kind}">${i.kind}</span>
        ${i.all_day ? `<span class="badge allday">all day</span>` : ""}
        ${time ? `<span>${time}</span>` : ""}
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
  // pin button + drag (available regardless of selection mode)
  root.querySelectorAll<HTMLButtonElement>(".pin-btn").forEach((b) => {
    b.onclick = () => {
      const id = (b.closest(".card") as HTMLElement).dataset.id!;
      togglePin(id);
    };
  });
  root.querySelectorAll<HTMLElement>(".drag-h").forEach((h) => {
    const card = h.closest(".card") as HTMLElement;
    card.addEventListener("dragstart", () => card.classList.add("dragging"));
    card.addEventListener("dragend", () => card.classList.remove("dragging"));
    card.addEventListener("dragover", (e) => e.preventDefault());
    card.addEventListener("drop", (e) => {
      e.preventDefault();
      const dragging = root.querySelector(".card.dragging") as HTMLElement | null;
      if (!dragging || dragging === card) return;
      const ids = [...root.querySelectorAll<HTMLElement>(".card")].map((c) => c.dataset.id!);
      const from = ids.indexOf(dragging.dataset.id!);
      const to = ids.indexOf(card.dataset.id!);
      if (from < 0 || to < 0) return;
      ids.splice(to, 0, ids.splice(from, 1)[0]);
      reorder(ids);
    });
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
