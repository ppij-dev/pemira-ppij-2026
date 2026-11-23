/**
 * Odometer angka: setiap digit yang berubah menggelinding vertikal dari nilai
 * lama ke nilai baru (satu komponen kecil, dipakai hitung mundur beranda/Dasbor
 * dan strip statistik /api/turnout). Tanpa dependensi; hanya animasi
 * transform/opacity pada digit yang benar-benar berubah, sehingga hemat CPU.
 *
 * Lebar tiap sel digit dikunci `1ch` dan halaman memakai font mono
 * `tabular-nums`, jadi tidak ada pergeseran tata letak saat angka bertambah.
 * `prefers-reduced-motion` mengubah angka seketika tanpa animasi. Teks untuk
 * pembaca layar disimpan di satu span `sr-only`; sel visual `aria-hidden`, jadi
 * perubahan per detik tidak diumumkan (tetap `aria-live="off"`).
 */

/** Peta per posisi: digit yang berubah digelindingkan, sisanya ditulis langsung. */
export interface OdometerCellPlan {
  char: string;
  roll: boolean;
}

export interface OdometerPlan {
  /** Panjang berubah atau karakter non-digit berganti: bangun ulang seketika. */
  rebuild: boolean;
  cells: OdometerCellPlan[];
}

/** Digit ASCII saja yang boleh menggelinding; pemisah id-ID (".", ":") statis. */
function isDigit(char: string): boolean {
  return char >= "0" && char <= "9";
}

/**
 * Rencana perubahan murni (dapat diuji tanpa DOM): hanya posisi dengan karakter
 * berbeda yang menggelinding, dan hanya bila kedua sisi digit serta panjang
 * sama. Perubahan panjang (mis. 999 ke 1.000) memicu bangun ulang seketika.
 */
export function planOdometer(prev: string, next: string): OdometerPlan {
  if (prev.length !== next.length) return { rebuild: true, cells: [] };
  let rebuild = false;
  const cells: OdometerCellPlan[] = [];
  for (let i = 0; i < next.length; i++) {
    const from = prev[i]!;
    const to = next[i]!;
    if (from === to) {
      cells.push({ char: to, roll: false });
    } else if (isDigit(from) && isDigit(to)) {
      cells.push({ char: to, roll: true });
    } else {
      // Karakter non-digit berganti (mis. pemisah ribuan bergeser): tulis saja.
      cells.push({ char: to, roll: false });
      rebuild = true;
    }
  }
  return { rebuild, cells };
}

const ODOMETER_STYLE_ID = "odometer-style";

const ODOMETER_CSS = `
.odo-cell{position:relative;display:inline-block;min-width:1ch;text-align:center}
.odo-cell.odo-rolling{overflow:hidden;vertical-align:top}
.odo-cell .odo-old,.odo-cell .odo-new{display:inline-block}
.odo-cell .odo-old.odo-anim{animation:odo-out .45s ease forwards}
.odo-cell .odo-new{position:absolute;left:0;right:0;top:0}
.odo-cell .odo-new.odo-anim{animation:odo-in .45s ease forwards}
@keyframes odo-out{to{transform:translateY(-100%);opacity:0}}
@keyframes odo-in{from{transform:translateY(100%)}to{transform:translateY(0)}}
@media (prefers-reduced-motion:reduce){.odo-cell .odo-old.odo-anim,.odo-cell .odo-new.odo-anim{animation-duration:1ms}}
`;

export interface OdometerHandle {
  /** Terapkan nilai berikutnya; hanya digit yang berubah yang menggelinding. */
  set(next: string): void;
  /** Nilai yang sedang ditampilkan (nilai target, bukan digit lama saat animasi). */
  value(): string;
}

interface CellState {
  span: HTMLSpanElement;
  char: string;
  settleTimer: number | undefined;
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Sisipkan CSS odometer sekali per dokumen (idempoten). */
export function ensureOdometerStyle(doc: Document = document): void {
  if (doc.getElementById(ODOMETER_STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = ODOMETER_STYLE_ID;
  style.textContent = ODOMETER_CSS;
  doc.head.appendChild(style);
}

/**
 * Ubah elemen (mis. <p class="font-mono ...">) menjadi odometer. Nilai awalnya
 * dibaca dari textContent elemen dan langsung dirender tanpa animasi.
 */
export function attachOdometer(el: HTMLElement, doc: Document = document): OdometerHandle {
  ensureOdometerStyle(doc);
  const initial = el.textContent ?? "";
  const cells: CellState[] = [];
  const mirror = doc.createElement("span");
  mirror.className = "sr-only";
  mirror.textContent = initial;
  const visual = doc.createElement("span");
  visual.setAttribute("aria-hidden", "true");
  el.replaceChildren(visual, mirror);

  const buildCell = (char: string): CellState => {
    const span = doc.createElement("span");
    span.className = "odo-cell";
    span.textContent = char;
    return { span, char, settleTimer: undefined };
  };

  const settle = (state: CellState): void => {
    if (state.settleTimer !== undefined) {
      window.clearTimeout(state.settleTimer);
      state.settleTimer = undefined;
    }
    state.span.classList.remove("odo-rolling");
    state.span.replaceChildren(doc.createTextNode(state.char));
  };

  const rollCell = (state: CellState, next: string): void => {
    const reduced = prefersReducedMotion();
    if (reduced) {
      state.char = next;
      state.span.replaceChildren(doc.createTextNode(next));
      return;
    }
    const oldSpan = doc.createElement("span");
    oldSpan.className = "odo-old odo-anim";
    oldSpan.textContent = state.char;
    const newSpan = doc.createElement("span");
    newSpan.className = "odo-new odo-anim";
    newSpan.textContent = next;
    state.char = next;
    state.span.classList.add("odo-rolling");
    state.span.replaceChildren(oldSpan, newSpan);
    const done = (): void => settle(state);
    oldSpan.addEventListener("animationend", done, { once: true });
    // Jaring pengaman bila animationend tidak menyala (tab latar, dsb.).
    state.settleTimer = window.setTimeout(done, 600);
  };

  const rebuild = (next: string): void => {
    for (const state of cells) settle(state);
    cells.length = 0;
    const fragment = doc.createDocumentFragment();
    for (const char of next) {
      const state = buildCell(char);
      cells.push(state);
      fragment.appendChild(state.span);
    }
    visual.replaceChildren(fragment);
  };

  // Nilai awal tanpa animasi.
  rebuild(initial);

  return {
    set(next: string): void {
      mirror.textContent = next;
      const plan = planOdometer(cells.map((c) => c.char).join(""), next);
      if (plan.rebuild || cells.length === 0) {
        rebuild(next);
        return;
      }
      plan.cells.forEach((cellPlan, i) => {
        const state = cells[i]!;
        if (state.settleTimer !== undefined) settle(state);
        if (!cellPlan.roll && state.char === cellPlan.char) return;
        if (!cellPlan.roll) {
          state.char = cellPlan.char;
          state.span.replaceChildren(doc.createTextNode(cellPlan.char));
          return;
        }
        rollCell(state, cellPlan.char);
      });
    },
    value(): string {
      return cells.map((c) => c.char).join("");
    },
  };
}
