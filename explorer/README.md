# The Transcultural Peoplescape Explorer

From Russian Empire subjects to Soviet citizens, this project shows population from the 1897 and 1926 censuses in maps and tables. The 1897 Imperial census asked people about social estate, native language, and religious affiliation, whereas the 1926 Soviet census asked them about "nationality" (ethnic group).

## Status
Phase 1: VisQuill + MapLibre choropleth explorer over the Sablin et al. 1897 / 1926 census GIS.

## Quick start

```bash
# regenerate GeoJSON from shapefiles (optional)
python scripts/prepare_geojson.py

cd explorer
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`).

## Lint

```bash
npm run lint        # ESLint (TypeScript)
npm run lint:fix   # auto-fix where possible
npm run typecheck   # tsc --noEmit
```

Python prep scripts (from repo root):

```bash
pip install ruff
python -m ruff check scripts
```

## What you get

- **Navbar** — Map / Data table views; shared 1897 · 1926 year toggle
- **Map view** — choropleth, fixed VisQuill lens, composition panels, province side panel
- **Data table** — full raw DBF attributes (all language / religion / estate / nationality columns); column-group filters; click a row to open on the map

## Data layout

| Path | Contents |
|------|----------|
| `data/raw/` | Source shapefiles + Description.pdf ([DOI 10.11588/data/10064](https://doi.org/10.11588/data/10064)) |
| `data/processed/` | MapLibre GeoJSON, field dictionaries, manifest |

The Vite app serves `data/processed` at `/data/*` in dev and copies it into `dist/data` on build.
