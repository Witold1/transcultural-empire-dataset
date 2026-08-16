import * as maplibregl from "maplibre-gl";
import type { ExpressionSpecification } from "maplibre-gl";
import { CensusLens, type LensSelection } from "./lens";
import { MapAdapter } from "./map-adapter";
import { filterMapByYear } from "./ohm-dates";
import { TableView, type RawTable } from "./table-view";
import { fmtInt, fmtPct, unitHasCensus, type UnitProps } from "./types";
import "./styles.css";

type MetricDef = {
  id: string;
  label: string;
  unit: string;
  years: number[];
  format: (v: number | null | undefined) => string;
};

type AppView = "map" | "table";
type BasemapId = "modern" | "historical";

const BASEMAP_STYLES: Record<BasemapId, string> = {
  modern: "https://tiles.openfreemap.org/styles/liberty",
  historical:
    "https://www.openhistoricalmap.org/map-styles/main/main.json",
};

const PLAIN_FILL = "#d4b483";
const NO_CENSUS_FILL = "#cfc6b8";

const METRICS: MetricDef[] = [
  {
    id: "none",
    label: "No metric (default regions)",
    unit: "none",
    years: [1897, 1926],
    format: () => "-",
  },
  {
    id: "urbanPct",
    label: "Urban population, %",
    unit: "%",
    years: [1897, 1926],
    format: (v) => (v == null ? "-" : `${v.toFixed(1)}%`),
  },
  {
    id: "sexRatio",
    label: "Sex ratio, M/F",
    unit: "ratio",
    years: [1897, 1926],
    format: (v) => (v == null ? "-" : v.toFixed(3)),
  },
  {
    id: "density",
    label: "Population density, people / km²",
    unit: "per km²",
    years: [1897, 1926],
    format: (v) => (v == null ? "-" : v.toFixed(1)),
  },
  {
    id: "topLanguageShare",
    label: "Major language share, %",
    unit: "share",
    years: [1897],
    format: (v) => (v == null ? "-" : `${(100 * v).toFixed(1)}%`),
  },
  {
    id: "topReligionShare",
    label: "Major religion share, %",
    unit: "share",
    years: [1897],
    format: (v) => (v == null ? "-" : `${(100 * v).toFixed(1)}%`),
  },
  {
    id: "topNationalityShare",
    label: "Major nationality share, %",
    unit: "share",
    years: [1926],
    format: (v) => (v == null ? "-" : `${(100 * v).toFixed(1)}%`),
  },
];

const SOURCE_ID = "census";
const FILL_ID = "census-fill";
const LINE_ID = "census-line";

/** Resolved against Vite `base` so GitHub Pages project paths work. */
const dataUrl = (file: string) => `${import.meta.env.BASE_URL}data/${file}`;

const COLORS = [
  "#f7f3eb",
  "#e8d9b8",
  "#d4b483",
  "#b8864a",
  "#8f5a2a",
  "#5c3416",
];

let year = 1897;
let metricId = "none";
let view: AppView = "map";
let basemap: BasemapId = "modern";
let featuresById = new Map<string, UnitProps>();
let featuresByIdGeom = new Map<string, GeoJSON.Geometry>();
let lastGeojson: GeoJSON.FeatureCollection | null = null;
let censusEventsWired = false;
let basemapSwapToken = 0;
const rawTableCache = new Map<number, RawTable>();

const mapRoot = document.getElementById("map-root") as HTMLDivElement;
const viewMap = document.getElementById("view-map") as HTMLElement;
const viewTable = document.getElementById("view-table") as HTMLElement;
const tableRoot = document.getElementById("table-root") as HTMLElement;
const panelEl = document.getElementById("panel") as HTMLElement;
const panelDrawerToggle = document.getElementById(
  "panel-drawer-toggle"
) as HTMLButtonElement;
const metricSelect = document.getElementById("metric") as HTMLSelectElement;
const legendEl = document.getElementById("legend") as HTMLDivElement;
const selectionEl = document.getElementById("selection") as HTMLDivElement;
const mobilePanelMq = window.matchMedia("(max-width: 860px)");

function setPanelDrawerOpen(open: boolean): void {
  panelEl.classList.toggle("is-open", open);
  panelDrawerToggle.setAttribute("aria-expanded", open ? "true" : "false");
  panelDrawerToggle.setAttribute(
    "aria-label",
    open ? "Hide details" : "Show details"
  );
}

const { map, rvg } = MapAdapter.create(mapRoot, "app-", {
  center: [70, 55],
  zoom: 2.6,
  minZoom: 1.5,
  maxZoom: 8,
});

