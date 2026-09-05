import { addItem, subscribe, deleteItem, setItems } from "../store";
import { parsePhrase, polishPhrase, updateItem } from "../supabase";
import { createSpeech } from "../speech";
import { cardHTML, bindCardEvents, groupByDay, esc, applyViewV2, getPinnedRatings, starClickValue, type ScheduleState, type TodosState, type DueState } from "./views";
import { mountFilterPanel } from "./filterPanel";
import { openCalendar, openTimePicker } from "./calendar";
import { getSettings, formatClock, subscribeSettings } from "../settings";
import type { Item, ParsedItem, DraftItem, PolishResult } from "../types";

function el<T extends HTMLElement>(sel: string): T { return document.querySelector(sel) as T; }

let draft: ParsedItem | null = null;

function showNotice(msg: string) {
  const hint = el<HTMLDivElement>("#hint");
  if (!hint) return;
  const orig = hint.innerHTML;
  hint.textContent = msg;
  hint.classList.add("notice");
  window.setTimeout(() => {
    hint.innerHTML = orig;
    hint.classList.remove("notice");
  }, 4000);
}

export function mountInput(): void {
  const phraseEl = el<HTMLInputElement>("#phrase");
  const preview = el<HTMLDivElement>("#preview");
  const previewText = el<HTMLSpanElement>("#previewText");
  const micBtn = el<HTMLButtonElement>("#mic");
  const hint = el<HTMLDivElement>("#hint");
  const quick = el<HTMLDivElement>("#quick");
  const dictateToggle = el<HTMLButtonElement>("#dictateToggle");
  const dictatePanel = el<HTMLDivElement>("#dictate");
  const paraMic = el<HTMLButtonElement>("#paraMic");

  const speech = createSpeech();
  // Track where the latest text in the input came from. The dictation path
  // hits the LLM (voice transcription is messy; LLM cleans it up). Manual
  // typing skips the LLM and adds instantly with the local guess — typing is
  // already structured input, so a network round-trip just adds latency.
  let fromVoice = false;
  if (!speech.supported) {
    micBtn.disabled = true;
    micBtn.title = "Voice not supported here";
    paraMic.disabled = true;
    paraMic.title = "Voice not supported here";
    hint.textContent = "Voice not supported in this browser — type instead (Enter to add)";
  } else {
    speech.onResult = (text) => { fromVoice = true; phraseEl.value = text; updatePreview(); };
    speech.onState = (l) => micBtn.classList.toggle("listening", l);
    micBtn.onclick = () => (micBtn.classList.contains("listening") ? speech.stop() : speech.start());
  }

  function updatePreview() {
    const text = phraseEl.value.trim();
    if (!text) { preview.classList.remove("show"); draft = null; return; }
    draft = guess(text);
    previewText.textContent = `${draft.kind === "event" ? "📅" : "☑"} ${esc(draft.title)}${draft.datetime ? " · " + clock(draft.datetime) : ""}`;
    preview.classList.add("show");
  }
  // Manual typing resets the voice flag — once the user touches the keyboard
  // they own the text and we don't want a stale voice flag from earlier dictation.
  phraseEl.addEventListener("input", () => { fromVoice = false; updatePreview(); });
  phraseEl.addEventListener("keydown", (e) => { if (e.key === "Enter") commit(); });
  el<HTMLButtonElement>("#quickAdd").onclick = commit;
  el<HTMLSpanElement>("#previewX").onclick = () => { fromVoice = false; phraseEl.value = ""; preview.classList.remove("show"); draft = null; };

  async function commit() {
    const text = phraseEl.value.trim();
    if (!text) return;
    const addBtn = el<HTMLButtonElement>("#quickAdd");
    const mic = el<HTMLButtonElement>("#mic");
    addBtn.disabled = true;
    mic.disabled = true;
    phraseEl.disabled = true;
    addBtn.textContent = "…";
    const useLLM = fromVoice;
    fromVoice = false; // consume the flag so a second Enter doesn't re-trigger LLM
    let parsed: ParsedItem;
    if (useLLM) {
      try {
        parsed = await parsePhrase(text);
        // Guard against the LLM returning a blank or whitespace title — fall
        // back to the raw input so the user never sees an empty card.
        if (!parsed.title || !parsed.title.trim()) parsed = { ...parsed, title: text };
      } catch (err) {
        parsed = { title: text, kind: "todo", datetime: null, reminder: null };
        showNotice(`AI unavailable — added as a plain note. (${err instanceof Error ? err.message : "error"})`);
      }
    } else {
      parsed = guess(text);
    }
    await addItem(parsed);
    phraseEl.value = "";
    preview.classList.remove("show");
    draft = null;
    addBtn.disabled = false;
    mic.disabled = !speech.supported;
    phraseEl.disabled = false;
    addBtn.textContent = "Add";
  }

  // --- Dictate mode ---
  let dictateSpeech = createSpeech();
  dictateToggle.onclick = () => {
    const on = dictatePanel.hidden;
    dictatePanel.hidden = !on;
    quick.hidden = on;
    dictateToggle.setAttribute("aria-pressed", String(on));
    dictateToggle.textContent = on ? "Quick add" : "Dictate";
  };

  if (speech.supported) {
    dictateSpeech.onResult = (text) => {
      // speech.ts already sends the full accumulated transcript on every event.
      el<HTMLTextAreaElement>("#para").value = text;
    };
    dictateSpeech.onState = (l) => paraMic.classList.toggle("listening", l);
    paraMic.onclick = () => (paraMic.classList.contains("listening") ? dictateSpeech.stop() : dictateSpeech.start());
  }

  el<HTMLButtonElement>("#process").onclick = processParagraph;

  async function processParagraph() {
    const para = el<HTMLTextAreaElement>("#para").value.trim();
    if (!para) return;
    let result: PolishResult;
    try {
      result = await polishPhrase(para);
    } catch (err) {
      showNotice(`AI unavailable — ${err instanceof Error ? err.message : "could not organize"}`);
      return;
    }
    renderDraft(result.items);
  }

  let currentDraft: DraftItem[] = [];

  function renderDraft(items: DraftItem[]) {
    currentDraft = items.map((i) => ({ ...i }));
    const draftEl = el<HTMLDivElement>("#draft");
    const events = currentDraft.map((i, idx) => ({ i, idx })).filter((x) => x.i.kind === "event");
    const todos = currentDraft.map((i, idx) => ({ i, idx })).filter((x) => x.i.kind === "todo");

    const row = (i: DraftItem, idx: number) => `
      <div class="draft-row" data-idx="${idx}">
        <input class="draft-title" value="${esc(i.title)}" aria-label="Title" />
        ${i.kind === "event" ? `<input type="datetime-local" class="draft-dt" value="${toLocalInput(i.datetime)}" aria-label="When" />` : ""}
        <button class="draft-move" title="Toggle todo/event">${i.kind === "event" ? "→ todo" : "→ event"}</button>
        <button class="draft-del" title="Remove">✕</button>
      </div>`;

    draftEl.innerHTML = `
      <div class="draft-group"><h4>Schedule</h4>${events.length ? events.map((x) => row(x.i, x.idx)).join("") : `<div class="empty">No events</div>`}</div>
      <div class="draft-group"><h4>Todos</h4>${todos.length ? todos.map((x) => row(x.i, x.idx)).join("") : `<div class="empty">No todos</div>`}</div>
      <button class="btn primary" id="addAll">Add all</button>`;

    draftEl.querySelectorAll<HTMLInputElement>(".draft-title").forEach((inp) => {
      inp.oninput = () => { currentDraft[+inp.closest(".draft-row")!.getAttribute("data-idx")!].title = inp.value; };
    });
    draftEl.querySelectorAll<HTMLInputElement>(".draft-dt").forEach((inp) => {
      inp.oninput = () => { currentDraft[+inp.closest(".draft-row")!.getAttribute("data-idx")!].datetime = inp.value ? localToISO(inp.value) : null; };
    });
    draftEl.querySelectorAll<HTMLButtonElement>(".draft-move").forEach((b) => {
      b.onclick = () => {
        const idx = +b.closest(".draft-row")!.getAttribute("data-idx")!;
        currentDraft[idx].kind = currentDraft[idx].kind === "event" ? "todo" : "event";
        if (currentDraft[idx].kind === "todo") currentDraft[idx].datetime = null;
        renderDraft(currentDraft);
      };
    });
    draftEl.querySelectorAll<HTMLButtonElement>(".draft-del").forEach((b) => {
      b.onclick = () => {
        const idx = +b.closest(".draft-row")!.getAttribute("data-idx")!;
        currentDraft.splice(idx, 1);
        renderDraft(currentDraft);
      };
    });
    el<HTMLButtonElement>("#addAll").onclick = addAll;
  }

  async function addAll() {
    for (const i of currentDraft) {
      await addItem({ title: i.title, kind: i.kind, datetime: i.datetime, reminder: i.reminder });
    }
    el<HTMLTextAreaElement>("#para").value = "";
    el<HTMLDivElement>("#draft").innerHTML = "";
    currentDraft = [];
    dictateToggle.click();
  }
}

