"""
Phase 0: shapefiles → GeoJSON + attribute dictionary + top-N composition.

Layout:
  data/raw/         source shapefiles (Sablin et al.)
  data/processed/   MapLibre GeoJSON + dictionaries + raw attribute tables
"""

from __future__ import annotations

import json
from pathlib import Path

import shapefile
from shapely.affinity import translate
from shapely.geometry import LineString, MultiPolygon, Polygon, mapping
from shapely.geometry import shape as shapely_shape
from shapely.ops import split, unary_union
from shapely.validation import make_valid

# Split Far East polygons that the source stores with lon > 180 (past the
# antimeridian). Naive lon-=360 wrapping leaves one ring spanning ~360° and
# MapLibre fills a band across the whole map (classic Primorskaya bug).
ANTIMERIDIAN = LineString([(180.0, -89.9), (180.0, 89.9)])

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "data" / "raw"
OUT = ROOT / "data" / "processed"
TOP_N = 8

# Human labels for 1897 coded fields (census category names, truncated in DBF).
LABELS_1897: dict[str, str] = {
    "NAMERUS": "Name (Russian)",
    "NAMEENG": "Name (English)",
    "AREAV": "Area (km²)",
    "POPALL": "Total population",
    "POPCITY": "Urban population",
    "POPRUR": "Rural population",
    "POPW": "Female population",
    "POPM": "Male population",
    "FOREIGNNAT": "Foreign nationals",
    # Languages (mother tongue)
    "LANVRUS": "Great Russian",
    "LANLRUS": "Little Russian (Ukrainian)",
    "LANBELORUS": "Belarusian",
    "LANPOLISH": "Polish",
    "LANCZECH": "Czech",
    "LANBULGARI": "Bulgarian",
    "LANSERBIAN": "Serbian",
    "LANLITHUAN": "Lithuanian",
    "LANZHMUDSK": "Samogitian (Zhmud)",
    "LANLATVIAN": "Latvian",
    "LANMOLDOVA": "Moldovan / Romanian",
    "LANFRENCH": "French",
    "LANITALIAN": "Italian",
    "LANGERMAN": "German",
    "LANSWEDISH": "Swedish",
    "LANNORWEGI": "Norwegian",
    "LANDUTCH": "Dutch",
    "LANENGLISH": "English",
    "LANJEWISH": "Jewish (Yiddish)",
    "LANGEORGIA": "Georgian",
    "LANGREEK": "Greek",
    "LANARMENIA": "Armenian",
    "LANALBANIA": "Albanian",
    "LANPERSIAN": "Persian",
    "LANTAJIK": "Tajik",
    "LANOSETIN": "Ossetian",
    "LANINDUSS": "Indian",
    "LANROMA": "Roma",
    "LANCIRCASS": "Circassian",
    "LANLEZGIAN": "Lezgian",
    "LANFINNISH": "Finnish",
    "LANVOTYATS": "Votyak (Udmurt)",
    "LANKARELIA": "Karelian",
    "LANIZHORSK": "Izhorian",
    "LANCHUDSKO": "Chud",
    "LANESTONIA": "Estonian",
    "LANLAPP": "Sámi (Lapp)",
    "LANZYRYANS": "Zyrian (Komi)",
    "LANPERMYAT": "Permyak",
    "LANMORDOVI": "Mordvin",
    "LANHUNGARI": "Hungarian",
    "LANCHEREMI": "Cheremis (Mari)",
    "LANTATAR": "Tatar",
    "LANBASHKIR": "Bashkir",
    "LANMEZCHER": "Meshcheryak",
    "LANTEPTYAR": "Teptyar",
    "LANCHUVASH": "Chuvash",
    "LANTURKISH": "Turkish",
    "LANTURKMEN": "Turkmen",
    "LANKIRGKAI": "Kirghiz-Kaisak",
    "LANKARAKIR": "Kara-Kirghiz",
    "LANSART": "Sart",
    "LANUZBEK": "Uzbek",
    "LANTARANCH": "Taranchi",
    "LANTURKIND": "Turkic (other)",
    "LANKALMYK": "Kalmyk",
    "LANMONGOL": "Mongol",
    "LANCHINEES": "Chinese",
    "LANKOREAN": "Korean",
    "LANSAMOYED": "Samoyed",
    "LANNODATA": "Language: no data",
    "LANSPANISH": "Spanish",
    "LANIMERETI": "Imeretian",
    "LANMIGRELI": "Mingrelian",
    "LANSVANETI": "Svan",
    "LANTALYSH": "Talysh",
    "LANTATIAN": "Tat",
    "LANKURDISH": "Kurdish",
    "LANAVGAN": "Afghan",
    "LANKABARDI": "Kabardian",
    "LANABKHAZ": "Abkhaz",
    "LANCHECHEN": "Chechen",
    "LANINGUSH": "Ingush",
    "LANKISTIN": "Kistin",
    "LANAVAR_AN": "Avar / Andi",
    "LANDARGIN": "Dargin",
    "LANKURIN": "Kurin",
    "LANUDIN": "Udi",
    "LANKAZI_KU": "Kazi-Kumukh",
    "LANOSTYACK": "Ostyak",
    "LANVOGULSK": "Vogul",
    "LANKARACHA": "Karachay",
    "LANKUMYK": "Kumyk",
    "LANNOGAY": "Nogai",
    "LANKARAPAP": "Karapapak",
    "LANKARAKAL": "Karakalpak",
    "LANKIPCHAK": "Kipchak",
    "LANKASHGAR": "Kashgarian",
    "LANYAKUT": "Yakut",
    "LANBURYAT": "Buryat",
    "LANTUNGUS": "Tungus",
    "LANMANZHUR": "Manchu",
    "LANCHUKOT": "Chukchi",
    "LANKORYAK": "Koryak",
    "LANKAMCHAD": "Kamchadal",
    "LANUKAGIR": "Yukagir",
    "LANCHUVAN": "Chuvan",
    "LANESKIMO": "Eskimo",
    "LANGILYAK": "Gilyak",
    "LANAIN": "Ainu",
    "LANALEUT": "Aleut",
    "LANENISEY_": "Yeniseian",
    "LANJAPANES": "Japanese",
    "LANARABIC": "Arabic",
    "LANAYSORSK": "Assyrian (Aysor)",
    "LANOTHERS": "Other languages",
    # Religion
    "RELORT": "Orthodox",
    "RELOLDBELI": "Old Believers",
    "RELARMG": "Armenian Gregorian",
    "REL_ARMC": "Armenian Catholic",
    "RELROMANCA": "Roman Catholic",
    "RELLUTHERA": "Lutheran",
    "RELREFORME": "Reformed",
    "RELBAPTIST": "Baptist",
    "RELMENNONI": "Mennonite",
    "RELANGLICA": "Anglican",
    "RELOTHERCH": "Other Christian",
    "RELCRIMKA": "Karaite",
    "RELJUDAISM": "Judaism",
    "RELMOHAMME": "Islam (Mohammedan)",
    "RELBUDDHLA": "Buddhism / Lamaism",
    "RELOTHERNC": "Other non-Christian",
    # Estate
    "ESTHEREDIT": "Hereditary nobility",
    "ESTNOBLESP": "Personal nobility",
    "ESTCLERGYW": "Clergy",
    "ESTHHONCIT": "Honoured citizens",
    "ESTMERCHAN": "Merchants",
    "ESTPHILIST": "Townspeople (meshchane)",
    "ESTPEASANT": "Peasants",
    "ESTARMYCOS": "Army / Cossacks",
    "ESTALIENS": "Aliens (inorodtsy)",
    "ESTFINNISH": "Finnish estate",
    "ESTNOMEMBE": "No estate membership",
    "ESTNODATA": "Estate: no data",
}

