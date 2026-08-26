import { config, isDemoMode, STORAGE_KEYS } from "./config";
import type { Item, ParsedItem } from "./types";
import { fetchItems, insertItem, updateItem, removeItem, subscribeToSpace } from "./supabase";

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

export function setItems(next: Item[]) {
  items = next.slice().sort(byCreated);
  emit();
  persist();
}

export async function loadItems(): Promise<void> {
  if (loaded) return;
  loaded = true;
  if (isDemoMode) {
    const raw = localStorage.getItem("marginalia.items");
    items = raw ? (JSON.parse(raw) as Item[]) : seed();
  } else {
    items = await fetchItems();
  }
  items.sort(byCreated);
  emit();
}

export async function addItem(parsed: ParsedItem, spaceToken: string): Promise<void> {
  const item: Item = {
    id: crypto.randomUUID(),
    space_token: spaceToken,
    kind: parsed.kind,
    title: parsed.title,
    datetime: parsed.datetime,
    all_day: false,
    reminder: parsed.reminder,
    status: "pending",
    created_at: new Date().toISOString()
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

// --- realtime hookup (no-op in demo mode) ---
export async function subscribeRealtime(spaceToken: string): Promise<void> {
  if (isDemoMode) return;
  subscribeToSpace(spaceToken, (incoming) => {
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
    created_at: new Date().toISOString()
  };
}

void config;
