import "./style.css";
import { isDemoMode } from "./config";
import { loadItems, getSpaceToken, subscribeRealtime, subscribe } from "./store";
import { mountHeader } from "./ui/header";
import { mountInput, mountViews } from "./ui/input";
import { fireNotifications, resetNotified } from "./reminders";
import type { Item } from "./types";

async function boot() {
  mountHeader();
  mountInput();
  mountViews();

  const note = document.querySelector(".demo-note");
  if (isDemoMode && note) note.textContent = "Demo mode — add VITE_SUPABASE_URL to enable sync.";
  if (!isDemoMode) note?.remove();

  await loadItems();
  await subscribeRealtime(getSpaceToken());

  // Seed the notified-set so we don't notify for items already due at load.
  subscribe((items: Item[]) => resetNotified(items.map((i) => i.id)));

  // Poll every 30s: surface newly-due items + fire browser notifications if enabled.
  setInterval(() => {
    subscribe((items: Item[]) => {
      fireNotifications(items);
    });
  }, 30000);
}

boot();