# 1926 nationality columns already use mostly English names in the DBF.
LABELS_1926_FIX: dict[str, str] = {
    "NameENG": "Name (English)",
    "NameRUS": "Name (Russian)",
    "AreaV": "Area (km²)",
    "PopALL": "Total population",
    "PopCITY": "Urban population",
    "PopRUR": "Rural population",
    "PopW": "Female population",
    "PopM": "Male population",
    "Ukranians": "Ukrainians",
    "Nationalit": "Nationality: unspecified",
    "Foreigners": "Foreigners",
    "Wizbang": "Kist (recorded as Wizbang)",
    "Jackie": "Dzhek / Jack",
    "Lucky": "Laks (recorded as Lucky)",
    "Huskies": "Eskimos (recorded as Huskies)",
    "Bosch": "Boza / Bosch",
    "Capuccin": "Kapuchin",
}

# Explicit source-DBF overrides (when auto-detection is not enough).
CORRECTIONS_1926: dict[str, dict[str, float]] = {}


def _unrotate_pop_triplet_if_needed(props: dict) -> bool:
    """Unrotate PopALL/PopCITY/PopRUR when the source DBF shifted them one slot.

    Bug pattern seen in several 1926 units (Chuvash ASSR, Stalingrad / Kaluga /
    Penza provinces): ALL holds urban, CITY holds rural, RUR holds total.
    Sex totals (PopM+PopW) already equal the true population (= mislabeled RUR).
    """
    all_ = num(props.get("PopALL"))
    city = num(props.get("PopCITY"))
    rural = num(props.get("PopRUR"))
    sex = num(props.get("PopM")) + num(props.get("PopW"))
    if rural <= 0 or sex <= 0:
        return False
    # Rotated signature: RUR == sex total, and ALL + CITY == that total,
    # while ALL is not already the total.
    if abs(sex - rural) > 0.5:
        return False
    if abs(all_ + city - rural) > 0.5:
        return False
    if abs(all_ - rural) < 0.5:
        return False
    props["PopALL"], props["PopCITY"], props["PopRUR"] = rural, all_, city
    return True