function toLensSelection(props: UnitProps): LensSelection | null {
  const geom = featuresByIdGeom.get(props.id);
  if (!geom) return null;
  return {
    id: props.id,
    nameEng: props.nameEng,
    nameRus: props.nameRus,
    year: props.year,
    hasCensus: unitHasCensus(props),
    censusNote: props.censusNote,
    popAll: props.popAll,
    urbanPct: props.urbanPct,
    sexRatio: props.sexRatio,
    geometry: geom,
    languages: props.languages,
    religions: props.religions,
    estates: props.estates,
    nationalities: props.nationalities,
  };
}

const lens = new CensusLens(rvg, map, {
  radiusPx: 100,
  year,
  fillLayerId: FILL_ID,
  lookup: (id) => {
    const props = featuresById.get(id);
    return props ? toLensSelection(props) : null;
  },
  onChange: (sel) => {
    if (!sel) {
      selectionEl.className = "selection empty";
      selectionEl.innerHTML = `<p class="hint">Pan the map so a province sits under the fixed center lens - or click a province to center it.</p>`;
      return;
    }
    const props = featuresById.get(sel.id);
    if (props) renderPanel(props);
  },
});

const tableView = new TableView(tableRoot, {
  onPick: (id) => {
    const props = featuresById.get(id);
    const geom = featuresByIdGeom.get(id);
    if (!props || !geom) return;
    setView("map");
    lens.panUnitUnderLens(geom);
    renderPanel(props);
  },
});

function metricsForYear(y: number): MetricDef[] {
  return METRICS.filter((m) => m.years.includes(y));
}

function currentMetric(): MetricDef {
  return METRICS.find((m) => m.id === metricId) ?? METRICS[0];
}

function refreshMetricOptions(): void {
  const opts = metricsForYear(year);
  if (!opts.some((m) => m.id === metricId)) {
    metricId = opts[0].id;
  }
  metricSelect.innerHTML = opts
    .map(
      (m) =>
        `<option value="${m.id}" ${m.id === metricId ? "selected" : ""}>${m.label}</option>`
    )
    .join("");
}

function quantiles(values: number[], breaks = 5): number[] {
  if (!values.length) return [0, 1];
  const sorted = [...values].sort((a, b) => a - b);
  const edges: number[] = [];
  for (let i = 0; i <= breaks; i++) {
    const t = i / breaks;
    const idx = Math.min(sorted.length - 1, Math.floor(t * (sorted.length - 1)));
    edges.push(sorted[idx]);
  }
  const unique: number[] = [];
  for (const e of edges) {
    if (!unique.length || e > unique[unique.length - 1]) unique.push(e);
  }
  if (unique.length < 2) unique.push(unique[0] + 1e-6);
  return unique;
}

function colorExpression(field: string, edges: number[]): ExpressionSpecification {
  const stops: unknown[] = ["interpolate", ["linear"], ["get", field]];
  const n = Math.min(COLORS.length, edges.length);
  for (let i = 0; i < n; i++) {
    const edgeIndex = Math.round((i / (n - 1)) * (edges.length - 1));
    stops.push(edges[edgeIndex], COLORS[i]);
  }
  return stops as ExpressionSpecification;
}

function renderLegend(edges: number[], metric: MetricDef): void {
  const noCensusRow =
    year === 1897
      ? `<div class="legend-row"><span class="swatch" style="background:${NO_CENSUS_FILL}"></span><span>Not in 1897 Census</span></div>`
      : "";
  if (metric.id === "none") {
    legendEl.innerHTML = `<div class="legend-title">Regions</div>
      <div class="legend-row"><span class="swatch" style="background:${PLAIN_FILL}"></span><span>Covered by census</span></div>
      ${noCensusRow}`;
    return;
  }
  const swatches = COLORS.map((c, i) => {
    const lo = edges[Math.min(i, edges.length - 1)];
    const hi = edges[Math.min(i + 1, edges.length - 1)];
    const label =
      metric.unit === "share"
        ? `${(100 * lo).toFixed(0)}-${(100 * hi).toFixed(0)}%`
        : metric.unit === "%"
          ? `${lo.toFixed(0)}-${hi.toFixed(0)}%`
          : `${lo.toFixed(2)}-${hi.toFixed(2)}`;
    return `<div class="legend-row"><span class="swatch" style="background:${c}"></span><span>${label}</span></div>`;
  }).join("");
  legendEl.innerHTML = `<div class="legend-title">Legend of ${metric.label}</div>${swatches}${noCensusRow}`;
}

