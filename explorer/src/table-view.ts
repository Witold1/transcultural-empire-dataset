export type RawColumn = {
  id: string;
  label: string;
  type: "number" | "string";
  group: string;
};

export type RawRow = {
  _id: string;
  _hasCensus?: boolean;
  _censusNote?: string;
  [key: string]: string | number | boolean | null | undefined;
};

export type RawTable = {
  year: number;
  source: string;
  columns: RawColumn[];
  groups: string[];
  rows: RawRow[];
};

type SortDir = "asc" | "desc";

const GROUP_LABELS: Record<string, string> = {
  all: "All columns",
  core: "Core",
  language: "Language",
  religion: "Religion",
  estate: "Estate",
  nationality: "Nationality",
};

const NAME_FIELDS = new Set(["NAMEENG", "NAMERUS", "NameENG", "NameRUS"]);

export class TableView {
  private root: HTMLElement;
  private table: RawTable | null = null;
  private query = "";
  private group = "all";
  private sortKey = "";
  private sortDir: SortDir = "asc";
  private loading = false;
  private error: string | null = null;
  private onPick?: (id: string) => void;

  constructor(root: HTMLElement, opts?: { onPick?: (id: string) => void }) {
    this.root = root;
    this.onPick = opts?.onPick;
    this.root.addEventListener("click", (e) => this.onClick(e));
    this.root.addEventListener("input", (e) => this.onInput(e));
    this.root.addEventListener("change", (e) => this.onChange(e));
  }

  setLoading(loading: boolean): void {
    this.loading = loading;
    if (loading) {
      this.error = null;
      this.render();
    }
  }

  setError(message: string): void {
    this.loading = false;
    this.error = message;
    this.render();
  }

  setTable(table: RawTable): void {
    this.loading = false;
    this.error = null;
    this.table = table;
    const nameCol =
      table.columns.find((c) => c.id === "NAMEENG" || c.id === "NameENG") ??
      table.columns[0];
    const popCol =
      table.columns.find((c) => c.id === "POPALL" || c.id === "PopALL") ??
      nameCol;
    // Keep sort key if still valid; otherwise default to population desc.
    if (!table.columns.some((c) => c.id === this.sortKey)) {
      this.sortKey = popCol.id;
      this.sortDir = popCol.type === "number" ? "desc" : "asc";
    }
    if (!table.groups.includes(this.group) && this.group !== "all") {
      this.group = "all";
    }
    this.render();
  }

  private nameColumns(): RawColumn[] {
    if (!this.table) return [];
    const names = this.table.columns.filter((c) => NAME_FIELDS.has(c.id));
    const eng = names.filter((c) => /eng$/i.test(c.id));
    const rus = names.filter((c) => /rus$/i.test(c.id));
    const rest = names.filter((c) => !/eng$/i.test(c.id) && !/rus$/i.test(c.id));
    return [...eng, ...rus, ...rest];
  }

  private visibleColumns(): RawColumn[] {
    if (!this.table) return [];
    if (this.group === "all") return this.table.columns;
    const names = this.nameColumns();
    const nameIds = new Set(names.map((c) => c.id));
    const grouped = this.table.columns.filter(
      (c) => c.group === this.group && !nameIds.has(c.id)
    );
    // Always show English/Russian names so rows stay identifiable in any group.
    return [...names, ...grouped];
  }