def apply_corrections_1926(rows: list[dict]) -> None:
    """Overwrite known bad DBF attributes in place before export."""
    for row in rows:
        p = row["props"]
        name = (p.get("NameENG") or "").strip()
        fix = CORRECTIONS_1926.get(name)
        if fix:
            p.update(fix)
            continue
        _unrotate_pop_triplet_if_needed(p)


def read_records(path: Path) -> tuple[list[str], list[dict]]:
    sf = shapefile.Reader(str(path))
    field_names = [f[0] for f in sf.fields[1:]]
    rows = []
    for sr in sf.iterShapeRecords():
        props = {}
        for name, val in zip(field_names, sr.record, strict=True):
            if isinstance(val, bytes):
                val = val.decode("cp1251", errors="replace").strip()
            elif isinstance(val, str):
                val = val.strip()
            props[name] = val
        rows.append({"props": props, "shape": sr.shape})
    return field_names, rows


def _shift_into_world(geom: Polygon | MultiPolygon) -> Polygon | MultiPolygon:
    """Translate pieces so longitudes sit in (-180, 180]."""
    minx, _, maxx, _ = geom.bounds
    if minx > 180 or (minx >= 180 and maxx > 180):
        return translate(geom, xoff=-360.0)
    if maxx < -180:
        return translate(geom, xoff=360.0)
    return geom


