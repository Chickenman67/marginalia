import { addItem, subscribe, deleteItem, setItems, restoreItem, permanentlyDeleteItem, editItem } from "../store";
import { parsePhrase, polishPhrase, updateItem } from "../supabase";
import { createSpeech } from "../speech";
import { cardHTML, bindCardEvents, groupByDay, esc, applyViewV2, starClickValue, type ScheduleState, type TodosState, type DueState } from "./views";
import { mountFilterPanel } from "./filterPanel";
import { openCalendar, openTimePicker } from "./calendar";
import { getSettings, subscribeSettings } from "../settings";
import { resolveSchedule, guessResolve } from "../dates";
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
  const previewTextEl = el<HTMLSpanElement>("#previewText");
  const micBtn = el<HTMLButtonElement>("#mic");
  const hint = el<HTMLDivElement>("#hint");
  const quick = el<HTMLDivElement>("#quick");
  const dictateToggle = el<HTMLButtonElement>("#dictateToggle");
  const dictatePanel = el<HTMLDivElement>("#dictate");
  const paraMic = el<HTMLButtonElement>("#paraMic");

  const speech = createSpeech();
  const addBtn = el<HTMLButtonElement>("#quickAdd");
  const mic = el<HTMLButtonElement>("#mic");
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
    previewTextEl.textContent = previewText(draft);
    preview.classList.add("show");
  }
  // Manual typing resets the voice flag — once the user touches the keyboard
  // they own the text and we don't want a stale voice flag from earlier dictation.
  phraseEl.addEventListener("input", () => { fromVoice = false; updatePreview(); });
  phraseEl.addEventListener("keydown", (e) => { if (e.key === "Enter") commit(); });
  el<HTMLButtonElement>("#quickAdd").onclick = commit;
  el<HTMLSpanElement>("#previewX").onclick = () => { fromVoice = false; phraseEl.value = ""; preview.classList.remove("show"); draft = null; };

  let pending: ParsedItem | null = null;
  function clearConfirm() {
    pending = null;
    document.getElementById("confirmWrap")?.remove();
  }
  function showConfirm(parsed: ParsedItem) {
    pending = parsed;
    document.getElementById("confirmWrap")?.remove();
    const wrapOuter = document.createElement("div");
    wrapOuter.id = "confirmWrap";
    const card = document.createElement("div");
    card.className = "confirm-card";
    wrapOuter.appendChild(card);

    const ldt = parsed.datetime ? toLocalInput(parsed.datetime) : "";
    let date = ldt ? ldt.slice(0, 10) : new Date().toISOString().slice(0, 10);
    let time = ldt ? ldt.slice(11) : "";
    if (!time) time = "09:00";
    let allDay = parsed.allDay ?? parsed.kind === "event";

    const render = () => {
      const mil = getSettings().militaryTime;
      const timeLabel = allDay ? "All day" : mil ? time : fmtAmPm(time);
      card.innerHTML = `
        <div class="confirm-title">${esc(parsed.title)}</div>
        <div class="confirm-row">
          <button type="button" class="picker-trigger" id="cfDate">${fmtDate(date)}</button>
          <button type="button" class="picker-trigger" id="cfTime" ${allDay ? "hidden" : ""}>${timeLabel}</button>
          <label class="cf-allday"><input type="checkbox" id="cfAllDay" ${allDay ? "checked" : ""} /> all day</label>
        </div>
        <div class="confirm-actions">
          <button type="button" class="btn primary" id="cfAdd">Add</button>
          <button type="button" class="btn" id="cfX">Cancel</button>
        </div>`;
      const dateBtn = card.querySelector<HTMLButtonElement>("#cfDate")!;
      dateBtn.onclick = () => openCalendar(dateBtn, date, (iso) => { date = iso; render(); });
      const timeBtn = card.querySelector<HTMLButtonElement>("#cfTime")!;
      timeBtn.onclick = () => {
        (window as any).__marginaliaMilitary = getSettings().militaryTime;
        openTimePicker(timeBtn, time, (t) => { time = t; render(); });
      };
      card.querySelector<HTMLInputElement>("#cfAllDay")!.onchange = (e) => {
        allDay = (e.target as HTMLInputElement).checked;
        render();
      };
      card.querySelector<HTMLButtonElement>("#cfAdd")!.onclick = () => {
        const iso = allDay
          ? localToISO(`${date}T00:00:00`)
          : localToISO(`${date}T${time}:00`);
        pending = { ...pending!, kind: "event", datetime: iso ?? pending!.datetime, allDay };
        void addItem(pending!).then(() => {
          clearConfirm();
          phraseEl.value = "";
          preview.classList.remove("show");
          draft = null;
          addBtn.disabled = false;
          mic.disabled = !speech.supported;
          phraseEl.disabled = false;
          addBtn.textContent = "Add";
        });
      };
      card.querySelector<HTMLButtonElement>("#cfX")!.onclick = () => {
        clearConfirm();
        updatePreview();
      };
    };
    render();
    // Place the card right below the preview bar inside the quick-add area.
    preview.insertAdjacentElement("afterend", wrapOuter);
  }

  async function commit() {
    const text = phraseEl.value.trim();
    if (!text) return;
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
    // Ambiguous implied time ("wednesday", "by morning") → let the user confirm
    // the resolved date/time before adding. Explicit cues skip this.
    if (resolveSchedule(text)) {
      showConfirm(parsed);
      addBtn.disabled = false;
      mic.disabled = !speech.supported;
      phraseEl.disabled = false;
      addBtn.textContent = "Add";
      return;
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
      await addItem({ title: i.title, kind: i.kind, datetime: i.datetime, allDay: i.allDay, reminder: i.reminder });
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
  const resolved = guessResolve(text);
  return {
    title: text.replace(/\b(tomorrow|today|at|on|my)\b/gi, "").trim().slice(0, 60) || text,
    kind: resolved ? "event" : kind,
    datetime: resolved ? resolved.datetime : kind === "event" ? new Date().toISOString() : null,
    allDay: resolved ? resolved.allDay : false,
    reminder: null
  };
}
function clock(dt: string | null): string {
  if (!dt) return "";
  const d = new Date(dt);
  return isNaN(d.getTime()) ? "" : d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
// Shared preview label: "📅 Buy milk · Wed, Sep 9 · all day".
function previewText(g: ParsedItem): string {
  const icon = g.kind === "event" ? "📅" : "☑";
  let tail = "";
  if (g.datetime) tail = " · " + (g.allDay ? `${dateLabel(g.datetime)} · all day` : clock(g.datetime));
  return `${icon} ${esc(g.title)}${tail}`;
}
function dateLabel(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}
function fmtAmPm(hhmm: string): string {
  const [hh, mm] = hhmm.split(":").map(Number);
  return `${String(((hh + 11) % 12) + 1).padStart(2, "0")}:${String(mm).padStart(2, "0")} ${hh >= 12 ? "PM" : "AM"}`;
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
  activeTab = "schedule";
  pinnedRatings = new Map();

  const vSched = el<HTMLDivElement>("#view-schedule");
  const vTodo = el<HTMLDivElement>("#view-todos");
  const vDue = el<HTMLDivElement>("#view-due");
  const vDeleted = el<HTMLDivElement>("#view-deleted");
  const cSched = el<HTMLSpanElement>("#cSched");
  const cTodo = el<HTMLSpanElement>("#cTodo");
  const cDue = el<HTMLSpanElement>("#cDue");
  const cDeleted = el<HTMLSpanElement>("#cDeleted");

  document.querySelectorAll<HTMLButtonElement>(".tab").forEach((t) => {
    t.onclick = () => {
      document.querySelectorAll(".tab").forEach((x) => x.setAttribute("aria-selected", "false"));
      t.setAttribute("aria-selected", "true");
      vSched.hidden = t.dataset.view !== "schedule";
      vTodo.hidden = t.dataset.view !== "todos";
      vDue.hidden = t.dataset.view !== "due";
      vDeleted.hidden = t.dataset.view !== "deleted";
      activeTab = t.dataset.view as "schedule" | "todos" | "due" | "deleted";
      pinnedRatings = new Map();
      if (activeTab === "todos") {
        for (const it of latestItems) {
          if (it.kind === "todo") pinnedRatings.set(it.id, it.rating);
        }
      }
      renderAll(latestItems);
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
  for (const v of [vSched, vTodo, vDue, vDeleted]) {
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
      if (txt) pText.textContent = previewText(guess(txt));
    }
  });

  function renderAll(items: Item[]) {
    if (pinnedRatings.size) {
      const live = new Set(items.map((i) => i.id));
      for (const id of [...pinnedRatings.keys()]) if (!live.has(id)) pinnedRatings.delete(id);
    }
    const activeItems = items.filter((i) => !i.deleted_at);
    const deletedItems = items.filter((i) => !!i.deleted_at);
    
    const events = applyViewV2(
      activeItems.filter((i) => i.kind === "event"),
      scheduleState,
      new Map()
    );
    const todos = applyViewV2(
      activeItems.filter((i) => i.kind === "todo"),
      todosState,
      pinnedRatings
    );
    // For the due view, the spec excludes done items. Show anything with a
    // reminder or a future datetime — applyViewV2's "week" branch decides if
    // it actually matches the active window.
    const dueNotDone = activeItems.filter((i) => i.status !== "done" && (i.reminder || i.datetime));
    const dueShown = applyViewV2(
      dueNotDone,
      dueState,
      new Map()
    );

    cSched.textContent = String(events.filter((i) => i.status !== "done").length || "");
    cTodo.textContent = String(todos.filter((i) => i.status !== "done").length || "");
    cDue.textContent = String(dueShown.length || "");
    cDeleted.textContent = String(deletedItems.length || "");

    const schedCards = vSched.querySelector<HTMLElement>(".view-cards")!;
    const todoCards = vTodo.querySelector<HTMLElement>(".view-cards")!;
    const dueCards = vDue.querySelector<HTMLElement>(".view-cards")!;
    const deletedCards = vDeleted.querySelector<HTMLElement>(".view-cards")!;
    schedCards.innerHTML = events.length ? groupByDay(events, selectable, { showPin: false }) : `<div class="empty">Nothing scheduled. Speak or type to add one.</div>`;
    todoCards.innerHTML = todos.length ? todos.map((i) => cardHTML(i, { selectable, selected: selected.has(i.id), showPin: false })).join("") : `<div class="empty">No todos. Add one below.</div>`;
    dueCards.innerHTML = dueShown.length ? dueShown.map((i) => cardHTML(i, { selectable, selected: selected.has(i.id), showPin: false })).join("") : `<div class="empty">Nothing due right now.</div>`;
    
    const settings = getSettings();
    if (settings.showDeleted) {
      deletedCards.innerHTML = deletedItems.length ? deletedItems.map((i) => {
        const daysAgo = i.deleted_at ? Math.floor((Date.now() - new Date(i.deleted_at).getTime()) / 86400000) : 0;
        return `<div class="card deleted" data-id="${i.id}">
          <div class="body">
            <div class="title">${esc(i.title)}</div>
            <div class="meta"><span class="badge">${daysAgo} day${daysAgo === 1 ? '' : 's'} ago</span></div>
          </div>
          <button class="restore" title="Restore" aria-label="Restore ${esc(i.title)}">↩️</button>
          <button class="del-permanent" title="Delete permanently" aria-label="Delete permanently ${esc(i.title)}">❌</button>
        </div>`;
      }).join("") : `<div class="empty">No deleted items.</div>`;
      
      deletedCards.querySelectorAll<HTMLButtonElement>(".restore").forEach((b) => {
        b.onclick = () => {
          const id = (b.closest(".card") as HTMLElement).dataset.id!;
          void restoreItem(id);
        };
      });
      deletedCards.querySelectorAll<HTMLButtonElement>(".del-permanent").forEach((b) => {
        b.onclick = () => {
          const id = (b.closest(".card") as HTMLElement).dataset.id!;
          if (confirm("Permanently delete this item? This cannot be undone.")) {
            void permanentlyDeleteItem(id);
          }
        };
      });
    } else {
      deletedCards.innerHTML = `<div class="empty">Deleted items are hidden. Enable in settings.</div>`;
    }

    const handleEdit = (id: string) => {
      const item = latestItems.find((i) => i.id === id);
      if (!item) return;
      showEditModal(item);
    };

    const selCtx = { selected, onChange: updateSelToolbar };
    bindCardEvents(schedCards, undefined, handleEdit, selCtx);
    bindCardEvents(todoCards, undefined, handleEdit, selCtx);
    bindCardEvents(dueCards, undefined, handleEdit, selCtx);
    bindStarEvents(todoCards, latestItems);
  }
  
  function showEditModal(item: Item) {
    const modal = document.createElement("div");
    modal.className = "back show";
    
    let isEvent = item.kind === "event";
    let pickedDate = item.datetime ? item.datetime.slice(0, 10) : new Date().toISOString().slice(0, 10);
    let pickedTime = item.datetime ? item.datetime.slice(11, 16) : "09:00";
    let allDay = item.all_day;

    const fmtDate = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    const fmtTime = (hhmm: string) => {
        const [hh, mm] = hhmm.split(":").map(Number);
        return getSettings().militaryTime ? hhmm : `${String(((hh + 11) % 12) + 1).padStart(2, "0")}:${String(mm).padStart(2, "0")} ${hh >= 12 ? "PM" : "AM"}`;
    };

    modal.innerHTML = `
      <div class="modal">
        <h2>Edit Item</h2>
        <input type="text" id="editTitle" value="${esc(item.title)}" placeholder="Title" />
        <button type="button" class="btn" id="editToggleKind">${isEvent ? "Schedule as todo" : "Schedule as event"}</button>
        <div id="editDateTimeFields" class="edit-dt-row" ${isEvent ? "" : "hidden"}>
          <button type="button" class="picker-trigger" id="editDate">${fmtDate(pickedDate)}</button>
          <button type="button" class="picker-trigger" id="editTime" ${allDay ? "hidden" : ""}>${fmtTime(pickedTime)}</button>
          <label class="all-day-toggle">
            <input type="checkbox" id="editAllDay" ${allDay ? "checked" : ""} />
            <span>All day</span>
          </label>
        </div>
        <div class="row">
          <button class="btn" id="editCancel">Cancel</button>
          <button class="btn primary" id="editSave">Save</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    
    const titleInp = modal.querySelector<HTMLInputElement>("#editTitle")!;
    const toggleKindBtn = modal.querySelector<HTMLButtonElement>("#editToggleKind")!;
    const dateTimeFields = modal.querySelector<HTMLElement>("#editDateTimeFields")!;
    const dateTrigger = modal.querySelector<HTMLButtonElement>("#editDate")!;
    const timeTrigger = modal.querySelector<HTMLButtonElement>("#editTime")!;
    const allDayCb = modal.querySelector<HTMLInputElement>("#editAllDay")!;
    
    toggleKindBtn.onclick = () => {
      isEvent = !isEvent;
      toggleKindBtn.textContent = isEvent ? "Schedule as todo" : "Schedule as event";
      dateTimeFields.hidden = !isEvent;
    };

    dateTrigger.onclick = () => openCalendar(dateTrigger, pickedDate, (iso) => {
      pickedDate = iso;
      dateTrigger.textContent = fmtDate(iso);
    });

    timeTrigger.onclick = () => {
      (window as any).__marginaliaMilitary = getSettings().militaryTime;
      openTimePicker(timeTrigger, pickedTime, (t) => { pickedTime = t; timeTrigger.textContent = fmtTime(t); });
    };

    allDayCb.onchange = () => {
      allDay = allDayCb.checked;
      timeTrigger.hidden = allDay;
    };
    
    modal.querySelector("#editCancel")!.addEventListener("click", () => modal.remove());
    modal.querySelector("#editSave")!.addEventListener("click", async () => {
      const newTitle = titleInp.value.trim();
      if (!newTitle) return;
      
      const kind = isEvent ? "event" : "todo";
      let datetime: string | null = null;
      let all_day = false;
      
      if (kind === "event") {
        const timeStr = allDay ? "00:00" : (pickedTime || "09:00");
        datetime = localToISO(`${pickedDate}T${timeStr}`);
        all_day = allDay;
      }
      
      await editItem(item.id, { title: newTitle, kind, datetime, all_day, reminder: item.reminder });
      modal.remove();
    });
    
    modal.onclick = (e) => {
      if (e.target === modal) modal.remove();
    };
  }
}

let activeTab: "schedule" | "todos" | "due" | "deleted" = "schedule";
let pinnedRatings: Map<string, number> = new Map();

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

export function bindStarEvents(host: HTMLElement, items: Item[]) {
  host.querySelectorAll<HTMLElement>(".stars").forEach((row) => {
    let isDragging = false;
    let lastValue = 0;
    
    const updateHover = (clientX: number, clientY: number, targetEl?: Element | null): number => {
      if (host.querySelector(".card.selected")) return 0;
      const stars = Array.from(row.querySelectorAll<HTMLElement>(".star"));
      const starEl = (targetEl instanceof Element ? targetEl.closest<HTMLElement>(".star") : undefined) ??
        stars.find((el) => {
          const r = el.getBoundingClientRect();
          return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
        });
      if (!starEl) return 0;
      const pos = Number(starEl.dataset.pos);
      // Prefer the event target's own geometry; fall back to a NaN offset
      // (whole-zone) when layout geometry is unavailable (e.g. jsdom tests).
      const rect = starEl.getBoundingClientRect();
      const offsetX = rect.width > 0 ? clientX - rect.left : NaN;
      const value = starHoverValue(pos, offsetX, starEl.clientWidth);
      row.dataset.hover = String(value);
      const tip = row.querySelector<HTMLElement>(".tip");
      if (tip) {
        const id = row.dataset.item;
        const it = id !== undefined ? items.find((x) => x.id === id) : undefined;
        tip.textContent = (it && value === it.rating) ? "Clear" : String(value);
      }
      return value;
    };
    
    const handleMove = (clientX: number, clientY: number, targetEl?: Element | null) => {
      const value = updateHover(clientX, clientY, targetEl);
      if (isDragging && value > 0 && value !== lastValue) {
        lastValue = value;
        const id = row.dataset.item!;
        const it = items.find((x) => x.id === id);
        if (it) {
          void setRating(id, value, items);
        }
      }
    };
    
    row.addEventListener("mouseleave", () => {
      isDragging = false;
      if (row.dataset.hover !== undefined) delete row.dataset.hover;
    });
    
    row.addEventListener("mousedown", (e) => {
      if (host.querySelector(".card.selected")) return;
      isDragging = true;
      const me = e as MouseEvent;
      lastValue = updateHover(me.clientX, me.clientY);
    });
    
    row.addEventListener("mouseup", () => {
      isDragging = false;
    });
    
    row.addEventListener("touchstart", (e) => {
      if (host.querySelector(".card.selected")) return;
      isDragging = true;
      const te = e as TouchEvent;
      const touch = te.touches[0];
      lastValue = updateHover(touch.clientX, touch.clientY);
    }, { passive: true });
    
    row.addEventListener("touchmove", (e) => {
      if (host.querySelector(".card.selected")) return;
      const te = e as TouchEvent;
      const touch = te.touches[0];
      handleMove(touch.clientX, touch.clientY);
    }, { passive: true });
    
    row.addEventListener("touchend", () => {
      isDragging = false;
      if (row.dataset.hover !== undefined) delete row.dataset.hover;
    });
    
    row.querySelectorAll<HTMLElement>(".star").forEach((starEl) => {
      starEl.addEventListener("mousemove", (e) => {
        const me = e as MouseEvent;
        handleMove(me.clientX, me.clientY, e.target as Element | null);
      });
      starEl.addEventListener("mouseleave", () => {
        if (!isDragging && row.dataset.hover !== undefined) delete row.dataset.hover;
      });
      starEl.addEventListener("click", async (e) => {
        if (host.querySelector(".card.selected")) return;
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
