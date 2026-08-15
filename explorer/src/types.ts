export type GroupRow = {
  id: string;
  label: string;
  count: number;
  share: number;
};

export type UnitProps = {
  id: string;
  year: number;
  nameEng: string;
  nameRus: string;
  areaKm2: number | null;
  /** False when source DBF used -1 (not enumerated in that census). */
  hasCensus: boolean;
  censusNote?: string | null;
  popAll: number | null;
  popCity: number | null;
  popRural: number | null;
  popMale: number | null;
  popFemale: number | null;
  urbanPct: number | null;
  sexRatio: number | null;
  density: number | null;
  languages?: GroupRow[];
  religions?: GroupRow[];
  estates?: GroupRow[];
  nationalities?: GroupRow[];
  topLanguageShare?: number | null;
  topReligionShare?: number | null;
  topNationalityShare?: number | null;
};

export function unitHasCensus(props: UnitProps): boolean {
  // GeoJSON may stringify booleans; also fall back to null popAll.
  if (props.hasCensus === false || (props.hasCensus as unknown) === "false") {
    return false;
  }
  if (props.popAll == null) return false;
  return true;
}

export function fmtInt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "-";
  return new Intl.NumberFormat("en-US").format(Math.round(n));
}

export function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "-";
  return `${n.toFixed(digits)}%`;
}
