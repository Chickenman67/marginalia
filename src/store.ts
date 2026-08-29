import { config, isDemoMode, STORAGE_KEYS } from "./config";
import type { Item, ParsedItem } from "./types";
import type { ImportRow } from "./backup";
import { fetchItems, insertItem, updateItem, removeItem, subscribeToSpace, migrateLegacyToken } from "./supabase";

const TOKEN_BYTES = 16; // 128 bits

export function genTokenPair(): { id: string; secret: string } {
  return { id: randB64(TOKEN_BYTES), secret: randB64(TOKEN_BYTES) };
}
export function combineToken(id: string, secret: string): string {
  return `${id}.${secret}`;
}
export function splitToken(token: string): { id: string; secret: string } {
  const dot = token.indexOf(".");
  if (dot === -1) return { id: token, secret: "" };
  return { id: token.slice(0, dot), secret: token.slice(dot + 1) };
}
export function isLegacyToken(token: string): boolean {
  return token.startsWith("space-");
}
function randB64(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let s = "";
  for (const b of buf) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// --- space token (persisted id.secret; legacy space-xxx triggers migration) ---
export function getSpaceToken(): string {
  const t = localStorage.getItem(STORAGE_KEYS.spaceToken);
  if (t) return t;
  const { id, secret } = genTokenPair();
  const combined = combineToken(id, secret);
  localStorage.setItem(STORAGE_KEYS.spaceToken, combined);
  return combined;
}
export function getSpaceId(): string {
  return splitToken(getSpaceToken()).id;
}
export function getSpaceSecret(): string {
  return splitToken(getSpaceToken()).secret;
}
export function setSpaceToken(id: string, secret: string): void {
  localStorage.setItem(STORAGE_KEYS.spaceToken, combineToken(id, secret));
}

// --- in-memory store, seeded from localStorage in demo mode ---
type Listener = (items: Item[]) => void;
const listeners = new Set<Listener>();

let items: Item[] = [];
let loaded = false;

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  fn(items);
  return () => listeners.delete(fn);
}
function emit() {
  listeners.forEach((fn) => fn(items));
}

function persist() {
  if (isDemoMode) localStorage.setItem("marginalia.items", JSON.stringify(items));
}

function byOrder(a: Item, b: Item) {
  return a.order - b.order || a.created_at.localeCompare(b.created_at);
}
export function setItems(next: Item[]) {
  items = next.slice().sort(byOrder);
  emit();
  persist();
}

export function getItems(): Item[] {
  return items.slice();
}

export async function importItems(rows: ImportRow[], mode: "merge" | "replace"): Promise<void> {
  const toItem = (r: ImportRow): Item => ({
    id: crypto.randomUUID(),
    space_token: getSpaceId(),
    kind: r.kind,
    title: r.title.slice(0, 200),
    datetime: r.datetime,
    all_day: r.all_day,
    reminder: r.reminder,
    status: r.status,
    created_at: new Date().toISOString(),
    order: 0,
    pinned: false
  });

  if (isDemoMode) {
    if (mode === "replace") {
      setItems(rows.map(toItem));
    } else {
      setItems([...items, ...rows.map(toItem)]);
    }
    return;
  }

  // synced mode
  if (mode === "replace") {
    for (const it of items) await removeItem(it.id);
    items = [];
  }
  for (const r of rows) {
    const saved = await insertItem(toItem(r));
    items = [...items, saved];
  }
  items.sort(byCreated);
  emit();
}

export async function loadItems(): Promise<void> {
  if (loaded) return;
  loaded = true;
  if (isDemoMode) {
    const raw = localStorage.getItem("marginalia.items");
    items = raw ? (JSON.parse(raw) as Item[]) : seed();
  } else {
    if (isLegacyToken(getSpaceToken())) {
      try {
        const { id, secret } = await migrateLegacyToken(getSpaceToken());
        setSpaceToken(id, secret);
      } catch {
        /* fall through; if RLS denies, user re-provisions via UI */
      }
    }
    items = await fetchItems();
  }
  items.sort(byCreated);
  emit();
}

export async function addItem(parsed: ParsedItem, _spaceToken: string): Promise<void> {
  const item: Item = {
    id: crypto.randomUUID(),
    space_token: getSpaceId(),
    kind: parsed.kind,
    title: parsed.title,
    datetime: parsed.datetime,
    all_day: false,
    reminder: parsed.reminder,
    status: "pending",
    created_at: new Date().toISOString(),
    order: Date.now(),
    pinned: false
  };
  if (isDemoMode) {
    items = [...items, item].sort(byCreated);
    emit();
    persist();
    return;
  }
  const saved = await insertItem(item);
  items = [...items, saved].sort(byCreated);
  emit();
}

export async function toggleDone(id: string): Promise<void> {
  const it = items.find((x) => x.id === id);
  if (!it) return;
  const next = it.status === "done" ? "pending" : "done";
  if (isDemoMode) {
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
  if (isDemoMode) {
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
    if (isDemoMode) {
      items = items.map((x) => (x.id === orderedIds[i] ? { ...x, order: i } : x));
    } else {
      await updateItem(orderedIds[i], { order: i });
    }
  }
  if (isDemoMode) { items.sort(byOrder); emit(); persist(); }
  else { items.sort(byOrder); emit(); }
}

export async function togglePin(id: string): Promise<void> {
  const it = items.find((x) => x.id === id);
  if (!it) return;
  const next = !it.pinned;
  if (isDemoMode) {
    items = items.map((x) => (x.id === id ? { ...x, pinned: next } : x));
    emit(); persist();
    return;
  }
  await updateItem(id, { pinned: next });
  items = items.map((x) => (x.id === id ? { ...x, pinned: next } : x));
  emit();
}

export async function deleteOldEvents(thresholdDays: number): Promise<void> {
  const cutoff = Date.now() - thresholdDays * 864e5;
  const toDelete = items.filter(
    (i) => i.kind === "event" && !i.pinned && i.datetime && new Date(i.datetime).getTime() < cutoff
  );
  for (const it of toDelete) {
    if (isDemoMode) {
      items = items.filter((x) => x.id !== it.id);
    } else {
      await removeItem(it.id);
      items = items.filter((x) => x.id !== it.id);
    }
  }
  if (isDemoMode) { items.sort(byOrder); emit(); persist(); }
  else emit();
}

// --- realtime hookup (no-op in demo mode) ---
export async function subscribeRealtime(): Promise<void> {
  if (isDemoMode) return;
  subscribeToSpace((incoming) => {
    items = incoming.slice().sort(byCreated);
    emit();
  });
}

function byCreated(a: Item, b: Item) {
  return a.created_at.localeCompare(b.created_at);
}

function seed(): Item[] {
  const now = Date.now();
  return [
    mk("Dentist", "event", new Date(now + 2 * 864e5).toISOString(), "demo"),
    mk("Call mom after lunch", "todo", null, "demo"),
    mk("Buy milk", "todo", null, "demo", "done")
  ];
}
function mk(title: string, kind: "todo" | "event", datetime: string | null, space: string, status: "pending" | "done" = "pending"): Item {
  return {
    id: crypto.randomUUID(),
    space_token: space,
    kind,
    title,
    datetime,
    all_day: false,
    reminder: datetime,
    status,
    created_at: new Date().toISOString(),
    order: 0,
    pinned: false
  };
}

void config;
