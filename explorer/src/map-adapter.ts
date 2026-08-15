/**
 * map-adapter.ts
 *
 * Thin wrapper around MapLibre GL JS for VisQuill map overlays.
 *
 * MapAdapter.create() handles all mounting boilerplate: DOM layout,
 * pointer-event routing, wheel forwarding, and the glass pane.
 * Returns { map, rvg } - everything you need to start building.
 */

import * as maplibregl from "maplibre-gl";
import {
    VisQuill, Reactive, Svg,
    Boxes, type RvgBox, type RvgHandle,
} from "@visquill/visquill-gdk";
import type { Point } from "@visquill/visquill-gdk";

export interface LatLng { lat: number; lng: number }

export interface MapOptions {
    center?:  [number, number]; // [lng, lat]
    zoom?:    number;
    minZoom?: number;
    maxZoom?: number;
    style?:   string;
}

export interface MapScene {
    map: MapAdapter;
    rvg: ReturnType<typeof VisQuill.create>;
}

export class MapAdapter {

    // ── Static factory ───────────────────────────────────────────────────────

    /**
     * Creates a MapLibre map and a VisQuill scene layered on top of it.
     *
     * DOM structure:
     *
     *   container  (position: relative)
     *   ├── mapDiv    z-index 1  ← MapLibre WebGL canvas
     *   └── sceneDiv  z-index 2  ← VisQuill SVG overlay (pointer-events: none)
     *
     * Call trackHandle(handle) on any draggable handle to enable the glass
     * pane during drag - prevents the map from panning while dragging.
     */
    static create(
        container: HTMLDivElement,
        cssPrefix: string,
        options:   MapOptions = {}
    ): MapScene {
        // Ensure MapLibre CSS is loaded (works in both dev and production)
        if (!document.querySelector("link[data-maplibre-css]")) {
            const link = document.createElement("link");
            link.rel = "stylesheet";
            link.href = new URL(
                "maplibre-gl/dist/maplibre-gl.css",
                import.meta.url
            ).href;
            link.dataset.maplibreCss = "";
            document.head.appendChild(link);
        }

        // DOM layout
        container.style.position = "relative";
        container.style.width    = "100%";
        container.style.height   = "100%";

        const mapDiv = document.createElement("div");
        mapDiv.style.cssText = "position:absolute;inset:0;z-index:1";
        container.appendChild(mapDiv);

        const sceneDiv = document.createElement("div");
        sceneDiv.style.cssText =
            "position:absolute;inset:0;z-index:2;pointer-events:none";
        container.appendChild(sceneDiv);

        // Map + scene
        const map = new MapAdapter();
        map._mount(mapDiv, options);

        const rvg    = VisQuill.create(sceneDiv, cssPrefix);
        const canvas = rvg.canvas;
        Svg.get(canvas).style.pointerEvents = "none";

        // Glass pane
        const glassPane = canvas.visuals.box("glass-pane") as RvgBox;
        Reactive.do([rvg.frame], () => { Boxes.copy(rvg.frame, glassPane); });
        Svg.get(glassPane).style.pointerEvents = "none";

        map._glassPane = glassPane;

        // Wheel forwarding
        const mapCanvas = map.getCanvas();
        if (mapCanvas) {
            Svg.get(canvas).addEventListener("wheel", (e: WheelEvent) => {
                e.preventDefault();
                mapCanvas.dispatchEvent(new WheelEvent("wheel", e));
            }, { passive: false });
        }

        return { map, rvg };
    }

    // ── Instance state ───────────────────────────────────────────────────────

    public map: maplibregl.Map | null = null;
    private _glassPane:   RvgBox | null = null;
    private _activeCount: number = 0;

    // ── Lifecycle ────────────────────────────────────────────────────────────

    private _mount(container: HTMLDivElement, options: MapOptions = {}): void {
        const {
            center  = [10.0, 51.0],
            zoom    = 5,
            minZoom,
            maxZoom,
            style   = "https://tiles.openfreemap.org/styles/liberty",
        } = options;

        this.map = new maplibregl.Map({
            container,
            style,
            center,
            zoom,
            ...(minZoom !== undefined && { minZoom }),
            ...(maxZoom !== undefined && { maxZoom }),
            attributionControl: {
                compact: true,
                customAttribution: [
                    'Source data: Sablin et al. <a href="https://doi.org/10.11588/DATA/10064" target="_blank" rel="noreferrer">doi:10.11588/DATA/10064</a>',
                    'Built with <a href="https://visquill.com/developers" target="_blank" rel="noreferrer">VisQuill GDK</a> + <a href="https://maplibre.org/" target="_blank" rel="noreferrer">MapLibre</a>',
                ],
            },
        });
    }

