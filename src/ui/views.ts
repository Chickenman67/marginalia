import type { Item } from "../types";
import { toggleDone, deleteItem } from "../store";

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
  if (!dt) return "";
  const d = new Date(dt);
  return isNaN(d.getTime()) ? "" : d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function cardHTML(i: Item): string {
  const isPast = i.kind === "event" && !!i.datetime && new Date(i.datetime) < new Date() && i.status !== "done";
  const time = i.kind === "event" && i.datetime ? (i.all_day ? "" : clock(i.datetime)) : "";
  const remind = i.reminder ? `<span class="remind">🔔 ${clock(i.reminder)}</span>` : "";
  return `<div class="card ${i.status === "done" ? "done" : ""} ${isPast ? "past" : ""}" data-id="${i.id}">
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
    <button class="del" title="Delete" aria-label="Delete ${esc(i.title)}">🗑</button>
  </div>`;
}

export function bindCardEvents(root: HTMLElement, onDelete: (id: string) => void = (id) => deleteItem(id)) {
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
}

export function groupByDay(items: Item[]): string {
  const groups: Record<string, Item[]> = {};
  let html = "";
  items.forEach((i) => {
    const k = dayKey(i.datetime || i.created_at);
    (groups[k] = groups[k] || []).push(i);
  });
  Object.keys(groups).forEach((k) => {
    html += `<div class="day-label">${esc(k)}</div>` + groups[k].map(cardHTML).join("");
  });
  return html;
}
export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
