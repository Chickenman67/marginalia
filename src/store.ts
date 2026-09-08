import { config } from "./config";
import type { Item, ParsedItem } from "./types";
import type { ImportRow } from "./backup";
import { fetchItems, insertItem, updateItem, removeItem, subscribeToSpace } from "./supabase";
import { getSession } from "./auth";

// Demo mode = no Supabase configured (localStorage only).
const demoMode = !config.supabaseUrl;
// Back-compat: the rest of the app used to import `isDemoMode` from config.
// We deleted it there; re-export the same flag here so any leftover import keeps working
// until the next refactor pass removes it.
export const isDemoMode = demoMode;

type Listener = (items: Item[]) => void;
const listeners = new Set<Listener>();

let items: Item[] = [];
let loaded = false;

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  fn(items);
  return () => listeners.delete(fn);
}
function emit() { listeners.forEach((fn) => fn(items)); }

function persist() {
  if (demoMode) localStorage.setItem("marginalia.items", JSON.stringify(items));
}

function byOrder(a: Item, b: Item) {
  return a.order - b.order || a.created_at.localeCompare(b.created_at);
}
export function setItems(next: Item[]) {
  items = next.slice().sort(byOrder);
  emit();
  persist();
}
export function getItems(): Item[] { return items.slice(); }

export async function importItems(rows: ImportRow[], mode: "merge" | "replace"): Promise<void> {
  const userId = demoMode ? "" : (await getSession())!.user.id;
  const toItem = (r: ImportRow): Item => ({
    id: crypto.randomUUID(),
    user_id: userId,
    kind: r.kind,
    title: r.title.slice(0, 200),
    datetime: r.datetime,
    all_day: r.all_day,
    reminder: r.reminder,
    status: r.status,
    created_at: new Date().toISOString(),
    order: 0,
    pinned: false,
    rating: 0
  });
  const built = rows.map(toItem);
  if (demoMode) {
    if (mode === "replace") setItems(built);
    else setItems([...items, ...built]);
    return;
  }
  if (mode === "replace") setItems([]);
  for (const it of built) await insertItem(it);
  await loadItems();
}

export async function loadItems(): Promise<void> {
  if (loaded) return;
  if (demoMode) {
    const raw = localStorage.getItem("marginalia.items");
    items = raw ? (JSON.parse(raw) as Item[]) : [];
  } else {
    const data = await fetchItems();
    setItems(data);
  }
  loaded = true;
}

export async function addItem(parsed: ParsedItem): Promise<void> {
  const userId = demoMode ? "" : (await getSession())!.user.id;
  const item: Item = {
    id: crypto.randomUUID(),
    user_id: userId,
    kind: parsed.kind,
    title: parsed.title,
    datetime: parsed.datetime,
    all_day: parsed.allDay ?? false,
    reminder: parsed.reminder,
    status: "pending",
    created_at: new Date().toISOString(),
    order: Date.now(),
    pinned: false,
    rating: 0
  };
  if (demoMode) {
    items = [...items, item].sort(byOrder);
    emit();
    persist();
    return;
  }
  const saved = await insertItem(item);
  items = [...items, saved].sort(byOrder);
  emit();
}

export async function toggleDone(id: string): Promise<void> {
  const it = items.find((x) => x.id === id);
  if (!it) return;
  const next = it.status === "done" ? "pending" : "done";
  if (demoMode) {
    items = items.map((x) => (x.id === id ? { ...x, status: next } : x));
    emit();
    persist();
    return;
  }
  await updateItem(id, { status: next });
  items = items.map((x) => (x.id === id ? { ...x, status: next } : x));
  emit();
}

export async function deleteItem(id: string): Promise<void> {
  if (demoMode) {
    items = items.filter((x) => x.id !== id);
    emit();
    persist();
    return;
  }
  await removeItem(id);
  items = items.filter((x) => x.id !== id);
  emit();
}

export async function reorder(orderedIds: string[]): Promise<void> {
  for (let i = 0; i < orderedIds.length; i++) {
    const it = items.find((x) => x.id === orderedIds[i]);
    if (!it || it.order === i) continue;
    if (demoMode) {
      items = items.map((x) => (x.id === orderedIds[i] ? { ...x, order: i } : x));
    } else {
      await updateItem(orderedIds[i], { order: i });
    }
  }
  items.sort(byOrder);
  emit();
  if (demoMode) persist();
}

export async function togglePin(id: string): Promise<void> {
  const it = items.find((x) => x.id === id);
  if (!it) return;
  const next = !it.pinned;
  if (demoMode) {
    items = items.map((x) => (x.id === id ? { ...x, pinned: next } : x));
    emit();
    persist();
    return;
  }
  await updateItem(id, { pinned: next });
  items = items.map((x) => (x.id === id ? { ...x, pinned: next } : x));
  emit();
}

export async function subscribeRealtime(): Promise<void> {
  if (demoMode) return;
  await subscribeToSpace(async (next) => setItems(next));
}

export async function deleteOldEvents(days: number): Promise<void> {
  const cutoff = Date.now() - days * 86400_000;
  const toDelete = items
    .filter((i) => i.kind === "event" && !i.pinned && i.datetime && new Date(i.datetime).getTime() < cutoff);
  for (const it of toDelete) {
    if (demoMode) {
      items = items.filter((x) => x.id !== it.id);
    } else {
      await removeItem(it.id);
      items = items.filter((x) => x.id !== it.id);
    }
  }
  if (demoMode) { items.sort(byOrder); emit(); persist(); }
  else emit();
}