function groupBlocks(props: UnitProps): string {
  const sections: { title: string; rows?: UnitProps["languages"] }[] = [];
  if (props.year === 1897) {
    sections.push(
      { title: "Languages distribution", rows: props.languages },
      { title: "Religions distribution", rows: props.religions },
      { title: "Estates distribution", rows: props.estates }
    );
  } else {
    sections.push({ title: "Nationalities distribution", rows: props.nationalities });
  }

  return sections
    .map((s) => {
      const rows = s.rows ?? [];
      if (!rows.length) return "";
      const bars = rows
        .map((r) => {
          const pct = (100 * r.share).toFixed(1);
          return `<div class="bar-row">
            <div class="bar-meta"><span>${r.label}</span><span>${pct}% (${fmtInt(r.count)})</span></div>
            <div class="bar-track"><div class="bar-fill" style="width:${Math.max(2, 100 * r.share)}%"></div></div>
          </div>`;
        })
        .join("");
      return `<section class="group-block"><h3>${s.title}</h3>${bars}</section>`;
    })
    .join("");
}

const SEX_RATIO_TIP =
  "Male population divided by female population. 1.0 means equal counts; above 1.0 means more men than women, below 1.0 means women than women.";

function sexRatioStatLabel(): string {
  return `<dt class="stat-label">Sex ratio, M/F<button type="button" class="stat-tip" aria-expanded="false" aria-label="Explain sex ratio"><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="5" r="1" fill="currentColor"/><path d="M8 7.25v4.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button><span class="stat-tip-bubble" role="tooltip" hidden>${SEX_RATIO_TIP}</span></dt>`;
}

function bindStatTips(root: HTMLElement): void {
  root.querySelectorAll<HTMLButtonElement>(".stat-tip").forEach((btn) => {
    const bubble = btn.parentElement?.querySelector<HTMLElement>(".stat-tip-bubble");
    if (!bubble) return;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = bubble.hidden;
      root.querySelectorAll<HTMLElement>(".stat-tip-bubble").forEach((b) => {
        b.hidden = true;
      });
      root.querySelectorAll<HTMLButtonElement>(".stat-tip").forEach((b) => {
        b.setAttribute("aria-expanded", "false");
      });
      if (open) {
        bubble.hidden = false;
        btn.setAttribute("aria-expanded", "true");
      }
    });
  });
}

function closeStatTips(): void {
  document.querySelectorAll<HTMLElement>(".stat-tip-bubble").forEach((b) => {
    b.hidden = true;
  });
  document.querySelectorAll<HTMLButtonElement>(".stat-tip").forEach((b) => {
    b.setAttribute("aria-expanded", "false");
  });
}

function renderPanel(props: UnitProps): void {
  selectionEl.className = "selection";
  if (!unitHasCensus(props)) {
    selectionEl.innerHTML = `
      <p class="year-tag">${props.year} ◆ no census data</p>
      <h2>${props.nameEng || "Unnamed"}</h2>
      <p class="rus">${props.nameRus || ""}</p>
      <div class="census-callout">
        <p class="census-callout-title">Not enumerated</p>
        <p>${props.censusNote ?? "This unit has no demographic counts in the source census tables (DBF sentinel -1)."}</p>
      </div>
      <dl class="stats">
        <div><dt>Population</dt><dd>-</dd></div>
        <div><dt>Area</dt><dd>${props.areaKm2 != null ? `${fmtInt(props.areaKm2)} km²` : "-"}</dd></div>
        <div><dt>Population density</dt><dd>-</dd></div>
        <div><dt>Urban</dt><dd>-</dd></div>
        <div>${sexRatioStatLabel()}<dd>-</dd></div>
      </dl>
    `;
    bindStatTips(selectionEl);
    return;
  }
  const metric = currentMetric();
  const metricRow =
    metric.id === "none" || metric.id === "density" || metric.id === "sexRatio"
      ? ""
      : `<div><dt>${metric.label}</dt><dd>${metric.format(
          (props as Record<string, unknown>)[metric.id] as number | null
        )}</dd></div>`;
  selectionEl.innerHTML = `
    <p class="year-tag">Census ${props.year} under lens</p>
    <h2>${props.nameEng || "Unnamed"}</h2>
    <p class="rus">${props.nameRus || ""}</p>
    <dl class="stats">
      <div><dt>Population</dt><dd>${fmtInt(props.popAll)} people</dd></div>
      <div><dt>Area</dt><dd>${fmtInt(props.areaKm2)} km²</dd></div>
      <div><dt>Population density</dt><dd>${props.density != null ? `${props.density.toFixed(1)} people / km²` : "-"}</dd></div>
      <div><dt>Urban</dt><dd>${fmtPct(props.urbanPct)}</dd></div>
      <div>${sexRatioStatLabel()}<dd>${props.sexRatio?.toFixed(3) ?? "-"}</dd></div>
      ${metricRow}
    </dl>
    ${groupBlocks(props)}
  `;
  bindStatTips(selectionEl);
}