// Lightweight local guess so the UI is responsive before/without the LLM call.
function guess(text: string): ParsedItem {
  const lower = text.toLowerCase();
  const hasTime = /\b\d{1,2}:\d{2}\s*(am|pm)?\b|\b\d{1,2}\s*(am|pm)\b|\btomorrow\b|\btoday\b|\btonight\b|\bmonday\b|\btuesday\b|\bwednesday\b|\bthursday\b|\bfriday\b|\bsaturday\b|\bsunday\b|\bnext week\b|\bafternoon\b|\bmorning\b|\bevening\b|\blunch\b|\bdinner\b|\bnoon\b|\bbirthday\b/.test(lower);
  const kind = hasTime ? "event" : "todo";
  return {
    title: text.replace(/\b(tomorrow|today|at|on|my)\b/gi, "").trim().slice(0, 60) || text,
    kind,
    datetime: kind === "event" ? new Date().toISOString() : null,
    reminder: null
  };
}
function clock(dt: string | null): string {
  if (!dt) return "";
  const d = new Date(dt);
  return isNaN(d.getTime()) ? "" : d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
function toLocalInput(dt: string | null): string {
  if (!dt) return "";
  const d = new Date(dt);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Interpret a local wall-clock string ("YYYY-MM-DDTHH:MM") as the user's LOCAL
// time, not UTC. `new Date("2026-08-28T15:00")` would treat it as UTC and shift
// the stored time by the timezone offset — this pins it to local wall clock.
function localToISO(s: string): string | null {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const [, y, mo, d, h, mi, se] = m;
  const dt = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(se || 0), 0);
  if (isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

export function mountViews(): void {
  const vSched = el<HTMLDivElement>("#view-schedule");
  const vTodo = el<HTMLDivElement>("#view-todos");
  const vDue = el<HTMLDivElement>("#view-due");
  const cSched = el<HTMLSpanElement>("#cSched");
  const cTodo = el<HTMLSpanElement>("#cTodo");
  const cDue = el<HTMLSpanElement>("#cDue");

  document.querySelectorAll<HTMLButtonElement>(".tab").forEach((t) => {
    t.onclick = () => {
      document.querySelectorAll(".tab").forEach((x) => x.setAttribute("aria-selected", "false"));
      t.setAttribute("aria-selected", "true");
      vSched.hidden = t.dataset.view !== "schedule";
      vTodo.hidden = t.dataset.view !== "todos";
      vDue.hidden = t.dataset.view !== "due";
    };
  });

  // Per-view state (initial defaults; user changes flow through onChange).
  const scheduleState: ScheduleState = { search: "", filters: { timeRange: "all", status: "all" }, sort: "date", dir: "asc" };
  const todosState: TodosState = { search: "", filters: { priority: "all", status: "all" }, sort: "priority", dir: "desc" };
  const dueState: DueState = { search: "", filters: { dueWindow: "week", kind: "all" }, sort: "date", dir: "asc" };

  // Each view gets a top "bar" (filter pill + panel) and a "cards" container
  // (rendered by renderAll). The bar is not touched by re-renders. mountViews
  // can be called more than once (e.g. on auth state change), so we wipe any
  // previously injected children first — otherwise 4 "Filter & sort" pills
  // pile up in each view.
  for (const v of [vSched, vTodo, vDue]) {
    v.querySelectorAll(".view-bar, .view-cards").forEach((c) => c.remove());
    const bar = document.createElement("div");
    bar.className = "view-bar";
    const cards = document.createElement("div");
    cards.className = "view-cards";
    v.appendChild(bar);
    v.appendChild(cards);
  }

  // Inject a filter pill + panel into each view's bar (bar survives renderAll's innerHTML wipe)
  mountFilterPanel({ viewKey: "schedule", initial: scheduleState, host: vSched.querySelector<HTMLElement>(".view-bar")!, onChange: (s) => { Object.assign(scheduleState, s); renderAll(latestItems); } });
  mountFilterPanel({ viewKey: "todos", initial: todosState, host: vTodo.querySelector<HTMLElement>(".view-bar")!, onChange: (s) => { Object.assign(todosState, s); renderAll(latestItems); } });
  mountFilterPanel({ viewKey: "due", initial: dueState, host: vDue.querySelector<HTMLElement>(".view-bar")!, onChange: (s) => { Object.assign(dueState, s); renderAll(latestItems); } });

  // Selection mode
  const selected = new Set<string>();
  // Idempotency: remove any toolbar from a prior mountViews() call before
  // appending a fresh one. Otherwise every auth-state bump adds another toolbar.
  document.querySelectorAll(".sel-toolbar").forEach((el) => el.remove());
  const toolbar = document.createElement("div");
  toolbar.className = "sel-toolbar";
  toolbar.innerHTML = `<span class="count">0 selected</span>
    <span class="bulk-delete-wrap">
      <button class="btn bulk-delete-btn" id="selDelete" type="button">Delete selected (0) ▾</button>
    </span>
    <button class="btn" id="selCancel" type="button">Cancel</button>`;
  document.body.appendChild(toolbar);
  const selBtn = document.createElement("button");
  selBtn.className = "btn toggle";
  selBtn.id = "selMode";
  selBtn.textContent = "Select";
  // Attach Select button into each panel's sort row so it follows the pill.
  // Remove any previously injected Select buttons (left over from prior
  // mountViews calls) before injecting a fresh one, so we end up with exactly
  // one per panel.
  document.querySelectorAll(".filter-panel .sort-row button.toggle").forEach((b) => {
    if (b.id !== "selMode") b.remove();
  });
  document.querySelectorAll(".filter-panel .sort-row").forEach((row) => {
    if (row.querySelector("button.toggle")) return;
    const clone = selBtn.cloneNode(true) as HTMLButtonElement;
    clone.id = "";
    row.appendChild(clone);
    clone.onclick = () => selBtn.click();
  });
  // One canonical handler that all clones share via delegation
  let selectable = false;
  const updateSelToolbar = () => {
    toolbar.classList.toggle("show", selectable);
    toolbar.querySelector(".count")!.textContent = `${selected.size} selected`;
    toolbar.querySelector("#selDelete")!.textContent = `Delete selected (${selected.size}) ▾`;
  };
  const toggleSelect = () => {
    selectable = !selectable;
    selected.clear();
    selBtn.textContent = selectable ? "Done selecting" : "Select";
    document.querySelectorAll<HTMLButtonElement>(".filter-panel .sort-row button.toggle").forEach((b) => {
      b.textContent = selectable ? "Done selecting" : "Select";
    });
    renderAll(latestItems);
    updateSelToolbar();
  };
  selBtn.onclick = toggleSelect;
  toolbar.querySelector("#selCancel")!.addEventListener("click", () => {
    selectable = false;
    selected.clear();
    selBtn.textContent = "Select";
    renderAll(latestItems);
    updateSelToolbar();
  });
  // Bulk delete dropdown
  const deleteBtn = toolbar.querySelector<HTMLButtonElement>("#selDelete")!;
  let popOpen = false;
  const closePop = () => { popOpen = false; existingPop?.remove(); existingPop = null; };
  let existingPop: HTMLElement | null = null;
  deleteBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (popOpen) { closePop(); return; }
    popOpen = true;
    const pop = document.createElement("div");
    pop.className = "bulk-delete-pop";
    pop.innerHTML = `
      <button type="button" class="danger" data-act="go">Delete ${selected.size} item${selected.size === 1 ? "" : "s"}</button>
      <button type="button" data-act="cancel">Cancel</button>
    `;
    deleteBtn.parentElement!.appendChild(pop);
    existingPop = pop;
    pop.querySelector<HTMLButtonElement>("[data-act='go']")!.onclick = () => {
      [...selected].forEach((id) => deleteItem(id));
      selected.clear();
      closePop();
      selectable = false;
      selBtn.textContent = "Select";
      renderAll(latestItems);
      updateSelToolbar();
    };
    pop.querySelector<HTMLButtonElement>("[data-act='cancel']")!.onclick = closePop;
  });
  document.addEventListener("click", (e) => {
    if (popOpen && existingPop && !existingPop.contains(e.target as Node) && !deleteBtn.contains(e.target as Node)) closePop();
  });

  let latestItems: Item[] = [];
  subscribe((items: Item[]) => { latestItems = items; renderAll(items); });

  subscribeSettings(() => {
    renderAll(latestItems);
    syncTimeTrigger();
    const pBox = el<HTMLDivElement>("#preview");
    const pText = el<HTMLSpanElement>("#previewText");
    const phrase = el<HTMLInputElement>("#phrase");
    if (pBox && pText && phrase && pBox.classList.contains("show")) {
      const txt = phrase.value.trim();
      if (txt) {
        const g = guess(txt);
        const mark = g.kind === "event" ? "[E]" : "[ ]";
        pText.textContent = `${mark} ${esc(g.title)}${g.datetime ? " · " + formatClock(g.datetime) : ""}`;
      }
    }
  });

  function renderAll(items: Item[]) {
    const events = applyViewV2(
      items.filter((i) => i.kind === "event"),
      scheduleState,
      getPinnedRatings(vSched)
    );
    const todos = applyViewV2(
      items.filter((i) => i.kind === "todo"),
      todosState,
      getPinnedRatings(vTodo)
    );
    // For the due view, the spec excludes done items. Show anything with a
    // reminder or a future datetime — applyViewV2's "week" branch decides if
    // it actually matches the active window.
    const dueNotDone = items.filter((i) => i.status !== "done" && (i.reminder || i.datetime));
    const dueShown = applyViewV2(
      dueNotDone,
      dueState,
      getPinnedRatings(vDue)
    );

    cSched.textContent = String(events.filter((i) => i.status !== "done").length || "");
    cTodo.textContent = String(todos.filter((i) => i.status !== "done").length || "");
    cDue.textContent = String(dueShown.length || "");

    const schedCards = vSched.querySelector<HTMLElement>(".view-cards")!;
    const todoCards = vTodo.querySelector<HTMLElement>(".view-cards")!;
    const dueCards = vDue.querySelector<HTMLElement>(".view-cards")!;
    schedCards.innerHTML = events.length ? groupByDay(events, selectable) : `<div class="empty">Nothing scheduled. Speak or type to add one.</div>`;
    todoCards.innerHTML = todos.length ? todos.map((i) => cardHTML(i, { selectable, selected: selected.has(i.id), showPin: false })).join("") : `<div class="empty">No todos. Add one below.</div>`;
    dueCards.innerHTML = dueShown.length ? dueShown.map((i) => cardHTML(i, { selectable, selected: selected.has(i.id), showPin: i.kind === "event" })).join("") : `<div class="empty">Nothing due right now.</div>`;

    const selCtx = { selected, onChange: updateSelToolbar };
    bindCardEvents(schedCards, undefined, selCtx);
    bindCardEvents(todoCards, undefined, selCtx);
    bindCardEvents(dueCards, undefined, selCtx);
    bindStarEvents(todoCards, latestItems);
  }
}

// --- Manual Schedule entry with a calendar popover + time picker ---
const form = el<HTMLFormElement>("#addEvent");
const dateTrigger = el<HTMLButtonElement>("#evDate");
const timeTrigger = el<HTMLButtonElement>("#evTimeTrigger");
const allDayInp = el<HTMLInputElement>("#evAllDay");
let pickedDate = new Date().toISOString().slice(0, 10);
let pickedTime = "";
const fmtDate = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
dateTrigger.textContent = fmtDate(pickedDate);
dateTrigger.onclick = () => openCalendar(dateTrigger, pickedDate, (iso) => {
  pickedDate = iso;
  dateTrigger.textContent = fmtDate(iso);
});
const syncTimeTrigger = () => {
  if (allDayInp.checked) { timeTrigger.textContent = "All day"; return; }
  if (!pickedTime) { timeTrigger.textContent = "Time"; return; }
  const [hh, mm] = pickedTime.split(":").map(Number);
  timeTrigger.textContent = getSettings().militaryTime
    ? pickedTime
    : `${String(((hh + 11) % 12) + 1).padStart(2, "0")}:${String(mm).padStart(2, "0")} ${hh >= 12 ? "PM" : "AM"}`;
};
timeTrigger.onclick = () => {
  if (allDayInp.checked) return;
  (window as any).__marginaliaMilitary = getSettings().militaryTime;
  openTimePicker(timeTrigger, pickedTime || "09:00", (t) => { pickedTime = t; syncTimeTrigger(); });
};
allDayInp.onchange = syncTimeTrigger;
syncTimeTrigger();

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = el<HTMLInputElement>("#evTitle").value.trim();
  if (!title) return;
  const allDay = allDayInp.checked;
  const when = allDay ? `${pickedDate}T00:00:00` : `${pickedDate}T${pickedTime || "09:00"}:00`;
  const iso = localToISO(when);
  if (!iso) return;
  await addItem({ title, kind: "event", datetime: iso, reminder: null });
  el<HTMLInputElement>("#evTitle").value = "";
});

