import { isDemoMode } from "../config";
import { addItem, getSpaceId, getSpaceToken, subscribe } from "../store";
import { parsePhrase, polishPhrase } from "../supabase";
import { createSpeech } from "../speech";
import { cardHTML, bindCardEvents, groupByDay, esc } from "./views";
import { dueItems } from "../reminders";
import type { Item, ParsedItem, DraftItem, PolishResult } from "../types";

function el<T extends HTMLElement>(sel: string): T { return document.querySelector(sel) as T; }

let draft: ParsedItem | null = null;

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
  if (!speech.supported) {
    micBtn.disabled = true;
    micBtn.title = "Voice not supported here";
    paraMic.disabled = true;
    paraMic.title = "Voice not supported here";
    hint.textContent = "Voice not supported in this browser — type instead (Enter to add)";
  } else {
    speech.onResult = (text) => { phraseEl.value = text; updatePreview(); };
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
  phraseEl.addEventListener("input", updatePreview);
  phraseEl.addEventListener("keydown", (e) => { if (e.key === "Enter") commit(); });
  el<HTMLSpanElement>("#previewX").onclick = () => { phraseEl.value = ""; preview.classList.remove("show"); draft = null; };

  async function commit() {
    const text = phraseEl.value.trim();
    if (!text) return;
    let parsed: ParsedItem;
    try {
      parsed = await parsePhrase(text);
    } catch {
      parsed = { title: text, kind: "todo", datetime: null, reminder: null };
      showNotice("AI unavailable — added as a plain note. Edit if needed.");
    }
    await addItem(parsed, getSpaceToken());
    phraseEl.value = "";
    preview.classList.remove("show");
    draft = null;
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
      const para = el<HTMLTextAreaElement>("#para");
      para.value = (para.value ? para.value + " " : "") + text;
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
    } catch {
      showNotice("AI unavailable — could not organize.");
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
      inp.oninput = () => { currentDraft[+inp.closest(".draft-row")!.getAttribute("data-idx")!].datetime = inp.value ? new Date(inp.value).toISOString() : null; };
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
      await addItem({ title: i.title, kind: i.kind, datetime: i.datetime, reminder: i.reminder }, getSpaceId());
    }
    el<HTMLTextAreaElement>("#para").value = "";
    el<HTMLDivElement>("#draft").innerHTML = "";
    currentDraft = [];
    dictateToggle.click();
  }

  const hintDefault = hint.innerHTML;
  function showNotice(msg: string) {
    hint.textContent = msg;
    hint.classList.add("notice");
    window.setTimeout(() => {
      hint.innerHTML = hintDefault;
      hint.classList.remove("notice");
    }, 4000);
  }
}

// Lightweight local guess so the UI is responsive before/without the LLM call.
function guess(text: string): ParsedItem {
  const lower = text.toLowerCase();
  const hasTime = /\d{1,2}(:\d{2})?\s*(am|pm)?|tomorrow|today|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|afternoon|morning|evening|lunch|dinner|noon|birthday/.test(lower);
  const kind = hasTime ? "event" : "todo";
  return {
    title: text.replace(/\b(tomorrow|today|at|on|my)\b/gi, "").trim().slice(0, 60) || text,
    kind,
    datetime: kind === "event" ? new Date().toISOString() : null,
    reminder: kind === "event" ? new Date().toISOString() : null
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

  subscribe((items: Item[]) => {
    const events = items.filter((i) => i.kind === "event").sort((a, b) => (a.datetime || "").localeCompare(b.datetime || ""));
    const todos = items.filter((i) => i.kind === "todo").sort((a, b) => (a.status === "done" ? 1 : 0) - (b.status === "done" ? 1 : 0));
    const due = dueItems(items);

    cSched.textContent = String(events.filter((i) => i.status !== "done").length || "");
    cTodo.textContent = String(todos.filter((i) => i.status !== "done").length || "");
    cDue.textContent = String(due.length || "");

    vSched.innerHTML = events.length ? groupByDay(events) : `<div class="empty">Nothing scheduled. Speak or type to add one.</div>`;
    vTodo.innerHTML = todos.length ? todos.map(cardHTML).join("") : `<div class="empty">No todos. Add one below.</div>`;
    vDue.innerHTML = due.length ? due.map(cardHTML).join("") : `<div class="empty">Nothing due right now.</div>`;

    bindCardEvents(vSched);
    bindCardEvents(vTodo);
    bindCardEvents(vDue);
  });

  void isDemoMode;
}

void addItem;
