// Theme-matched calendar + time popover used by the manual Schedule entry form.
// Mounts a popover next to a trigger button; calls onPicked with "YYYY-MM-DD" / "HH:MM".

let openPop: HTMLElement | null = null;

function closePop() {
  if (openPop) {
    openPop.remove();
    openPop = null;
    document.removeEventListener("keydown", onEsc);
    document.removeEventListener("click", onDocClick, true);
  }
}
function onEsc(e: KeyboardEvent) { if (e.key === "Escape") closePop(); }
function onDocClick(e: MouseEvent) {
  if (openPop && !openPop.contains(e.target as Node) && !(e.target as HTMLElement).closest(".picker-trigger")) {
    closePop();
  }
}

function mountPop(trigger: HTMLElement, pop: HTMLElement) {
  closePop();
  pop.classList.add("pop");
  document.body.appendChild(pop);
  const r = trigger.getBoundingClientRect();
  pop.style.top = `${Math.min(window.innerHeight - pop.offsetHeight - 8, r.bottom + 6)}px`;
  pop.style.left = `${Math.min(Math.max(8, r.left), window.innerWidth - pop.offsetWidth - 8)}px`;
  openPop = pop;
  setTimeout(() => {
    document.addEventListener("keydown", onEsc);
    document.addEventListener("click", onDocClick, true);
  }, 0);
}

export function openCalendar(trigger: HTMLElement, initial: string, onPicked: (isoDate: string) => void) {
  const pop = document.createElement("div");
  let view = initial ? new Date(initial + "T00:00:00") : new Date();
  view = new Date(view.getFullYear(), view.getMonth(), 1);
  const sel = initial;

  const render = () => {
    const y = view.getFullYear();
    const m = view.getMonth();
    const monthName = view.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    const first = new Date(y, m, 1).getDay();
    const days = new Date(y, m + 1, 0).getDate();
    let cells = "";
    for (let i = 0; i < first; i++) cells += `<span class="pop-day empty"></span>`;
    for (let d = 1; d <= days; d++) {
      const iso = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const cls = iso === sel ? "pop-day sel" : "pop-day";
      cells += `<button type="button" class="${cls}" data-iso="${iso}">${d}</button>`;
    }
    pop.innerHTML = `
      <div class="pop-head">
        <button type="button" class="pop-nav" data-dir="-1" aria-label="Previous month">‹</button>
        <span class="pop-title">${monthName}</span>
        <button type="button" class="pop-nav" data-dir="1" aria-label="Next month">›</button>
      </div>
      <div class="pop-grid">
        ${["S", "M", "T", "W", "T", "F", "S"].map((w) => `<span class="pop-wk">${w}</span>`).join("")}
        ${cells}
      </div>`;
    pop.querySelectorAll<HTMLButtonElement>(".pop-nav").forEach((b) =>
      (b.onclick = (e) => { e.stopPropagation(); view = new Date(y, m + Number(b.dataset.dir), 1); render(); })
    );
    pop.querySelectorAll<HTMLButtonElement>(".pop-day:not(.empty)").forEach((b) =>
      (b.onclick = (e) => { e.stopPropagation(); onPicked(b.dataset.iso!); closePop(); })
    );
  };
  render();
  mountPop(trigger, pop);
}

export function openTimePicker(trigger: HTMLElement, initial: string, onPicked: (hhmm: string) => void) {
  const pop = document.createElement("div");
  let h = 9, m = 0;
  if (/^\d{2}:\d{2}$/.test(initial)) { h = Number(initial.slice(0, 2)); m = Number(initial.slice(3, 5)); }
  const readout = () => { pop.querySelector<HTMLElement>(".time-read")!.textContent = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`; };
  const render = () => {
    pop.innerHTML = `
      <div class="pop-head"><span class="pop-title">Time</span></div>
      <div class="time-wrap">
        <div class="wheel" id="tcHour"></div>
        <span class="wheel-sep">:</span>
        <div class="wheel" id="tcMin"></div>
      </div>
      <div class="time-foot">
        <span class="time-read">${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}</span>
        <button type="button" class="btn primary" id="tcOk">Set</button>
      </div>`;
    const pad = (n: number) => String(n).padStart(2, "0");
    const buildWheel = (host: HTMLElement, count: number, cur: number, onPick: (v: number) => void) => {
      const padN = 3;
      let html = "";
      for (let i = 0; i < padN; i++) html += `<div class="wheel-pad"></div>`;
      for (let v = 0; v < count; v++) html += `<button type="button" class="wheel-item" data-v="${v}">${pad(v)}</button>`;
      for (let i = 0; i < padN; i++) html += `<div class="wheel-pad"></div>`;
      host.innerHTML = html;
      const rowH = () => host.querySelector<HTMLElement>(".wheel-item")!.offsetHeight;
      requestAnimationFrame(() => { host.scrollTop = (cur + padN) * rowH(); });
      host.addEventListener("scroll", () => {
        const idx = Math.round(host.scrollTop / rowH()) - padN;
        const v = Math.max(0, Math.min(count - 1, idx));
        onPick(v);
        host.querySelectorAll<HTMLElement>(".wheel-item").forEach((b) =>
          b.classList.toggle("sel", Number(b.dataset.v) === v));
        readout();
      }, { passive: true });
      host.querySelectorAll<HTMLButtonElement>(".wheel-item").forEach((b) =>
        (b.onclick = (e) => { e.stopPropagation(); const v = Number(b.dataset.v); onPick(v); host.scrollTop = (v + padN) * rowH(); }));
    };
    buildWheel(pop.querySelector<HTMLElement>("#tcHour")!, 24, h, (v) => { h = v; });
    buildWheel(pop.querySelector<HTMLElement>("#tcMin")!, 60, m, (v) => { m = v; });
    pop.querySelector<HTMLButtonElement>("#tcOk")!.onclick = (e) => {
      e.stopPropagation();
      onPicked(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
      closePop();
    };
  };
  render();
  mountPop(trigger, pop);
}
