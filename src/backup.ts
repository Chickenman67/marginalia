import type { Item } from "./types";
import { formatClock } from "./settings";

export interface ImportRow {
  kind: "todo" | "event";
  title: string;
  datetime: string | null;
  all_day: boolean;
  reminder: string | null;
  status: "pending" | "done";
}

export function download(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function downloadToken(token: string): void {
  download(token, "marginalia-space-token.txt", "text/plain");
}

function csvCell(v: string | null): string {
  if (v === null) return "";
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function toCSV(items: Item[]): string {
  const header = "kind,title,datetime,all_day,reminder,status,created_at";
  const lines = items.map((i) =>
    [i.kind, i.title, i.datetime, String(i.all_day), i.reminder, i.status, i.created_at]
      .map((c) => csvCell(c === null ? null : String(c)))
      .join(",")
  );
  return [header, ...lines].join("\n");
}

function humanDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    (iso.includes("T") && !iso.endsWith("T00:00:00.000Z") ? `, ${formatClock(iso)}` : "");
}

export function toText(items: Item[]): string {
  const stamp = new Date().toISOString().slice(0, 10);
  const events = items.filter((i) => i.kind === "event");
  const todos = items.filter((i) => i.kind === "todo");
  const line = (i: Item) => {
    const mark = i.status === "done" ? "[x]" : "[ ]";
    const when = i.datetime ? ` — ${i.datetime} (${humanDate(i.datetime)})` : "";
    return `- ${mark} ${i.title}${when}`;
  };
  const parts = [`Marginalia export — ${stamp}`, "SCHEDULE"];
  parts.push(events.length ? events.map(line).join("\n") : "  (none)");
  parts.push("TODOS");
  parts.push(todos.length ? todos.map(line).join("\n") : "  (none)");
  return parts.join("\n");
}

export function parseFile(text: string): ImportRow[] {
  const trimmed = text.trim();
  const firstLine = trimmed.split("\n")[0]?.trim() ?? "";
  const looksCsv = /^kind,/i.test(firstLine);
  return looksCsv ? parseCsv(trimmed) : parseText(trimmed);
}

function parseCsv(text: string): ImportRow[] {
  const rows = text.split("\n").slice(1).map((r) => r.trim()).filter(Boolean);
  const out: ImportRow[] = [];
  for (const row of rows) {
    const cols = splitCsvRow(row);
    if (cols.length < 2) continue;
    const [kind, title, datetime, all_day, reminder, status] = cols;
    if (kind !== "event" && kind !== "todo") continue;
    out.push({
      kind,
      title: title || "Untitled",
      datetime: datetime || null,
      all_day: all_day === "true",
      reminder: reminder || null,
      status: status === "done" ? "done" : "pending"
    });
  }
  return out;
}

function splitCsvRow(row: string): string[] {
  const out: string[] = [];
  let cur = "", inQ = false;
  for (let i = 0; i < row.length; i++) {
    const c = row[i];
    if (inQ) {
      if (c === '"') {
        if (row[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

function parseText(text: string): ImportRow[] {
  const lines = text.split("\n");
  let section: "event" | "todo" | null = null;
  const out: ImportRow[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (/^SCHEDULE/i.test(line)) { section = "event"; continue; }
    if (/^TODOS/i.test(line)) { section = "todo"; continue; }
    if (!line.startsWith("- ")) continue;
    const body = line.slice(2).trim();
    const m = body.match(/^\[( |x)\]\s+(.*)$/);
    if (!m) continue;
    const status = m[1] === "x" ? "done" : "pending";
    let title = m[2];
    let datetime: string | null = null;
    const isoMatch = title.match(/—\s*(\S+?)\s*\(/);
    if (isoMatch) {
      datetime = isoMatch[1];
      title = title.slice(0, isoMatch.index).replace(/—\s*$/, "").trim();
    } else {
      title = title.replace(/—.*$/, "").trim();
    }
    out.push({
      kind: section ?? "todo",
      title: title || "Untitled",
      datetime,
      all_day: false,
      reminder: datetime,
      status
    });
  }
  return out;
}
