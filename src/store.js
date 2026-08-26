import { config, isDemoMode, STORAGE_KEYS } from "./config";
import { fetchItems, insertItem, updateItem, removeItem, subscribeToSpace } from "./supabase";
// --- space token (persisted, reused across devices) ---
export function getSpaceToken() {
    let t = localStorage.getItem(STORAGE_KEYS.spaceToken);
    if (!t) {
        t = "space-" + crypto.randomUUID().slice(0, 12);
        localStorage.setItem(STORAGE_KEYS.spaceToken, t);
    }
    return t;
}
export function setSpaceToken(t) {
    localStorage.setItem(STORAGE_KEYS.spaceToken, t);
}
const listeners = new Set();
let items = [];
let loaded = false;
export function subscribe(fn) {
    listeners.add(fn);
    fn(items);
    return () => listeners.delete(fn);
}
function emit() {
    listeners.forEach((fn) => fn(items));
}
function persist() {
    if (isDemoMode)
        localStorage.setItem("marginalia.items", JSON.stringify(items));
}
export function setItems(next) {
    items = next.slice().sort(byCreated);
    emit();
    persist();
}
export async function loadItems() {
    if (loaded)
        return;
    loaded = true;
    if (isDemoMode) {
        const raw = localStorage.getItem("marginalia.items");
        items = raw ? JSON.parse(raw) : seed();
    }
    else {
        items = await fetchItems();
    }
    items.sort(byCreated);
    emit();
}
export async function addItem(parsed, spaceToken) {
    const item = {
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
export async function toggleDone(id) {
    const it = items.find((x) => x.id === id);
    if (!it)
        return;
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
export async function deleteItem(id) {
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
export async function subscribeRealtime(spaceToken) {
    if (isDemoMode)
        return;
    subscribeToSpace(spaceToken, (incoming) => {
        items = incoming.slice().sort(byCreated);
        emit();
    });
}
function byCreated(a, b) {
    return a.created_at.localeCompare(b.created_at);
}
function seed() {
    const now = Date.now();
    return [
        mk("Dentist", "event", new Date(now + 2 * 864e5).toISOString(), "demo"),
        mk("Call mom after lunch", "todo", null, "demo"),
        mk("Buy milk", "todo", null, "demo", "done")
    ];
}
function mk(title, kind, datetime, space, status = "pending") {
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