async function setRating(id: string, rating: number, items: Item[]) {
  const it = items.find((x) => x.id === id);
  if (!it) return;
  const previous = it.rating;
  const local = items.map((x) => (x.id === id ? { ...x, rating } : x));
  setItems(local);
  try {
    await updateItem(id, { rating });
  } catch (err) {
    setItems(items.map((x) => (x.id === id ? { ...x, rating: previous } : x)));
    showNotice("Couldn't save rating — try again.");
  }
}

// Compute the rating value a star hover should preview, given the star's
// position (1..5) and the cursor's offsetX within the star element.
// Exported so the hover preview logic can be unit-tested.
export function starHoverValue(pos: number, offsetX: number, starWidth: number): number {
  const zone: "half" | "whole" = offsetX < starWidth / 2 ? "half" : "whole";
  return zone === "whole" ? pos : pos - 0.5;
}

function bindStarEvents(host: HTMLElement, items: Item[]) {
  host.querySelectorAll<HTMLElement>(".stars").forEach((row) => {
    row.querySelectorAll<HTMLElement>(".star").forEach((starEl) => {
      starEl.addEventListener("mousemove", (e) => {
        if (host.querySelector(".card.selected")) return; // selection mode
        const pos = Number(starEl.dataset.pos);
        const me = e as MouseEvent;
        row.dataset.hover = String(starHoverValue(pos, me.offsetX, starEl.clientWidth));
      });
      starEl.addEventListener("mouseleave", () => {
        if (row.dataset.hover !== undefined) delete row.dataset.hover;
      });
      starEl.addEventListener("click", async (e) => {
        if (host.querySelector(".card.selected")) return; // selection mode
        e.stopPropagation();
        const id = row.dataset.item!;
        const pos = Number(starEl.dataset.pos);
        const it = items.find((x) => x.id === id);
        if (!it) return;
        const zone: "half" | "whole" = (e as MouseEvent).offsetX < starEl.clientWidth / 2 ? "half" : "whole";
        const next = starClickValue(pos, zone, it.rating, (e as MouseEvent).shiftKey);
        if (next === it.rating) return;
        await setRating(id, next, items);
      });
    });
  });
}
