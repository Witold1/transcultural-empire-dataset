/**
 * Year filter for OpenHistoricalMap vector styles.
 * Follows the expression-filter path used by @openhistoricalmap/maplibre-gl-dates.
 */
import type { FilterSpecification, Map as MapLibreMap } from "maplibre-gl";

const VAR_START_DEC = "maplibre_gl_dates__startDecimalYear";
const VAR_START_ISO = "maplibre_gl_dates__startISODate";
const VAR_END_DEC = "maplibre_gl_dates__endDecimalYear";
const VAR_END_ISO = "maplibre_gl_dates__endISODate";

type DateRange = {
  startDecimalYear: number;
  startISODate: string;
  endDecimalYear: number;
  endISODate: string;
};

function dateRangeForYear(year: number): DateRange {
  return {
    startDecimalYear: year,
    startISODate: `${year}-01-01`,
    endDecimalYear: year + 1,
    endISODate: `${year + 1}-01-01`,
  };
}

function updateLetVariable(
  expr: unknown[],
  name: string,
  value: number | string
): void {
  const idx = expr.indexOf(name);
  if (idx !== -1 && idx % 2 === 1) {
    expr[idx + 1] = value;
    return;
  }
  expr.splice(-1, 0, name, value);
}

function constrainFilter(
  filter: FilterSpecification | null | undefined,
  range: DateRange
): FilterSpecification {
  if (Array.isArray(filter) && filter[0] === "let") {
    const next = [...filter] as unknown[];
    updateLetVariable(next, VAR_START_DEC, range.startDecimalYear);
    updateLetVariable(next, VAR_START_ISO, range.startISODate);
    updateLetVariable(next, VAR_END_DEC, range.endDecimalYear);
    updateLetVariable(next, VAR_END_ISO, range.endISODate);
    return next as FilterSpecification;
  }

  const overlap: FilterSpecification = [
    "all",
    [
      "any",
      [
        "all",
        ["has", "start_decdate"],
        ["<", ["get", "start_decdate"], ["var", VAR_END_DEC]],
      ],
      [
        "all",
        ["!", ["has", "start_decdate"]],
        ["has", "start_date"],
        ["<", ["get", "start_date"], ["var", VAR_END_ISO]],
      ],
      ["all", ["!", ["has", "start_decdate"]], ["!", ["has", "start_date"]]],
    ],
    [
      "any",
      [
        "all",
        ["has", "end_decdate"],
        [">=", ["get", "end_decdate"], ["var", VAR_START_DEC]],
      ],
      [
        "all",
        ["!", ["has", "end_decdate"]],
        ["has", "end_date"],
        [">=", ["get", "end_date"], ["var", VAR_START_ISO]],
      ],
      ["all", ["!", ["has", "end_decdate"]], ["!", ["has", "end_date"]]],
    ],
  ];

  if (filter) {
    (overlap as unknown[]).push(filter);
  }

  return [
    "let",
    VAR_START_DEC,
    range.startDecimalYear,
    VAR_START_ISO,
    range.startISODate,
    VAR_END_DEC,
    range.endDecimalYear,
    VAR_END_ISO,
    range.endISODate,
    overlap,
  ];
}

/** Keep OHM features that overlap the given calendar year. */
export function filterMapByYear(map: MapLibreMap, year: number): void {
  const range = dateRangeForYear(year);
  const style = map.getStyle();
  if (!style?.layers) return;

  for (const layer of style.layers) {
    if (!("source-layer" in layer) || !layer["source-layer"]) continue;
    const current = map.getFilter(layer.id) as FilterSpecification | null | undefined;
    map.setFilter(layer.id, constrainFilter(current, range));
  }
}
