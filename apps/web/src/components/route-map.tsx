"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import type { GeoJSONSource, Map as MapLibreMap, Popup } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";

import { MAP_STYLE_URL } from "@/lib/env";
import { utcTime } from "@/lib/format";
import { ROUTE_COLORS, type SceneGeometry } from "@/lib/geometry";

import { RouteSchematic } from "./route-schematic";

const LOAD_TIMEOUT_MS = 12000;
const MAPLIBRE_WORKER_URL = "/vendor/maplibre-gl-worker.mjs";

type Feature = GeoJSON.Feature<GeoJSON.Geometry, Record<string, string | number | boolean | null>>;

function toCollections(scene: SceneGeometry) {
  const lines: Feature[] = [];
  for (const v of scene.vehicles) {
    if (v.completed.length > 1)
      lines.push({ type: "Feature", geometry: { type: "LineString", coordinates: v.completed }, properties: { role: v.role, kind: "completed" } });
    if (v.planned.length > 1)
      lines.push({ type: "Feature", geometry: { type: "LineString", coordinates: v.planned }, properties: { role: v.role, kind: "planned" } });
  }
  const stops: Feature[] = scene.stops
    .filter((s) => s.status !== "station")
    .map((s) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: s.lngLat },
      properties: {
        status: s.status,
        role: scene.vehicles.find((v) => v.routeId === (s.servedBy ?? s.routeId))?.role ?? "other",
        late: s.lateWindowed > 0 || s.afterShift,
        stop: s.stopId,
        van: scene.vehicles.find((v) => v.routeId === s.routeId)?.label ?? "",
        eta: s.etaUtc ? utcTime(s.etaUtc) : "",
        pk: s.packageCount,
        win: s.windowedCount,
      },
    }));
  const markers: Feature[] = scene.vehicles.map((v) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: v.position },
    properties: { role: v.role, label: v.label, kind: "vehicle" },
  }));
  if (scene.meeting)
    markers.push({ type: "Feature", geometry: { type: "Point", coordinates: scene.meeting.lngLat }, properties: { role: "meeting", label: scene.meeting.label, kind: "meeting" } });
  const fc = (features: Feature[]): GeoJSON.FeatureCollection => ({ type: "FeatureCollection", features });
  return { lines: fc(lines), stops: fc(stops), markers: fc(markers) };
}

const roleColor = ["match", ["get", "role"], "donor", ROUTE_COLORS.donor, "helper", ROUTE_COLORS.helper, ROUTE_COLORS.other] as unknown as string;

