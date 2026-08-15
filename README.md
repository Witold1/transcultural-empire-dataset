# Transcultural Empire Peoplespace

![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-6-646CFF?style=flat-square&logo=vite&logoColor=white)
![MapLibre](https://img.shields.io/badge/Map-MapLibre%20GL-7DCDE3?style=flat-square)
![VisQuill](https://img.shields.io/badge/Lens-VisQuill-1B1F24?style=flat-square)
![Python](https://img.shields.io/badge/Prep-Python%20%2B%20shapely-3776AB?style=flat-square&logo=python&logoColor=white)
![GeoJSON](https://img.shields.io/badge/Data-GeoJSON-000000?style=flat-square)
![Status](https://img.shields.io/badge/Status-wip-orange?style=flat-square)
![License](https://img.shields.io/badge/License-MIT%20%2B%20DOI%20data-lightgrey?style=flat-square)
![AI Assistance](https://img.shields.io/badge/AI--Assistance-high-informational?style=flat-square)


From Russian Empire subjects to Soviet citizens, this project illustrates the population changes using data from the 1897 and 1926 censuses via maps and tables. The 1897 Imperial census asked respondents about their social estate, native language, and religious affiliation, whereas the 1926 Soviet census asked about "nationality" (self-declared "narodnost", in the sense of ethnic identity) and native language (for some reason not included in this dataset). Backbone data comes from [Sablin et al. doi:10.11588/DATA/10064](https://doi.org/10.11588/data/10064). You can see examples of original census forms under [Documents of the General Population Census of 1897](https://yulianovozhilova.ru/perepis1897-doc) and [Population census of 1926. Types of documents](https://yulianovozhilova.ru/per1926).

## Description

### 1. Views

| View | Meaning |
|------|---------|
| Map | Province choropleth, fixed VisQuill lens, composition panels, side panel |
| Data table | Full DBF attributes (language / religion / estate / nationality); click a row to open that unit on the map |

Shared **1897 · 1926** year toggle across both views.

### 2. Years

| Year | Units | Population (manifest) | Choropleth examples |
|------|-------|------------------------|---------------------|
| 1897 | 99 (89 with census) | ~126M | urban %, sex ratio, density, top language / religion share |
| 1926 | 67 | ~149M | total/urban/rural, sex ratio, density, top nationality share |

## Data

| Path | Contents |
|------|----------|
| `data/raw/` | Source shapefiles + Description.pdf |
| `data/processed/` | MapLibre GeoJSON, field dictionaries, full attribute tables, `manifest.json` |

Rebuild processed outputs (do not edit them by hand):

```bash
python scripts/prepare_geojson.py
```

Needs `pyshp` and `shapely`. Known source quirks (e.g. rotated 1926 population columns) are fixed in the processor - see [`data/processed/README.md`](data/processed/README.md).

## Run locally

```bash
cd explorer
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`). In dev, Vite serves `data/processed` at `/data/*`; `npm run build` copies it into `dist/data`.

### GitHub Pages

Push to `main` (or `master`) runs [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml), which builds the explorer with `BASE_PATH=/<repo-name>/` and deploys `explorer/dist`.

One-time repo setup: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

Site URL will be `https://<user>.github.io/<repo-name>/`.

### Lint / typecheck

```bash
cd explorer
npm run lint        # ESLint
npm run typecheck   # tsc --noEmit

# Python prep scripts (from repo root; needs: pip install ruff)
python -m ruff check scripts
```

More explorer notes: [`explorer/README.md`](explorer/README.md).

## Layout

```text
data/
  raw/              Sablin et al. shapefiles
  processed/        GeoJSON + dictionaries + tables
explorer/           Vite app (MapLibre + VisQuill)
scripts/
  prepare_geojson.py
```

## Next steps (ideas)

- Period-matched historical basemaps under the choropleth - swap by year instead of a modern OSM backdrop.
  - [OpenHistoricalMap](https://www.openhistoricalmap.org/) - easy to wire in; label and border coverage for these periods still thin.
  - [Map Warper](https://mapwarper.net/) - georeferenced scans as tiles; a 1914 Russian Empire sheet looked strong enough to try.
  - Purpose-crafted georeferenced tiles - own control sheet(s) if OHM / warper sources do not land well at empire scale.

## License & credit

| Part | License |
|------|---------|
| Code (explorer, scripts) | [MIT](LICENSE) |
| Census GIS under `data/` (Sablin et al.) | Per [DOI 10.11588/data/10064](https://doi.org/10.11588/data/10064) - see [LICENSE-DATA](LICENSE-DATA) |

_Made with AI. Curated by Human._
