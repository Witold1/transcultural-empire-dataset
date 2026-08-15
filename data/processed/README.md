# Processed data

Outputs of `scripts/prepare_geojson.py`, built from the Sablin et al. shapefiles in `data/raw/`. Do not edit these files by hand — regenerate them instead:

```bash
python scripts/prepare_geojson.py
```

| File | Contents |
|------|----------|
| `1897.geojson` / `1926.geojson` | MapLibre FeatureCollections (geometry + derived metrics) |
| `dictionary-1897.json` / `dictionary-1926.json` | Field labels by group (language / religion / estate / nationality) |
| `table-1897.json` / `table-1926.json` | Full DBF attribute tables (geometry excluded) for the explorer data view |
| `manifest.json` | Year summaries, choropleth fields, table pointers |

The explorer serves this folder at `/data/*` in dev and copies it into `dist/data` on build.

## Source corrections applied at build time

Raw shapefiles are left unchanged. Known attribute problems are fixed in the processor before GeoJSON / tables are written.

### 1926: rotated population columns

In several 1926 units, `PopALL`, `PopCITY`, and `PopRUR` are shifted one slot in the source DBF:

| DBF field | What it actually contains |
|-----------|---------------------------|
| `PopALL` | Urban population |
| `PopCITY` | Rural population |
| `PopRUR` | Total population |

Male / female counts (`PopM`, `PopW`) are correct: their sum equals the true total (the value sitting in `PopRUR`).

**Detection.** A unit is treated as rotated when:

1. `PopM + PopW == PopRUR`
2. `PopALL + PopCITY == PopRUR`
3. `PopALL` is not already equal to that total

**Fix.** The triplet is unrotated to the normal layout:

`PopALL` ← total, `PopCITY` ← urban, `PopRUR` ← rural

Units corrected this way (as of the current source DBF):

- Chuvash ASSR
- Stalingrad province
- Kaluga province
- Penza province

Logic lives in `apply_corrections_1926` / `_unrotate_pop_triplet_if_needed` in `scripts/prepare_geojson.py`. Explicit per-unit overrides can also be added via `CORRECTIONS_1926` when auto-detection is not enough.