  private filteredSorted(): RawRow[] {
    if (!this.table) return [];
    const q = this.query.trim().toLowerCase();
    const cols = this.visibleColumns();
    let list = this.table.rows;
    if (q) {
      list = list.filter((r) =>
        this.table!.columns.some((c) => {
          const v = r[c.id];
          return v != null && String(v).toLowerCase().includes(q);
        })
      );
    }

    const key = this.sortKey || cols[0]?.id;
    if (!key) return list;
    const col = this.table.columns.find((c) => c.id === key);
    const dir = this.sortDir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      const va = a[key];
      const vb = b[key];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (col?.type === "number") {
        return dir * (Number(va) - Number(vb));
      }
      return dir * String(va).localeCompare(String(vb));
    });
  }

  private onClick(e: Event): void {
    const t = e.target as HTMLElement;
    const groupBtn = t.closest<HTMLElement>("[data-group]");
    if (groupBtn?.dataset.group) {
      this.group = groupBtn.dataset.group;
      this.render();
      return;
    }
    const th = t.closest<HTMLElement>("th[data-sort]");
    if (th?.dataset.sort) {
      const key = th.dataset.sort;
      if (this.sortKey === key) {
        this.sortDir = this.sortDir === "asc" ? "desc" : "asc";
      } else {
        this.sortKey = key;
        const col = this.table?.columns.find((c) => c.id === key);
        this.sortDir = col?.type === "number" ? "desc" : "asc";
      }
      this.render();
      return;
    }
    const tr = t.closest<HTMLElement>("tr[data-id]");
    if (tr?.dataset.id && this.onPick) {
      this.onPick(tr.dataset.id);
    }
  }

  private onInput(e: Event): void {
    const t = e.target as HTMLInputElement;
    if (t.id === "table-search") {
      this.query = t.value;
      this.renderBodyOnly();
    }
  }

  private onChange(_e: Event): void {
    // reserved
  }

  private renderBodyOnly(): void {
    const tbody = this.root.querySelector("tbody");
    const meta = this.root.querySelector(".table-meta");
    if (!tbody || !meta || !this.table) {
      this.render();
      return;
    }
    const cols = this.visibleColumns();
    const rows = this.filteredSorted();
    tbody.innerHTML = this.bodyHtml(rows, cols);
    meta.textContent = this.metaText(rows.length, cols.length);
  }

  private metaText(shown: number, colCount: number): string {
    const total = this.table?.rows.length ?? 0;
    const year = this.table?.year ?? "";
    const missing =
      this.table?.rows.filter((r) => r._hasCensus === false).length ?? 0;
    const miss =
      missing > 0 ? ` ◆ ${missing} not enumerated` : "";
    return `${shown} of ${total} units ◆ ${colCount} columns ◆ raw ${year} DBF${miss}`;
  }

  private formatCell(col: RawColumn, value: string | number | boolean | null | undefined): string {
    if (value == null || value === "") return "-";
    if (col.type === "number") {
      const n = Number(value);
      if (!Number.isFinite(n)) return "-";
      return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n);
    }
    return escapeHtml(String(value));
  }

  private bodyHtml(rows: RawRow[], cols: RawColumn[]): string {
    if (!rows.length) {
      return `<tr class="table-empty"><td colspan="${Math.max(1, cols.length)}">No units match this filter.</td></tr>`;
    }
    return rows
      .map((r) => {
        const noCensus = r._hasCensus === false;
        const cells = cols
          .map((c, i) => {
            const sticky = i === 0 ? " sticky-col" : "";
            const align = c.type === "number" ? " num" : "";
            const raw = r[c.id];
            let content = this.formatCell(c, raw as string | number | null);
            if (i === 0 && NAME_FIELDS.has(c.id)) {
              const badge = noCensus
                ? `<span class="badge-no-census">No census</span>`
                : "";
              content = `<div class="cell-name">${content}${badge}</div>`;
              if (noCensus && r._censusNote) {
                content += `<div class="cell-sub">${escapeHtml(String(r._censusNote))}</div>`;
              }
            } else if (noCensus && c.type === "number") {
              content = `<span class="cell-na" title="Not enumerated (source -1)">-</span>`;
            }
            return `<td class="${align}${sticky}">${content}</td>`;
          })
          .join("");
        const rowClass = noCensus ? ` class="row-no-census"` : "";
        return `<tr data-id="${escapeAttr(String(r._id))}" tabindex="0"${rowClass}>${cells}</tr>`;
      })
      .join("");
  }

  render(): void {
    if (this.loading) {
      this.root.innerHTML = `<div class="table-status">Loading raw attribute table…</div>`;
      return;
    }
    if (this.error) {
      this.root.innerHTML = `<div class="table-status error">${escapeHtml(this.error)}</div>`;
      return;
    }
    if (!this.table) {
      this.root.innerHTML = `<div class="table-status">No table loaded.</div>`;
      return;
    }

    const cols = this.visibleColumns();
    const rows = this.filteredSorted();
    const groupBtns = ["all", ...this.table.groups]
      .map((g) => {
        const active = this.group === g ? " active" : "";
        return `<button type="button" class="seg-btn${active}" data-group="${g}">${GROUP_LABELS[g] ?? g}</button>`;
      })
      .join("");

    const heads = cols
      .map((c, i) => {
        const active = this.sortKey === c.id;
        const arrow = active ? (this.sortDir === "asc" ? " ↑" : " ↓") : "";
        const align = c.type === "number" ? "num" : "";
        const sticky = i === 0 ? " sticky-col" : "";
        const title = escapeAttr(`${c.label} (${c.id})`);
        return `<th class="${align}${sticky}" data-sort="${escapeAttr(c.id)}" scope="col" title="${title}">
          <button type="button" class="th-btn">${escapeHtml(c.label)}${arrow}</button>
          <div class="th-code">${escapeHtml(c.id)}</div>
        </th>`;
      })
      .join("");

    this.root.innerHTML = `
      <div class="table-toolbar">
        <label class="table-search">
          <span class="sr-only">Filter units</span>
          <input id="table-search" type="search" placeholder="Filter across all fields…" value="${escapeAttr(this.query)}" />
        </label>
        <div class="table-groups" role="group" aria-label="Column groups">${groupBtns}</div>
        <p class="table-meta">${this.metaText(rows.length, cols.length)}</p>
      </div>
      <div class="table-scroll">
        <table class="data-table raw-table">
          <thead><tr>${heads}</tr></thead>
          <tbody>${this.bodyHtml(rows, cols)}</tbody>
        </table>
      </div>
    `;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, "&#39;");
}