function applyChoropleth(): void {
  const m = map.map;
  if (!m || !m.getSource(SOURCE_ID)) return;
  const metric = currentMetric();

  const noCensusCase: ExpressionSpecification = [
    "case",
    ["==", ["get", "hasCensus"], false],
    NO_CENSUS_FILL,
    // GeoJSON boolean may arrive as string after some pipelines
    ["==", ["to-string", ["get", "hasCensus"]], "false"],
    NO_CENSUS_FILL,
  ];

  if (metric.id === "none") {
    m.setPaintProperty(FILL_ID, "fill-color", [
      ...noCensusCase,
      PLAIN_FILL,
    ] as ExpressionSpecification);
    renderLegend([], metric);
    return;
  }
  const values: number[] = [];
  for (const p of featuresById.values()) {
    if (!unitHasCensus(p)) continue;
    const v = (p as Record<string, unknown>)[metric.id];
    if (typeof v === "number" && Number.isFinite(v)) values.push(v);
  }
  const edges = quantiles(values, 5);
  m.setPaintProperty(FILL_ID, "fill-color", [
    ...noCensusCase,
    colorExpression(metric.id, edges),
  ] as ExpressionSpecification);
  renderLegend(edges, metric);
}

function resolveFeature(raw: UnitProps): UnitProps | null {
  return featuresById.get(raw.id) ?? null;
}

function setView(next: AppView): void {
  view = next;
  const showMap = next === "map";
  viewMap.classList.toggle("active", showMap);
  viewMap.hidden = !showMap;
  viewTable.classList.toggle("active", !showMap);
  viewTable.hidden = showMap;

  document.querySelectorAll<HTMLButtonElement>(".chip-btn[data-view]").forEach((btn) => {
    const on = btn.dataset.view === next;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });

  if (showMap) {
    // MapLibre needs a resize after becoming visible again.
    requestAnimationFrame(() => map.map?.resize());
  } else {
    void ensureRawTable(year);
  }

  const hash = next === "table" ? "#table" : "#map";
  if (location.hash !== hash) {
    history.replaceState(null, "", hash);
  }
}

