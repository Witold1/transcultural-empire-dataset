/**
 * Fixed-center VisQuill lens + Option B docked composition panels.
 *
 * - Minimal single-ring lens at graphic center; map pans underneath.
 * - Map outside the ring is softly dimmed.
 * - Left / right / bottom panels: title + slim horizontal bars (no leaders).
 * - On narrow viewports, notes drop the bars and show “label N%” inline.
 */
import * as maplibregl from "maplibre-gl";
import {
  Attach,
  Bars,
  Boxes,
  Circles,
  Reactive,
  Segments,
  Svg,
  type RvgGraphic,
  type RvgGroup,
  type RvgRectangle,
  type RvgAnchoredText,
  type RvgCircle,
  type RvgPoint,
} from "@visquill/visquill-gdk";
import type { MapAdapter as LocalMapAdapter } from "./map-adapter";

export type GroupRow = { id: string; label: string; count: number; share: number };

export type LensSelection = {
  id: string;
  nameEng: string;
  nameRus?: string;
  year: number;
  hasCensus: boolean;
  censusNote?: string | null;
  popAll: number | null;
  urbanPct: number | null;
  sexRatio: number | null;
  geometry: GeoJSON.Geometry;
  languages?: GroupRow[];
  religions?: GroupRow[];
  estates?: GroupRow[];
  nationalities?: GroupRow[];
};

type Dock = "left" | "right" | "bottom";

type RowSlot = {
  track: RvgRectangle;
  fill: RvgRectangle;
  label: RvgAnchoredText;
  pct: RvgAnchoredText;
  labelAt: RvgPoint;
  pctAt: RvgPoint;
};

type PanelSlot = {
  key: string;
  dock: Dock;
  title: RvgAnchoredText;
  titleAt: RvgPoint;
  rows: RowSlot[];
};

const HL_SOURCE = "highlighted-units";
const HL_FILL = "highlighted-units-fill";
const HL_LINE = "highlighted-units-line";

const ROWS = 5;
const ROW_H = 22;
const BAR_H = 6;
const BAR_MAX = 96;
const LABEL_W = 118;
const PCT_W = 44;
const PANEL_W = LABEL_W + BAR_MAX + PCT_W + 12;
/** Compact notes: “Label 99%” inline, no bars. */
const PANEL_W_COMPACT = 168;
const LENS_R_COMPACT = 80;
const GUTTER = 40;
const PANEL_PAD_Y = 8;
const COMPACT_NOTES_MQ = "(max-width: 860px)";

const SEP = " ◆ ";

function compactLensNotes(): boolean {
  return window.matchMedia(COMPACT_NOTES_MQ).matches;
}

function lensRadiusPx(base: number): number {
  return compactLensNotes() ? LENS_R_COMPACT : base;
}

function fmtPop(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(Math.round(n));
}