def _cut_at_antimeridian(poly: Polygon) -> list[Polygon]:
    """Return polygon pieces with longitudes in (-180, 180], split at 180° if needed."""
    poly = make_valid(poly)
    if poly.is_empty:
        return []

    geoms: list[Polygon] = []
    if isinstance(poly, MultiPolygon):
        geoms = [g for g in poly.geoms if isinstance(g, Polygon) and not g.is_empty]
    elif isinstance(poly, Polygon):
        geoms = [poly]
    else:
        # make_valid can yield GeometryCollection
        geoms = [g for g in getattr(poly, "geoms", []) if isinstance(g, Polygon) and not g.is_empty]

    out: list[Polygon] = []
    for g in geoms:
        minx, _, maxx, _ = g.bounds
        if maxx <= 180.0 and minx >= -180.0:
            out.append(g)
            continue
        if minx >= 180.0:
            shifted = _shift_into_world(g)
            if isinstance(shifted, Polygon) and not shifted.is_empty:
                out.append(shifted)
            continue
        if maxx > 180.0 and minx < 180.0:
            cut = split(g, ANTIMERIDIAN)
            for piece in cut.geoms:
                piece = make_valid(piece)
                if piece.is_empty:
                    continue
                pieces = (
                    [piece]
                    if isinstance(piece, Polygon)
                    else [p for p in getattr(piece, "geoms", []) if isinstance(p, Polygon)]
                )
                for p in pieces:
                    shifted = _shift_into_world(p)
                    if isinstance(shifted, Polygon) and not shifted.is_empty:
                        out.append(shifted)
            continue
        # lon < -180 only (unlikely in this dataset)
        shifted = _shift_into_world(g)
        if isinstance(shifted, Polygon) and not shifted.is_empty:
            out.append(shifted)
    return out


def shape_to_geojson_geom(shape: shapefile.Shape) -> dict | None:
    """Convert pyshp polygon to GeoJSON, splitting rings that cross the antimeridian.

    The 1897 Primorskaya oblast (and a few island parts) are digitized with
    longitudes up to ~191°. Wrapping alone is not enough — rings must be cut
    at 180° or MapLibre draws a continent-wide fill.

    Rings are assembled via pyshp's GeoJSON interface so ESRI hole rings
    (CCW interiors / enclaves) stay holes. Treating every part as a filled
    polygon and unioning them used to paint enclaves solid and cover nested
    child units.
    """
    if shape.shapeType not in (shapefile.POLYGON, 5):
        return None

    try:
        geom = shapely_shape(shape.__geo_interface__)
    except Exception:
        return None

    geom = make_valid(geom)
    if geom.is_empty:
        return None

    if isinstance(geom, Polygon):
        candidates = [geom]
    elif isinstance(geom, MultiPolygon):
        candidates = [g for g in geom.geoms if isinstance(g, Polygon) and not g.is_empty]
    else:
        candidates = [
            g
            for g in getattr(geom, "geoms", [])
            if isinstance(g, Polygon) and not g.is_empty
        ]

    polys: list[Polygon] = []
    for poly in candidates:
        polys.extend(_cut_at_antimeridian(poly))

    if not polys:
        return None

    merged = unary_union(polys)
    merged = make_valid(merged)
    if merged.is_empty:
        return None

    # Collapse to MultiPolygon / Polygon for stable GeoJSON.
    if isinstance(merged, Polygon):
        return mapping(merged)
    if isinstance(merged, MultiPolygon):
        return mapping(merged)

    collected = [
        g
        for g in getattr(merged, "geoms", [])
        if isinstance(g, Polygon) and not g.is_empty
    ]
    if not collected:
        return None
    if len(collected) == 1:
        return mapping(collected[0])
    return mapping(MultiPolygon(collected))


def num(v) -> float:
    try:
        if v is None or v == "":
            return 0.0
        return float(v)
    except (TypeError, ValueError):
        return 0.0


# DBF sentinel: units outside the 1897 Imperial Census enumeration
# (Grand Duchy of Finland; Bukhara & Khiva protectorates).
CENSUS_MISSING = -1.0

FINLAND_NOTES = (
    "Grand Duchy of Finland — not enumerated in the 1897 Imperial Census "
    "(separate Finnish statistical system)."
)
PROTECTORATE_NOTES = (
    "Russian protectorate — not enumerated in the 1897 Imperial Census."
)


def census_note_1897(name_eng: str, name_rus: str) -> str:
    blob = f"{name_eng} {name_rus}".lower()
    if any(k in blob for k in ("bukhara", "бухар", "khiva", "хив")):
        return PROTECTORATE_NOTES
    return FINLAND_NOTES


def has_census_data(props: dict, pop_key: str = "POPALL") -> bool:
    """True when the unit has real census counts (sentinel -1 means absent)."""
    return num(props.get(pop_key)) > CENSUS_MISSING + 0.5