async function ensureRawTable(y: number): Promise<void> {
  const cached = rawTableCache.get(y);
  if (cached) {
    tableView.setTable(cached);
    return;
  }
  tableView.setLoading(true);
  try {
    const res = await fetch(dataUrl(`table-${y}.json`));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const table = (await res.json()) as RawTable;
    rawTableCache.set(y, table);
    if (year === y && view === "table") {
      tableView.setTable(table);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    tableView.setError(`Could not load raw table for ${y}: ${msg}`);
  }
}

function syncYearButtons(): void {
  document.querySelectorAll<HTMLButtonElement>(".chip-btn[data-year]").forEach((btn) => {
    const on = Number(btn.dataset.year) === year;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });
}

function syncBasemapButtons(): void {
  document.querySelectorAll<HTMLButtonElement>(".chip-btn[data-basemap]").forEach((btn) => {
    const on = btn.dataset.basemap === basemap;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });
}

function fillOpacityForBasemap(): number {
  // Historical basemap needs more show-through than the modern Liberty style.
  return basemap === "historical" ? 0.55 : 0.82;
}

function applyOhmDateFilter(): void {
  const m = map.map;
  if (!m || basemap !== "historical") return;
  filterMapByYear(m, year);
}

function wireCensusLayerEvents(m: maplibregl.Map): void {
  if (censusEventsWired) return;
  censusEventsWired = true;

  m.on("click", FILL_ID, (e) => {
    const f = e.features?.[0];
    if (!f?.properties) return;
    const cached = resolveFeature(f.properties as UnitProps);
    if (!cached) return;
    const geom = featuresByIdGeom.get(cached.id);
    if (geom) lens.panUnitUnderLens(geom);
  });

  m.on("mouseenter", FILL_ID, () => {
    m.getCanvas().style.cursor = "pointer";
  });
  m.on("mouseleave", FILL_ID, () => {
    m.getCanvas().style.cursor = "";
  });
}

function ensureCensusLayers(geojson: GeoJSON.FeatureCollection): void {
  const m = map.map;
  if (!m) return;

  const existing = m.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  if (existing) {
    existing.setData(geojson);
    if (m.getLayer(FILL_ID)) {
      m.setPaintProperty(FILL_ID, "fill-opacity", fillOpacityForBasemap());
    }
  } else {
    // Insert under highlight layers when they already exist (e.g. after map load).
    const beforeId = m.getLayer("highlighted-units-fill")
      ? "highlighted-units-fill"
      : undefined;
    m.addSource(SOURCE_ID, { type: "geojson", data: geojson });
    m.addLayer(
      {
        id: FILL_ID,
        type: "fill",
        source: SOURCE_ID,
        paint: {
          "fill-color": PLAIN_FILL,
          "fill-opacity": fillOpacityForBasemap(),
        },
      },
      beforeId
    );
    m.addLayer(
      {
        id: LINE_ID,
        type: "line",
        source: SOURCE_ID,
        paint: {
          "line-color": "#3a2a1a",
          "line-width": 0.6,
          "line-opacity": 0.55,
        },
      },
      beforeId
    );
  }

  wireCensusLayerEvents(m);
}

function setBasemap(next: BasemapId): void {
  if (next === basemap) return;
  const m = map.map;
  if (!m) return;

  basemap = next;
  syncBasemapButtons();

  const token = ++basemapSwapToken;
  m.setStyle(BASEMAP_STYLES[next], { diff: false });
  m.once("style.load", () => {
    if (token !== basemapSwapToken) return;
    if (lastGeojson) {
      ensureCensusLayers(lastGeojson);
      applyChoropleth();
      lens.refresh();
    }
    applyOhmDateFilter();
  });
}

async function loadYear(y: number): Promise<void> {
  const m = map.map;
  if (!m) return;
  const res = await fetch(dataUrl(`${y}.geojson`));
  const geojson = (await res.json()) as GeoJSON.FeatureCollection;

  featuresById = new Map();
  featuresByIdGeom = new Map();
  for (const f of geojson.features) {
    const props = f.properties as UnitProps | null;
    if (!props?.id) continue;
    featuresById.set(props.id, props);
    if (f.geometry) featuresByIdGeom.set(props.id, f.geometry);
  }

  lastGeojson = geojson;
  ensureCensusLayers(geojson);
  applyOhmDateFilter();

  lens.setYear(y);
  lens.clear();
  applyChoropleth();
  lens.refresh();

  if (view === "table") {
    void ensureRawTable(y);
  }

  const bounds = new maplibregl.LngLatBounds();
  let any = false;
  for (const f of geojson.features) {
    const g = f.geometry;
    const coords: number[][] =
      g?.type === "Polygon"
        ? g.coordinates.flat()
        : g?.type === "MultiPolygon"
          ? g.coordinates.flat(2)
          : [];
    for (const [lng, lat] of coords) {
      if (lng >= 15 && lng <= 180 && lat >= 35 && lat <= 82) {
        bounds.extend([lng, lat]);
        any = true;
      }
    }
  }
  if (any && view === "map") {
    m.fitBounds(bounds, { padding: 40, duration: 600, maxZoom: 3.8 });
  }
}

function wireUi(): void {
  refreshMetricOptions();
  syncYearButtons();
  syncBasemapButtons();

  panelDrawerToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    setPanelDrawerOpen(!panelEl.classList.contains("is-open"));
  });

  mobilePanelMq.addEventListener("change", (e) => {
    if (!e.matches) setPanelDrawerOpen(false);
  });

  document.querySelectorAll<HTMLButtonElement>(".chip-btn[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = (btn.dataset.view as AppView) || "map";
      setView(next);
    });
  });

  document.querySelectorAll<HTMLButtonElement>(".chip-btn[data-year]").forEach((btn) => {
    btn.addEventListener("click", () => {
      year = Number(btn.dataset.year);
      syncYearButtons();
      refreshMetricOptions();
      void loadYear(year);
    });
  });

  document.querySelectorAll<HTMLButtonElement>(".chip-btn[data-basemap]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = (btn.dataset.basemap as BasemapId) || "modern";
      setBasemap(next);
    });
  });

  metricSelect.addEventListener("change", () => {
    metricId = metricSelect.value;
    applyChoropleth();
  });

  document.addEventListener("click", () => {
    closeStatTips();
  });

  window.addEventListener("hashchange", () => {
    setView(location.hash === "#table" ? "table" : "map");
  });
}

map.map?.on("load", () => {
  wireUi();
  const initial: AppView = location.hash === "#table" ? "table" : "map";
  setView(initial);
  void loadYear(year);
});