function shortLabel(s: string, max = 18): string {
  const t = s.replace(/\s*\(.*?\)\s*/g, " ").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function nonePointer(el: object): void {
  Svg.get(el as never).style.pointerEvents = "none";
}

function hBar(
  x: number,
  y: number,
  len: number,
  thick: number,
  rect: RvgRectangle
): void {
  if (len <= 0.5) {
    rect.visible.value = false;
    Bars.fromSegment({ x, y }, { x: x + 1, y }, 0, true, rect);
    return;
  }
  rect.visible.value = true;
  Bars.fromSegment({ x, y }, { x: x + len, y }, thick, true, rect);
}

export class CensusLens {
  readonly radiusPx: number;

  private title: RvgAnchoredText;
  private subtitle: RvgAnchoredText;
  private subtitle2: RvgAnchoredText;
  private panels: PanelSlot[] = [];
  private panelLayer: RvgGroup;
  private dimEl: HTMLDivElement;
  private focusedId: string | null = null;
  private year: number;
  private livePanels: { title: string; rows: GroupRow[] }[] = [
    { title: "", rows: [] },
    { title: "", rows: [] },
    { title: "", rows: [] },
  ];
  private mapAdapter: LocalMapAdapter;
  private fillLayerId: string;
  private lookup: (id: string) => LensSelection | null;
  private onChange: (sel: LensSelection | null) => void;

  constructor(
    private readonly rvg: RvgGraphic,
    mapAdapter: LocalMapAdapter,
    opts: {
      radiusPx?: number;
      year?: number;
      fillLayerId: string;
      lookup: (id: string) => LensSelection | null;
      onChange?: (sel: LensSelection | null) => void;
    }
  ) {
    this.radiusPx = opts.radiusPx ?? 100;
    this.year = opts.year ?? 1897;
    this.mapAdapter = mapAdapter;
    this.fillLayerId = opts.fillLayerId;
    this.lookup = opts.lookup;
    this.onChange = opts.onChange ?? (() => {});

    const lensLayer = this.rvg.canvas.layer("lens-") as RvgGroup;
    this.panelLayer = this.rvg.canvas.layer("panel-") as RvgGroup;

    // Soft vignette: dim map outside the lens hole (between map canvas and SVG)
    this.dimEl = document.createElement("div");
    this.dimEl.className = "lens-dim";
    this.dimEl.setAttribute("aria-hidden", "true");
    const mapEl = this.mapAdapter.map?.getContainer();
    const mapRoot = mapEl?.parentElement;
    const sceneEl = mapRoot?.lastElementChild as HTMLElement | null;
    if (mapRoot && sceneEl) {
      sceneEl.style.zIndex = "3";
      mapRoot.insertBefore(this.dimEl, sceneEl);
    }

    const ring = lensLayer.visuals.circle("ring") as RvgCircle;
    const aim = lensLayer.visuals.circle("aim") as RvgCircle;
    const crossH = lensLayer.visuals.segment("cross-h");
    const crossV = lensLayer.visuals.segment("cross-v");

    this.title = lensLayer.text.label("Pan map under lens", "title");
    this.subtitle = lensLayer.text.label(`census ${this.year}`, "subtitle");
    this.subtitle2 = lensLayer.text.label("", "subtitle2");
    const titleAt = lensLayer.visuals.point("title-at");
    const subtitleAt = lensLayer.visuals.point("subtitle-at");
    const subtitle2At = lensLayer.visuals.point("subtitle2-at");
    for (const at of [titleAt, subtitleAt, subtitle2At]) nonePointer(at);
    Attach.pointToPoint(this.title, titleAt);
    Attach.pointToPoint(this.subtitle, subtitleAt);
    Attach.pointToPoint(this.subtitle2, subtitle2At);

    this.panels = this.buildPanels();

    const AIM_R = 2.25;
    const CROSS = 8;
    Reactive.do([this.rvg.frame], () => {
      const c = this.rvg.center;
      const r = lensRadiusPx(this.radiusPx);
      Circles.circleAt(c, r, ring);
      Circles.circleAt(c, AIM_R, aim);
      Segments.segment(
        { x: c.x - CROSS, y: c.y },
        { x: c.x + CROSS, y: c.y },
        crossH
      );
      Segments.segment(
        { x: c.x, y: c.y - CROSS },
        { x: c.x, y: c.y + CROSS },
        crossV
      );
      titleAt.x = c.x;
      titleAt.y = c.y - (r + 58);
      subtitleAt.x = c.x;
      subtitleAt.y = c.y - (r + 34);
      subtitle2At.x = c.x;
      subtitle2At.y = c.y - (r + 16);
      this.dimEl.style.background = `radial-gradient(circle ${r}px at ${c.x}px ${c.y}px, transparent ${r - 0.5}px, rgba(26, 21, 16, 0.20) ${r}px)`;
      this.layoutPanels(c.x, c.y, r);
    });

    for (const el of [
      ring,
      aim,
      crossH,
      crossV,
      this.title,
      this.subtitle,
      this.subtitle2,
    ]) {
      nonePointer(el);
    }

    this.mapAdapter.onMove(() => this.sampleUnderLens());
    this.mapAdapter.map?.on("load", () => {
      this.ensureHighlightLayers();
      this.sampleUnderLens();
    });
  }

  refresh(): void {
    this.ensureHighlightLayers();
    this.sampleUnderLens();
  }

  clear(): void {
    this.applySelection(null);
  }

  setYear(year: number): void {
    this.year = year;
    if (this.focusedId === null) {
      this.subtitle.value = `census ${this.year}`;
      this.subtitle2.value = "";
    }
  }

  panUnitUnderLens(geometry: GeoJSON.Geometry, duration = 650): void {
    const m = this.mapAdapter.map;
    if (!m) return;
    const c = centroid(geometry);
    if (!c) return;
    m.easeTo({ center: c, duration, essential: true });
  }

  private sampleUnderLens(): void {
    const m = this.mapAdapter.map;
    if (!m || !m.getLayer(this.fillLayerId)) return;

    const pt: maplibregl.PointLike = [this.rvg.center.x, this.rvg.center.y];
    const hits = m.queryRenderedFeatures(pt, { layers: [this.fillLayerId] });
    const id = hits[0]?.properties?.id as string | undefined;
    if (!id) {
      if (this.focusedId !== null) this.applySelection(null);
      return;
    }
    if (id === this.focusedId) return;
    this.applySelection(this.lookup(id));
  }

  private applySelection(sel: LensSelection | null): void {
    this.focusedId = sel?.id ?? null;
    if (!sel) {
      this.title.value = "Pan map under lens";
      this.subtitle.value = `census ${this.year}`;
      this.subtitle2.value = "";
      this.livePanels = [
        { title: "", rows: [] },
        { title: "", rows: [] },
        { title: "", rows: [] },
      ];
      this.setHighlight(null);
      this.layoutPanels(
        this.rvg.center.x,
        this.rvg.center.y,
        lensRadiusPx(this.radiusPx)
      );
      this.onChange(null);
      return;
    }

    this.title.value = sel.nameEng || "Unnamed";
    if (!sel.hasCensus) {
      this.subtitle.value = `census ${sel.year}${SEP}not covered by census`;
      this.subtitle2.value = "";
      // No composition rows — keep note titles blank (same as no selection).
      this.livePanels = [
        { title: "", rows: [] },
        { title: "", rows: [] },
        { title: "", rows: [] },
      ];
    } else {
      const pop = sel.popAll ?? 0;
      const urban = sel.urbanPct;
      const sex = sel.sexRatio;
      this.subtitle.value = `census ${sel.year}${SEP}${fmtPop(pop)} people`;
      const line2: string[] = [];
      if (urban != null && Number.isFinite(urban)) {
        line2.push(`urban ${urban.toFixed(1)}%`);
      }
      if (sex != null && Number.isFinite(sex)) {
        line2.push(`sex ratio ${sex.toFixed(3)}`);
      }
      this.subtitle2.value = line2.join(SEP);
      this.livePanels = this.panelsForSelection(sel);
    }
    this.setHighlight(sel);
    this.layoutPanels(
      this.rvg.center.x,
      this.rvg.center.y,
      lensRadiusPx(this.radiusPx)
    );
    this.onChange(sel);
  }

  private ensureHighlightLayers(): void {
    const m = this.mapAdapter.map;
    if (!m) return;
    if (!m.getSource(HL_SOURCE)) {
      m.addSource(HL_SOURCE, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
    }
    if (!m.getLayer(HL_FILL)) {
      m.addLayer({
        id: HL_FILL,
        type: "fill",
        source: HL_SOURCE,
        paint: {
          "fill-color": "#a04840",
          "fill-opacity": 0.18,
        },
      });
    } else {
      m.setPaintProperty(HL_FILL, "fill-color", "#a04840");
      m.setPaintProperty(HL_FILL, "fill-opacity", 0.18);
    }
    if (!m.getLayer(HL_LINE)) {
      m.addLayer({
        id: HL_LINE,
        type: "line",
        source: HL_SOURCE,
        paint: {
          "line-color": "#7a342c",
          "line-width": 1.25,
          "line-opacity": 0.5,
        },
      });
    } else {
      m.setPaintProperty(HL_LINE, "line-color", "#7a342c");
      m.setPaintProperty(HL_LINE, "line-width", 1.25);
      m.setPaintProperty(HL_LINE, "line-opacity", 0.5);
    }
    // Keep highlight above choropleth. Basemap swaps re-add census layers
    // after the highlight, which used to bury it and change the look.
    if (m.getLayer(HL_FILL)) m.moveLayer(HL_FILL);
    if (m.getLayer(HL_LINE)) m.moveLayer(HL_LINE);
  }

  private setHighlight(sel: LensSelection | null): void {
    const m = this.mapAdapter.map;
    if (!m) return;
    this.ensureHighlightLayers();
    const src = m.getSource(HL_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    if (!sel) {
      src.setData({ type: "FeatureCollection", features: [] });
      return;
    }
    src.setData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { id: sel.id, nameEng: sel.nameEng },
          geometry: sel.geometry,
        },
      ],
    });
  }

  private buildPanels(): PanelSlot[] {
    const specs: { key: string; dock: Dock }[] = [
      { key: "a", dock: "left" },
      { key: "b", dock: "right" },
      { key: "c", dock: "bottom" },
    ];

    return specs.map((spec) => {
      const titleAt = this.panelLayer.visuals.point(`title-at-${spec.key}`);
      const title = this.panelLayer.text.label("", `title-${spec.key}`);
      nonePointer(titleAt);
      nonePointer(title);
      Attach.pointToPoint(title, titleAt);

      const rows: RowSlot[] = [];
      for (let i = 0; i < ROWS; i++) {
        const track = this.panelLayer.visuals.rectangle(`track-${spec.key}-${i}`);
        const fill = this.panelLayer.visuals.rectangle(`fill-${spec.key}-${i}`);
        const labelAt = this.panelLayer.visuals.point(`lbl-at-${spec.key}-${i}`);
        const pctAt = this.panelLayer.visuals.point(`pct-at-${spec.key}-${i}`);
        const label = this.panelLayer.text.label("", `lbl-${spec.key}-${i}`);
        const pct = this.panelLayer.text.label("", `pct-${spec.key}-${i}`);
        for (const el of [track, fill, labelAt, pctAt, label, pct]) nonePointer(el);
        Attach.pointToPoint(label, labelAt);
        Attach.pointToPoint(pct, pctAt);
        rows.push({ track, fill, label, pct, labelAt, pctAt });
      }

      return {
        key: spec.key,
        dock: spec.dock,
        title,
        titleAt,
        rows,
      };
    });
  }

  private panelsForSelection(sel: LensSelection | null): {
    title: string;
    rows: GroupRow[];
  }[] {
    if (!sel) {
      return [
        { title: "", rows: [] },
        { title: "", rows: [] },
        { title: "", rows: [] },
      ];
    }
    if (!sel.hasCensus) {
      return [
        {
          title: "Status",
          rows: [
            {
              id: "none",
              label: "Not enumerated",
              count: 0,
              share: 1,
            },
          ],
        },
        { title: "Language", rows: [] },
        { title: "Religion", rows: [] },
      ];
    }
    if (sel.year === 1897) {
      return [
        { title: "Language", rows: sel.languages ?? [] },
        { title: "Religion", rows: sel.religions ?? [] },
        { title: "Estate", rows: sel.estates ?? [] },
      ];
    }
    return [
      { title: "Nationality", rows: sel.nationalities ?? [] },
      { title: "", rows: [] },
      { title: "", rows: [] },
    ];
  }

  private panelOrigin(
    dock: Dock,
    cx: number,
    cy: number,
    r: number,
    panelW: number
  ): { x: number; y: number } {
    const frame = this.rvg.frame;
    const fw = Math.max(Boxes.width(frame).value, 1);
    const fh = Math.max(Boxes.height(frame).value, 1);
    const panelH = PANEL_PAD_Y + 28 + ROWS * ROW_H;

    if (dock === "left") {
      let x = cx - r - GUTTER - panelW;
      x = Math.max(16, Math.min(x, fw - panelW - 16));
      let y = cy - panelH / 2;
      y = Math.max(72, Math.min(y, fh - panelH - 16));
      return { x, y };
    }
    if (dock === "right") {
      let x = cx + r + GUTTER;
      x = Math.max(16, Math.min(x, fw - panelW - 16));
      let y = cy - panelH / 2;
      y = Math.max(72, Math.min(y, fh - panelH - 16));
      return { x, y };
    }
    // bottom
    let x = cx - panelW / 2;
    x = Math.max(16, Math.min(x, fw - panelW - 16));
    let y = cy + r + GUTTER;
    y = Math.max(72, Math.min(y, fh - panelH - 12));
    return { x, y };
  }

  private layoutPanels(cx: number, cy: number, r: number): void {
    const compact = compactLensNotes();
    const panelW = compact ? PANEL_W_COMPACT : PANEL_W;

    for (let p = 0; p < this.panels.length; p++) {
      const panel = this.panels[p];
      const pack = this.livePanels[p] ?? { title: "", rows: [] };
      const origin = this.panelOrigin(panel.dock, cx, cy, r, panelW);
      const alignEnd = compact && panel.dock === "right";
      const textX = alignEnd ? origin.x + panelW : origin.x;

      const rows = pack.rows.slice(0, ROWS);
      const hasData = rows.some((row) => row.share > 0);

      // Hide orphan titles when a note has no bars (e.g. not-in-census units).
      panel.title.value = hasData ? pack.title : "";
      panel.titleAt.x = textX;
      panel.titleAt.y = origin.y + 8;

      for (let i = 0; i < ROWS; i++) {
        const slot = panel.rows[i];
        const row = rows[i];
        const y = origin.y + 30 + i * ROW_H + ROW_H / 2;
        const barX = origin.x + LABEL_W;

        if (!hasData || !row || !(row.share > 0)) {
          slot.label.value = "";
          slot.pct.value = "";
          slot.track.visible.value = false;
          slot.fill.visible.value = false;
          hBar(barX, y, 0, BAR_H, slot.track);
          hBar(barX, y, 0, BAR_H, slot.fill);
          continue;
        }

        const pctStr = `${(100 * row.share).toFixed(0)}%`;
        slot.labelAt.x = textX;
        slot.labelAt.y = y;
        slot.pctAt.y = y;

        if (compact) {
          slot.label.value = `${shortLabel(row.label, 18)} ${pctStr}`;
          slot.pct.value = "";
          slot.pctAt.x = textX;
          slot.track.visible.value = false;
          slot.fill.visible.value = false;
          hBar(barX, y, 0, BAR_H, slot.track);
          hBar(barX, y, 0, BAR_H, slot.fill);
        } else {
          slot.label.value = shortLabel(row.label, 18);
          slot.pct.value = pctStr;
          slot.pctAt.x = barX + BAR_MAX + 10;
          hBar(barX, y, BAR_MAX, BAR_H, slot.track);
          hBar(
            barX,
            y,
            Math.max(3, Math.min(BAR_MAX, row.share * BAR_MAX)),
            BAR_H,
            slot.fill
          );
        }
      }
    }
  }
}

function centroid(geometry: GeoJSON.Geometry): [number, number] | null {
  const pts: [number, number][] = [];
  const walk = (c: number[] | number[][] | number[][][] | number[][][][]) => {
    if (typeof c[0] === "number") {
      pts.push([c[0] as number, c[1] as number]);
      return;
    }
    for (const x of c as (number[] | number[][] | number[][][])[]) walk(x);
  };
  if (geometry.type === "GeometryCollection") {
    for (const g of geometry.geometries) {
      const nested = centroid(g);
      if (nested) pts.push(nested);
    }
  } else if (geometry.type !== "Point") {
    walk((geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon).coordinates);
  } else {
    return geometry.coordinates as [number, number];
  }
  if (!pts.length) return null;
  let sx = 0;
  let sy = 0;
  for (const [x, y] of pts) {
    sx += x;
    sy += y;
  }
  return [sx / pts.length, sy / pts.length];
}