def top_groups(
    props: dict, keys: list[str], labels: dict[str, str], n: int = TOP_N
) -> tuple[list[dict], float]:
    items = []
    total = 0.0
    for k in keys:
        c = num(props.get(k))
        if c <= 0:
            continue
        total += c
        items.append((k, c))
    items.sort(key=lambda t: -t[1])
    top = items[:n]
    other = sum(c for _, c in items[n:])
    out = [
        {
            "id": k,
            "label": labels.get(k, k),
            "count": int(round(c)),
            "share": round(c / total, 4) if total else 0.0,
        }
        for k, c in top
    ]
    if other > 0 and total > 0:
        out.append(
            {
                "id": "_other",
                "label": "Other",
                "count": int(round(other)),
                "share": round(other / total, 4),
            }
        )
    return out, total


def column_group_1897(field: str) -> str:
    if field.startswith("LAN"):
        return "language"
    if field.startswith("REL"):
        return "religion"
    if field.startswith("EST"):
        return "estate"
    return "core"


def column_group_1926(field: str, meta: set[str]) -> str:
    if field in meta:
        return "core"
    return "nationality"


def build_raw_table(
    year: int,
    fields: list[str],
    rows: list[dict],
    labels: dict[str, str],
    group_of,
) -> dict:
    # Infer numeric columns from DBF values (pyshp returns float for N fields).
    numeric: dict[str, bool] = {}
    for f in fields:
        has_num = False
        has_str = False
        for r in rows:
            v = r["props"].get(f)
            if v in (None, ""):
                continue
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                has_num = True
            else:
                try:
                    float(v)
                    has_num = True
                except (TypeError, ValueError):
                    has_str = True
                    break
        numeric[f] = has_num and not has_str

    columns = [
        {
            "id": f,
            "label": labels.get(f, f),
            "type": "number" if numeric[f] else "string",
            "group": group_of(f),
        }
        for f in fields
    ]

    out_rows = []
    for i, row in enumerate(rows):
        p = row["props"]
        enumerated = True
        if year == 1897:
            enumerated = has_census_data(p, "POPALL")
        rec: dict = {
            "_id": f"{year}-{i:03d}",
            "_hasCensus": enumerated,
        }
        if year == 1897 and not enumerated:
            rec["_censusNote"] = census_note_1897(
                str(p.get("NAMEENG") or ""), str(p.get("NAMERUS") or "")
            )
        for f in fields:
            v = p.get(f)
            if numeric[f]:
                if v in (None, ""):
                    rec[f] = None
                else:
                    n = num(v)
                    # Preserve semantic missingness: -1 → null
                    if n <= CENSUS_MISSING + 0.5:
                        rec[f] = None
                    else:
                        rec[f] = int(n) if n == int(n) else n
            else:
                rec[f] = "" if v is None else str(v)
        out_rows.append(rec)

    groups = []
    for g in ("core", "language", "religion", "estate", "nationality"):
        if any(c["group"] == g for c in columns):
            groups.append(g)

    return {
        "year": year,
        "source": "DBF attribute table (geometry excluded)",
        "missingSentinel": CENSUS_MISSING,
        "missingNote": (
            "Numeric -1 in the source DBF marks units not enumerated "
            "in that census; exported here as null."
            if year == 1897
            else None
        ),
        "columns": columns,
        "groups": groups,
        "rows": out_rows,
    }