export function RouteMap({ scene, className = "" }: { scene: SceneGeometry; className?: string }) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const sceneRef = useRef(scene);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    sceneRef.current = scene;
  });

  useEffect(() => {
    let cancelled = false;
    let map: MapLibreMap | null = null;
    let popup: Popup | null = null;
    const timer = window.setTimeout(() => {
      if (!cancelled && !mapRef.current?.isStyleLoaded()) setFailed(true);
    }, LOAD_TIMEOUT_MS);

    import("maplibre-gl")
      .then((maplibregl) => {
        if (cancelled || !container.current) return;
        maplibregl.setWorkerUrl(MAPLIBRE_WORKER_URL);
        let created: MapLibreMap;
        try {
          created = new maplibregl.Map({
            container: container.current,
            style: MAP_STYLE_URL,
            attributionControl: { compact: false },
            cooperativeGestures: true,
            fadeDuration: 0,
          });
        } catch {
          setFailed(true);
          return;
        }
        map = created;
        mapRef.current = created;
        created.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
        created.on("error", (e) => {
          const msg = String(e.error?.message ?? "");
          if (!created.isStyleLoaded() && /style|fetch|Failed/i.test(msg)) setFailed(true);
        });
        created.on("load", () => {
          if (!map) return;
          const data = toCollections(sceneRef.current);
          map.addSource("lines", { type: "geojson", data: data.lines });
          map.addSource("stops", { type: "geojson", data: data.stops });
          map.addSource("markers", { type: "geojson", data: data.markers });
          map.addLayer({
            id: "lines-completed",
            type: "line",
            source: "lines",
            filter: ["==", ["get", "kind"], "completed"],
            paint: { "line-color": roleColor, "line-width": 1.5, "line-opacity": 0.25 },
          });
          map.addLayer({
            id: "lines-other",
            type: "line",
            source: "lines",
            filter: ["all", ["==", ["get", "kind"], "planned"], ["==", ["get", "role"], "other"]],
            paint: { "line-color": ROUTE_COLORS.other, "line-width": 1.6, "line-opacity": 0.75, "line-dasharray": [1, 1.5] },
          });
          map.addLayer({
            id: "lines-helper",
            type: "line",
            source: "lines",
            filter: ["all", ["==", ["get", "kind"], "planned"], ["==", ["get", "role"], "helper"]],
            paint: { "line-color": ROUTE_COLORS.helper, "line-width": 3, "line-dasharray": [2, 1.4] },
          });
          map.addLayer({
            id: "lines-donor",
            type: "line",
            source: "lines",
            filter: ["all", ["==", ["get", "kind"], "planned"], ["==", ["get", "role"], "donor"]],
            paint: { "line-color": ROUTE_COLORS.donor, "line-width": 3 },
          });
          map.addLayer({
            id: "stops",
            type: "circle",
            source: "stops",
            paint: {
              "circle-radius": ["case", ["==", ["get", "status"], "transferred"], 5, 3.2],
              "circle-color": ["case", ["==", ["get", "status"], "completed"], "#B8C0C8", ["==", ["get", "status"], "transferred"], ROUTE_COLORS.helper, roleColor],
              "circle-opacity": ["case", ["==", ["get", "status"], "completed"], 0.6, 1],
              "circle-stroke-width": ["case", ["get", "late"], 2, 1],
              "circle-stroke-color": ["case", ["get", "late"], "#B53C3C", "#FFFFFF"],
            },
          });
          map.addLayer({
            id: "vehicles",
            type: "circle",
            source: "markers",
            filter: ["==", ["get", "kind"], "vehicle"],
            paint: { "circle-radius": 7, "circle-color": roleColor, "circle-stroke-width": 2.5, "circle-stroke-color": "#FFFFFF" },
          });
          map.addLayer({
            id: "meeting",
            type: "circle",
            source: "markers",
            filter: ["==", ["get", "kind"], "meeting"],
            paint: { "circle-radius": 10, "circle-color": "#A76941", "circle-stroke-width": 3, "circle-stroke-color": "#131920" },
          });
          map.addLayer({
            id: "labels",
            type: "symbol",
            source: "markers",
            layout: {
              "text-field": ["get", "label"],
              "text-size": 12,
              "text-offset": [0, -1.5],
              "text-anchor": "bottom",
              "text-font": ["Noto Sans Regular"],
            },
            paint: { "text-color": "#171C22", "text-halo-color": "#FFFFFF", "text-halo-width": 1.6 },
          });
          popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10 });
          map.on("mousemove", "stops", (e) => {
            const f = e.features?.[0];
            if (!f || !map || !popup) return;
            map.getCanvas().style.cursor = "pointer";
            const p = f.properties as Record<string, string | number | boolean>;
            const status = p.status === "completed" ? "Delivered before cutoff (historical)" : p.status === "transferred" ? "Moved to helper in this plan" : "Remaining";
            popup
              .setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number])
              .setHTML(
                `<div style="font:12px/1.45 var(--font-sans);color:#171C22"><strong style="font-family:var(--font-mono)">${p.van} · ${p.stop}</strong><br/>${status}${p.eta ? `<br/>Model ETA ${p.eta}` : ""}<br/>${p.pk} package(s), ${p.win} with window${p.late ? '<br/><span style="color:#B53C3C">Projected miss</span>' : ""}</div>`,
              )
              .addTo(map);
          });
          map.on("mouseleave", "stops", () => {
            if (!map) return;
            map.getCanvas().style.cursor = "";
            popup?.remove();
          });
          const b = sceneRef.current.bounds;
          if (b) map.fitBounds(b, { padding: 48, duration: 0 });
          setReady(true);
        });
      })
      .catch(() => setFailed(true));

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      popup?.remove();
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const data = toCollections(scene);
    (map.getSource("lines") as GeoJSONSource | undefined)?.setData(data.lines);
    (map.getSource("stops") as GeoJSONSource | undefined)?.setData(data.stops);
    (map.getSource("markers") as GeoJSONSource | undefined)?.setData(data.markers);
  }, [scene, ready]);

  const fit = () => {
    const b = scene.bounds;
    if (b && mapRef.current) mapRef.current.fitBounds(b, { padding: 48, duration: 200 });
  };

  if (failed) {
    return (
      <div className={`relative overflow-hidden ${className}`}>
        <RouteSchematic scene={scene} title="Route schematic from source coordinates" />
        <p className="absolute bottom-2 left-2 right-2 rounded-[8px] bg-raised/95 px-3 py-2 text-[12px] text-ink-2 shadow-[0_0_0_1px_var(--line)]">
          Map tiles are unavailable, so this schematic is drawn directly from the anonymized source coordinates. Use the stop list for exact values.
        </p>
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden ${className}`}>
      <div ref={container} className="h-full w-full" aria-label="Route map. Stop details are available in the stop list." role="region" />
      {!ready ? (
        <div className="absolute inset-0 grid place-items-center bg-surface text-sm text-ink-2">Loading map…</div>
      ) : (
        <button
          type="button"
          onClick={fit}
          className="absolute right-12 top-3 h-9 rounded-[8px] border border-line bg-raised px-3 text-[13px] text-ink shadow-sm hover:bg-surface"
        >
          Fit routes
        </button>
      )}
    </div>
  );
}