    destroy(): void {
        this.map?.remove();
        this.map = null;
    }

    // ── Handle tracking ──────────────────────────────────────────────────────

    /**
     * Registers a draggable handle so the glass pane activates during drag.
     * Multiple handles are reference-counted.
     */
    trackHandle(handle: RvgHandle): void {
        if (!this._glassPane) return;
        const glassPane = this._glassPane;

        Reactive.do([handle.active], () => {
            this._activeCount += handle.active.value ? 1 : -1;
            this._activeCount = Math.max(0, this._activeCount);
            Svg.get(glassPane).style.pointerEvents =
                this._activeCount > 0 ? "all" : "none";
        }, false);
    }

    // ── Coordinate conversion ────────────────────────────────────────────────

    /** Screen pixels → geographic coordinates. */
    screenToLatLng(x: number, y: number): LatLng {
        if (!this.map) return { lat: 0, lng: 0 };
        const ll = this.map.unproject([x, y] as maplibregl.PointLike);
        return { lat: ll.lat, lng: ll.lng };
    }

    /** Geographic coordinates → screen pixels (call on every render frame). */
    latLngToScreen(p: { lat: number; lon: number }): Point {
        if (!this.map) return { x: 0, y: 0 };
        return this.map.project([p.lon, p.lat]);
    }

    // ── Event hooks ──────────────────────────────────────────────────────────

    /** Fires on every pan/zoom frame + on move end. */
    onMove(cb: () => void): void {
        if (!this.map) return;
        this.map.on("move",    cb);
        this.map.on("moveend", cb);
    }

    /** Fires on every MapLibre render frame (including tile redraws). */
    onRender(cb: () => void): void {
        if (!this.map) return;
        this.map.on("render", cb);
    }

    // ── Utilities ────────────────────────────────────────────────────────────

    getCanvas(): HTMLCanvasElement | null {
        return this.map?.getCanvas() ?? null;
    }

    getZoom(): number {
        return this.map?.getZoom() ?? 0;
    }

    // ── Data layers ──────────────────────────────────────────────────────────

    /** Adds a static set of points as a MapLibre circle layer. */
    addPoints(
        id:     string,
        points: { lon: number; lat: number }[],
        options: {
            color?:   string;
            radius?:  number;
            opacity?: number;
            minZoom?: number;
        } = {}
    ): void {
        if (!this.map) return;
        const { color = "#e63946", radius = 5, opacity = 0.7, minZoom = 0 } = options;

        if (this.map.getLayer(id))  this.map.removeLayer(id);
        if (this.map.getSource(id)) this.map.removeSource(id);

        this.map.addSource(id, {
            type: "geojson",
            data: {
                type: "FeatureCollection",
                features: points.map(p => ({
                    type: "Feature",
                    geometry: { type: "Point", coordinates: [p.lon, p.lat] },
                    properties: {},
                })),
            },
        } as maplibregl.GeoJSONSourceSpecification);

        this.map.addLayer({
            id,
            type: "circle",
            source: id,
            minzoom: minZoom,
            paint: {
                "circle-color":   color,
                "circle-radius":  radius,
                "circle-opacity": opacity,
            },
        });
    }

    /** Removes a point layer and its source. */
    removePoints(id: string): void {
        if (!this.map) return;
        if (this.map.getLayer(id))  this.map.removeLayer(id);
        if (this.map.getSource(id)) this.map.removeSource(id);
    }

    /** Creates an empty, updatable circle layer. */
    addGroup(
        id:     string,
        options: {
            color?:   string;
            radius?:  number;
            opacity?: number;
            minZoom?: number;
        } = {}
    ): void {
        if (!this.map) return;
        const { color = "#e63946", radius = 5, opacity = 0.7, minZoom = 0 } = options;

        this.map.addSource(id, {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
        });

        this.map.addLayer({
            id,
            type: "circle",
            source: id,
            minzoom: minZoom,
            paint: {
                "circle-color":   color,
                "circle-radius":  radius,
                "circle-opacity": opacity,
            },
        });
    }

    /** Replaces the point data in a group. */
    setGroupPoints(id: string, points: { lon: number; lat: number }[]): void {
        if (!this.map) return;
        const source = this.map.getSource(id) as maplibregl.GeoJSONSource | undefined;
        if (!source) return;

        source.setData({
            type: "FeatureCollection",
            features: points.map(p => ({
                type: "Feature",
                geometry: { type: "Point", coordinates: [p.lon, p.lat] },
                properties: {},
            })),
        });
    }
}