def build_1897() -> tuple[dict, dict, dict, dict]:
    fields, rows = read_records(SRC / "1897RussianEmpire")
    lan = [f for f in fields if f.startswith("LAN")]
    rel = [f for f in fields if f.startswith("REL")]
    est = [f for f in fields if f.startswith("EST")]

    features = []
    no_census = 0
    for i, row in enumerate(rows):
        p = row["props"]
        geom = shape_to_geojson_geom(row["shape"])
        if geom is None:
            continue
        fid = f"1897-{i:03d}"
        name_eng = p.get("NAMEENG") or ""
        name_rus = p.get("NAMERUS") or ""
        enumerated = has_census_data(p, "POPALL")

        if not enumerated:
            no_census += 1
            features.append(
                {
                    "type": "Feature",
                    "id": fid,
                    "properties": {
                        "id": fid,
                        "year": 1897,
                        "nameEng": name_eng,
                        "nameRus": name_rus,
                        "areaKm2": round(num(p.get("AREAV")), 2)
                        if num(p.get("AREAV")) > 0
                        else None,
                        "hasCensus": False,
                        "censusNote": census_note_1897(name_eng, name_rus),
                        "popAll": None,
                        "popCity": None,
                        "popRural": None,
                        "popMale": None,
                        "popFemale": None,
                        "urbanPct": None,
                        "sexRatio": None,
                        "density": None,
                        "languages": [],
                        "religions": [],
                        "estates": [],
                        "topLanguageShare": None,
                        "topReligionShare": None,
                    },
                    "geometry": geom,
                }
            )
            continue

        pop = num(p.get("POPALL"))
        city = num(p.get("POPCITY"))
        rural = num(p.get("POPRUR"))
        male = num(p.get("POPM"))
        female = num(p.get("POPW"))
        langs, _ = top_groups(p, lan, LABELS_1897)
        religions, _ = top_groups(p, rel, LABELS_1897)
        estates, _ = top_groups(p, est, LABELS_1897)
        features.append(
            {
                "type": "Feature",
                "id": fid,
                "properties": {
                    "id": fid,
                    "year": 1897,
                    "nameEng": name_eng,
                    "nameRus": name_rus,
                    "areaKm2": round(num(p.get("AREAV")), 2),
                    "hasCensus": True,
                    "censusNote": None,
                    "popAll": int(round(pop)),
                    "popCity": int(round(city)),
                    "popRural": int(round(rural)),
                    "popMale": int(round(male)),
                    "popFemale": int(round(female)),
                    "urbanPct": round(100 * city / pop, 2) if pop else 0.0,
                    "sexRatio": round(male / female, 3) if female else None,
                    "density": round(pop / num(p.get("AREAV")), 2)
                    if num(p.get("AREAV"))
                    else None,
                    "languages": langs,
                    "religions": religions,
                    "estates": estates,
                    "topLanguageShare": langs[0]["share"] if langs else 0.0,
                    "topReligionShare": religions[0]["share"] if religions else 0.0,
                },
                "geometry": geom,
            }
        )

    dictionary = {
        "year": 1897,
        "groups": {
            "languages": {k: LABELS_1897.get(k, k) for k in lan},
            "religions": {k: LABELS_1897.get(k, k) for k in rel},
            "estates": {k: LABELS_1897.get(k, k) for k in est},
        },
        "core": {k: LABELS_1897[k] for k in LABELS_1897 if not k.startswith(("LAN", "REL", "EST"))},
        "censusMissing": {
            "sentinel": CENSUS_MISSING,
            "units": no_census,
            "note": (
                "Ten 1897 units use -1 in the source DBF for all demographic "
                "fields: eight Grand Duchy of Finland guberniyas plus the "
                "Bukhara Emirate and Khiva Khanate protectorates — not "
                "enumerated in the Imperial Census."
            ),
        },
    }
    enumerated_feats = [f for f in features if f["properties"]["hasCensus"]]
    manifest = {
        "year": 1897,
        "units": len(features),
        "unitsWithCensus": len(enumerated_feats),
        "unitsWithoutCensus": no_census,
        "population": sum(f["properties"]["popAll"] for f in enumerated_feats),
        "urbanPct": round(
            100
            * sum(f["properties"]["popCity"] for f in enumerated_feats)
            / max(1, sum(f["properties"]["popAll"] for f in enumerated_feats)),
            1,
        ),
        "choroplethFields": [
            "urbanPct",
            "sexRatio",
            "density",
            "topLanguageShare",
            "topReligionShare",
        ],
        "rawTable": "table-1897.json",
    }
    labels = {f: LABELS_1897.get(f, f) for f in fields}
    table = build_raw_table(1897, fields, rows, labels, column_group_1897)
    fc = {"type": "FeatureCollection", "features": features}
    return fc, dictionary, manifest, table


def build_1926() -> tuple[dict, dict, dict, dict]:
    fields, rows = read_records(SRC / "1926SovietUnion")
    apply_corrections_1926(rows)
    meta = {
        "Id",
        "NameENG",
        "NameRUS",
        "AreaV",
        "PopALL",
        "PopCITY",
        "PopRUR",
        "PopW",
        "PopM",
    }
    nats = [f for f in fields if f not in meta]
    labels = {k: LABELS_1926_FIX.get(k, k) for k in fields}

    features = []
    for i, row in enumerate(rows):
        p = row["props"]
        geom = shape_to_geojson_geom(row["shape"])
        if geom is None:
            continue
        pop = num(p.get("PopALL"))
        city = num(p.get("PopCITY"))
        rural = num(p.get("PopRUR"))
        male = num(p.get("PopM"))
        female = num(p.get("PopW"))
        nationalities, _ = top_groups(p, nats, labels)
        fid = f"1926-{i:03d}"
        features.append(
            {
                "type": "Feature",
                "id": fid,
                "properties": {
                    "id": fid,
                    "year": 1926,
                    "nameEng": p.get("NameENG") or "",
                    "nameRus": p.get("NameRUS") or "",
                    "areaKm2": round(num(p.get("AreaV")), 2),
                    "hasCensus": True,
                    "censusNote": None,
                    "popAll": int(round(pop)),
                    "popCity": int(round(city)),
                    "popRural": int(round(rural)),
                    "popMale": int(round(male)),
                    "popFemale": int(round(female)),
                    "urbanPct": round(100 * city / pop, 2) if pop else 0.0,
                    "sexRatio": round(male / female, 3) if female else None,
                    "density": round(pop / num(p.get("AreaV")), 2)
                    if num(p.get("AreaV"))
                    else None,
                    "nationalities": nationalities,
                    "topNationalityShare": nationalities[0]["share"]
                    if nationalities
                    else 0.0,
                },
                "geometry": geom,
            }
        )

    dictionary = {
        "year": 1926,
        "groups": {"nationalities": {k: labels[k] for k in nats}},
        "core": {k: labels[k] for k in meta if k in labels},
    }
    manifest = {
        "year": 1926,
        "units": len(features),
        "population": sum(f["properties"]["popAll"] for f in features),
        "urbanPct": round(
            100
            * sum(f["properties"]["popCity"] for f in features)
            / max(1, sum(f["properties"]["popAll"] for f in features)),
            1,
        ),
        "choroplethFields": [
            "urbanPct",
            "sexRatio",
            "density",
            "topNationalityShare",
        ],
        "rawTable": "table-1926.json",
    }
    table = build_raw_table(
        1926, fields, rows, labels, lambda f: column_group_1926(f, meta)
    )
    fc = {"type": "FeatureCollection", "features": features}
    return fc, dictionary, manifest, table


def write_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    mb = path.stat().st_size / (1024 * 1024)
    print(f"  wrote {path.relative_to(ROOT)} ({mb:.2f} MB)")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    print("Building 1897…")
    fc97, dict97, man97, table97 = build_1897()
    write_json(OUT / "1897.geojson", fc97)
    write_json(OUT / "dictionary-1897.json", dict97)
    write_json(OUT / "table-1897.json", table97)

    print("Building 1926…")
    fc26, dict26, man26, table26 = build_1926()
    write_json(OUT / "1926.geojson", fc26)
    write_json(OUT / "dictionary-1926.json", dict26)
    write_json(OUT / "table-1926.json", table26)

    write_json(
        OUT / "manifest.json",
        {
            "dataset": "Transcultural Empire (Sablin et al.)",
            "doi": "https://doi.org/10.11588/data/10064",
            "topN": TOP_N,
            "years": [man97, man26],
        },
    )
    print("Done.")


if __name__ == "__main__":
    main()
