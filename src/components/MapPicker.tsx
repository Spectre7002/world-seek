"use client";

import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps } from "@/lib/mapsLoader";
import { EARTHY_MAP_STYLE } from "@/lib/mapStyle";
import { createImageMarker, type ImageMarker } from "@/lib/ImageMarkerOverlay";
import { playSfx } from "@/lib/sfx";
import { useLanguage } from "@/lib/language";
import { computeScore, formatDistance, haversineKm } from "@/shared/scoring";
import { spellScoreRange, type SpellId } from "@/shared/spells";
import type { LatLng, RegionBounds, Settings } from "@/shared/types";
import SpellIcon from "./SpellIcon";

// The world-overview the guess map opens on (and returns to each new round).
const DEFAULT_CENTER = { lat: 20, lng: 0 };
const DEFAULT_ZOOM = 2;
// SCRY's radius is 90px on screen at the cast zoom, then fixed in meters.
const SCRY_RADIUS_PX = 90;
// ARROW: glowing dot at the click point + a long arrow pointing at the bearing.
// A small hub circle at the origin, then a long shaft and a wide head.
const ARROW_PATH =
  "M 0 -2.5 A 2.5 2.5 0 1 0 0 2.5 A 2.5 2.5 0 1 0 0 -2.5 Z " +
  "M -2.5 -1.5 L -2.5 -30 L -7 -30 L 0 -52 L 7 -30 L 2.5 -30 L 2.5 -1.5 Z";
// ARROW palette: a deeper violet so the spell reads darker on the map.
const ARROW_FILL = "#7e22ce";
const ARROW_STROKE = "#c4b5fd";
const ARROW_GLOW = "#7e22ce";

function bearingDegrees(from: LatLng, to: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);
  const dLng = toRad(to.lng - from.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

interface SpellBadge {
  id: number;
  kind: "scry" | "omen" | "echo" | "compass" | "heatmap";
  lat: number;
  lng: number;
  x: number;
  y: number;
  text?: string;
  hit?: boolean;
}

/** HEATMAP: a 3x3 grid of cells, each scored by how close the target is. */
const HEATMAP_CELLS = 3;
const HEATMAP_SPAN_DEG = 60;
const HEATMAP_COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e"];

export interface MapMarker extends LatLng {
  id?: string; // stable identity -> reconciled in place (no flicker) on rapid updates
  icon?: string; // emoji id -> rendered as an <img> overlay (animates GIFs)
  size?: number; // px footprint for an emoji icon
  color?: string; // hex for a colored dot; omit for a default pin (ignored if icon set)
  opacity?: number; // 0..1 (e.g. a tentative, un-confirmed live pin)
  label?: string; // short text shown on the marker
  title?: string; // hover tooltip
}

export interface MapLine {
  from: LatLng;
  to: LatLng;
  color?: string;
}

interface Props {
  value?: LatLng | null;
  /** Reports the clicked point and the map's current zoom (for adaptive snapping). */
  onChange?: (p: LatLng, zoom: number) => void;
  /** Streamed continuously while the user drags their own pin (for live preview). */
  onDrag?: (p: LatLng, zoom: number) => void;
  /** Emoji id for the user's own draggable pin (shows their avatar instead of a red pin). */
  markerIcon?: string;
  markers?: MapMarker[];
  lines?: MapLine[];
  fitToContent?: boolean;
  /** Overlay the blue Street View coverage layer (zoom in to see the streets). */
  coverage?: boolean;
  /**
   * When this value changes, snap the map back to the default world view. Lets a
   * persisted map (one reused across rounds, rather than remounted) start each
   * round fresh instead of holding the previous round's pan/zoom.
   */
  resetViewKey?: string | number;
  className?: string;
  restriction?: RegionBounds | null;
  /** Объект подсказки, полученный с сервера после прокрутки кейса */
  caseHint?: any;
  /** Currently selected spell: the next map click casts it instead of placing a pin. */
  spell?: SpellId | null;
  /** Correct answer, used by all four spell mechanics. */
  spellTarget?: LatLng | null;
  /** Scoring settings for OMEN's points estimate. */
  scoreSettings?: Pick<Settings, "maxPoints" | "scoreScaleKm">;
  onSpellUsed?: (spell: SpellId) => void;
}

// Кэш для файлов геоданных
let cachedCountriesGeoJson: any = null;
let cachedContinentsGeoJson: any = null;

/**
 * Lookup tables over a cached FeatureCollection.
 *
 * The case hint used to `.filter()` every feature on each hint change, which is
 * a linear scan of ~250 country polygons per render. Building the index once
 * per cached file turns the common case (an exact ISO code or name) into a map
 * hit. `features` is kept so the fuzzy `name.includes(query)` fallback and the
 * point-in-polygon fallback still work without a second pass over the file.
 */
interface GeoIndex {
  features: any[];
  byKey: Map<string, any[]>;
}

function buildGeoIndex(geoJson: any, keysOf: (feature: any) => string[]): GeoIndex {
  const byKey = new Map<string, any[]>();
  const features: any[] = Array.isArray(geoJson?.features) ? geoJson.features : [];
  for (let i = 0; i < features.length; i++) {
    const feature = features[i];
    const keys = keysOf(feature);
    for (let k = 0; k < keys.length; k++) {
      const key = keys[k];
      if (!key) continue;
      const bucket = byKey.get(key);
      if (bucket) bucket.push(feature);
      else byKey.set(key, [feature]);
    }
  }
  return { features: features, byKey: byKey };
}

function countryKeys(feature: any): string[] {
  const props = feature?.properties || {};
  return [
    props.ISO_A3,
    props.ADM0_A3,
    props.iso_a3,
    props.id,
    props.ISO_A2,
    props.iso_a2,
    props.code,
    props.NAME,
    props.NAME_LONG,
    props.ADMIN,
    props.name,
  ]
    .filter((value) => typeof value === "string" && value.length > 0)
    .map((value: string) => value.toUpperCase());
}

function continentKeys(feature: any): string[] {
  const props = feature?.properties || {};
  return [props.CONTINENT, props.continent, props.NAME, props.name, props.id]
    .filter((value) => typeof value === "string" && value.length > 0)
    .map((value: string) => value.toUpperCase());
}

let cachedCountriesIndex: GeoIndex | null = null;
let cachedContinentsIndex: GeoIndex | null = null;

async function fetchCountriesGeoJson(): Promise<any> {
  if (cachedCountriesGeoJson) return cachedCountriesGeoJson;
  const paths = [
    "/data/countries.json",
    "/countries.json",
    "/data/ne_110m_admin_0_countries.json",
    "/ne_110m_admin_0_countries.json",
  ];
  for (const path of paths) {
    try {
      const res = await fetch(path);
      if (res.ok) {
        cachedCountriesGeoJson = await res.json();
        return cachedCountriesGeoJson;
      }
    } catch {
      // Игнорируем и пробуем следующий путь
    }
  }
  return null;
}

async function fetchContinentsGeoJson(): Promise<any> {
  if (cachedContinentsGeoJson) return cachedContinentsGeoJson;
  const paths = [
    "/data/continents.json",
    "/continents.json",
  ];
  for (const path of paths) {
    try {
      const res = await fetch(path);
      if (res.ok) {
        cachedContinentsGeoJson = await res.json();
        return cachedContinentsGeoJson;
      }
    } catch {
      // Игнорируем и пробуем следующий путь
    }
  }
  return null;
}

function countriesIndex(geoJson: any): GeoIndex {
  if (!cachedCountriesIndex) cachedCountriesIndex = buildGeoIndex(geoJson, countryKeys);
  return cachedCountriesIndex;
}

function continentsIndex(geoJson: any): GeoIndex {
  if (!cachedContinentsIndex) cachedContinentsIndex = buildGeoIndex(geoJson, continentKeys);
  return cachedContinentsIndex;
}

/**
 * Features matching a case-hint query. Exact code/name hits come from the
 * index; only when that misses do we fall back to the old substring scan, so
 * the common path never touches the full feature list.
 */
function matchFeatures(index: GeoIndex, query: string | null): any[] {
  if (!query) return [];
  const needle = query.trim().toUpperCase();
  if (!needle) return [];
  const exact = index.byKey.get(needle);
  if (exact && exact.length > 0) return exact;
  return index.features.filter((feature) => {
    const keys = countryKeys(feature).concat(continentKeys(feature));
    return keys.some((key) => key.includes(needle));
  });
}

function pointInRing(pt: [number, number], ring: number[][]): boolean {
  const x = pt[0], y = pt[1];
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function featureContainsCoords(feature: any, lat: number, lng: number): boolean {
  if (!feature || !feature.geometry) return false;
  const geom = feature.geometry;
  const pt: [number, number] = [lng, lat];

  if (geom.type === "Polygon") {
    if (!geom.coordinates || !geom.coordinates[0]) return false;
    return pointInRing(pt, geom.coordinates[0]);
  } else if (geom.type === "MultiPolygon") {
    if (!geom.coordinates) return false;
    return geom.coordinates.some((poly: any) => poly && poly[0] && pointInRing(pt, poly[0]));
  }
  return false;
}

export default function MapPicker({
  value,
  onChange,
  onDrag,
  markerIcon,
  markers,
  lines,
  fitToContent,
  coverage,
  resetViewKey,
  className,
  restriction,
  caseHint,
  spell,
  spellTarget,
  scoreSettings,
  onSpellUsed,
}: Props) {
  const { t } = useLanguage();
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const userMarkerRef = useRef<ImageMarker | google.maps.Marker | null>(null);
  const extrasRef = useRef<Array<ImageMarker | google.maps.Marker>>([]);
  // id'd markers reconciled in place so rapid live updates don't reload GIFs.
  const keyedRef = useRef<Map<string, ImageMarker | google.maps.Marker>>(new Map());
  const linesRef = useRef<google.maps.Polyline[]>([]);
  const coverageRef = useRef<google.maps.StreetViewCoverageLayer | null>(null);
  const caseShapesRef = useRef<Array<google.maps.Circle | google.maps.Marker | google.maps.Rectangle | google.maps.Polyline>>([]);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onDragRef = useRef(onDrag);
  onDragRef.current = onDrag;
  const spellRef = useRef(spell);
  spellRef.current = spell;
  const spellTargetRef = useRef(spellTarget);
  spellTargetRef.current = spellTarget;
  const scoreSettingsRef = useRef(scoreSettings);
  scoreSettingsRef.current = scoreSettings;
  const onSpellUsedRef = useRef(onSpellUsed);
  onSpellUsedRef.current = onSpellUsed;
  const tRef = useRef(t);
  tRef.current = t;
  const overlayRef = useRef<google.maps.OverlayView | null>(null);
  // Draw hook: Google calls it on every map render, so DOM badges stay glued
  // to their coordinates even mid-zoom.
  const drawRef = useRef<(() => void) | null>(null);
  const cursorPreviewRef = useRef<HTMLDivElement>(null);
  const anchorLayerRef = useRef<HTMLDivElement>(null);
  const spellShapesRef = useRef<
    Array<google.maps.Marker | google.maps.Circle | google.maps.Rectangle>
  >([]);
  // Bumped on every reset; running arrow animations stop when it changes.
  const spellGenerationRef = useRef(0);
  const [badges, setBadges] = useState<SpellBadge[]>([]);
  const badgeIdRef = useRef(0);
  const [spellMessage, setSpellMessage] = useState<{
    text: string;
    tone: "good" | "bad" | "info";
  } | null>(null);
  const [ready, setReady] = useState(false);

  function commitPin(p: LatLng, zoom: number) {
    playSfx("/click-2.mp3");
    onChangeRef.current?.(p, zoom);
  }

  // Keyboard operation: arrow keys pan, Enter drops a pin at the map center (or
  // casts the armed spell). The map container is focusable so this is reachable
  // without a mouse, matching the pointer path exactly.
  function handleMapKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const map = mapRef.current;
    if (!map) return;
    const step = 80;
    switch (event.key) {
      case "ArrowLeft":
        event.preventDefault();
        map.panBy(-step, 0);
        return;
      case "ArrowRight":
        event.preventDefault();
        map.panBy(step, 0);
        return;
      case "ArrowUp":
        event.preventDefault();
        map.panBy(0, -step);
        return;
      case "ArrowDown":
        event.preventDefault();
        map.panBy(0, step);
        return;
      case "Enter": {
        event.preventDefault();
        const center = map.getCenter();
        if (!center) return;
        const point = { lat: center.lat(), lng: center.lng() };
        const active = spellRef.current;
        if (active && spellTargetRef.current) {
          if (castSpell(active, point)) onSpellUsedRef.current?.(active);
          return;
        }
        if (onChangeRef.current) commitPin(point, map.getZoom() ?? 2);
        return;
      }
      default:
        return;
    }
  }

  function addBadge(badge: Omit<SpellBadge, "id">) {
    setBadges((current) => [...current, { ...badge, id: ++badgeIdRef.current }]);
  }

  function clearSpellShapes(resetState = true) {
    spellGenerationRef.current += 1;
    spellShapesRef.current.forEach((shape) => shape.setMap(null));
    spellShapesRef.current = [];
    if (resetState) {
      setBadges([]);
      setSpellMessage(null);
    }
  }

  function scryRadiusMeters(center: google.maps.LatLng): number | null {
    const projection = overlayRef.current?.getProjection();
    if (!projection) return null;
    const point = projection.fromLatLngToContainerPixel(center);
    if (!point) return null;
    const edge = projection.fromContainerPixelToLatLng(
      new google.maps.Point(point.x + SCRY_RADIUS_PX, point.y),
    );
    if (!edge) return null;
    return (
      haversineKm(
        { lat: center.lat(), lng: center.lng() },
        { lat: edge.lat(), lng: edge.lng() },
      ) * 1000
    );
  }

  /** Casts one spell at a map point. Returns false when it cannot be drawn. */
  function castSpell(active: SpellId, p: LatLng): boolean {
    const map = mapRef.current;
    const target = spellTargetRef.current;
    if (!map || !target || typeof google === "undefined") return false;

    if (active === "scry") {
      const center = new google.maps.LatLng(p.lat, p.lng);
      const projection = overlayRef.current?.getProjection();
      const point = projection?.fromLatLngToContainerPixel(center);
      const radiusMeters = scryRadiusMeters(center);
      if (!point || radiusMeters === null) return false;
      const hit = haversineKm(p, target) * 1000 <= radiusMeters;
      // Geographic circle: fixed ground radius, so it scales with zoom and
      // stays anchored to the cast point.
      const circle = new google.maps.Circle({
        map,
        center,
        radius: radiusMeters,
        fillColor: hit ? "#22c55e" : "#ef4444",
        fillOpacity: 0.16,
        strokeColor: hit ? "#22c55e" : "#ef4444",
        strokeOpacity: 0.95,
        strokeWeight: 2,
        clickable: false,
      });
      spellShapesRef.current.push(circle);
      addBadge({ kind: "scry", lat: p.lat, lng: p.lng, x: point.x, y: point.y, hit });
      setSpellMessage({
        text: hit
          ? tRef.current("Target inside the circle")
          : tRef.current("Target outside the circle"),
        tone: hit ? "good" : "bad",
      });
      return true;
    }

    if (active === "compass") {
      // Bearing only: a text readout, no arrow drawn on the map. The point of
      // the spell is that it costs less than ARROW but gives no direction line.
      const bearing = bearingDegrees(p, target);
      const point = overlayRef.current
        ?.getProjection()
        ?.fromLatLngToContainerPixel(new google.maps.LatLng(p.lat, p.lng));
      if (!point) return false;
      addBadge({
        kind: "compass",
        lat: p.lat,
        lng: p.lng,
        x: point.x,
        y: point.y,
        text: `${Math.round(bearing)}°`,
      });
      setSpellMessage({
        text: `${tRef.current("Azimuth")}: ${Math.round(bearing)}°`,
        tone: "info",
      });
      return true;
    }

    if (active === "heatmap") {
      // A 3x3 grid centred on the click. Each cell is tinted by how close the
      // target is to that cell's centre, so the player learns a direction
      // without being handed a distance.
      const span = HEATMAP_SPAN_DEG;
      const step = span / HEATMAP_CELLS;
      const originLat = p.lat - span / 2;
      const originLng = p.lng - span / 2;
      let best = { row: 0, col: 0, distance: Infinity };
      for (let row = 0; row < HEATMAP_CELLS; row++) {
        for (let col = 0; col < HEATMAP_CELLS; col++) {
          const cellLat = originLat + step * (row + 0.5);
          const cellLng = originLng + step * (col + 0.5);
          const distance = haversineKm({ lat: cellLat, lng: cellLng }, target);
          if (distance < best.distance) best = { row, col, distance };
          const bounds = {
            north: originLat + step * (row + 1),
            south: originLat + step * row,
            east: originLng + step * (col + 1),
            west: originLng + step * col,
          };
          // Warmer = closer. The scale is relative to the grid span so it works
          // at any latitude without a magic distance threshold.
          const ratio = Math.min(1, distance / (span * 111));
          const colorIndex = Math.min(
            HEATMAP_COLORS.length - 1,
            Math.floor(ratio * HEATMAP_COLORS.length),
          );
          const rect = new google.maps.Rectangle({
            map,
            bounds,
            fillColor: HEATMAP_COLORS[colorIndex],
            fillOpacity: 0.22,
            strokeColor: "#0f172a",
            strokeOpacity: 0.35,
            strokeWeight: 1,
            clickable: false,
          });
          spellShapesRef.current.push(rect);
        }
      }
      const point = overlayRef.current
        ?.getProjection()
        ?.fromLatLngToContainerPixel(new google.maps.LatLng(p.lat, p.lng));
      if (point) {
        addBadge({
          kind: "heatmap",
          lat: p.lat,
          lng: p.lng,
          x: point.x,
          y: point.y,
          text: tRef.current("Warmest cell"),
        });
      }
      setSpellMessage({
        text: tRef.current("Warmest cell highlighted"),
        tone: "info",
      });
      return true;
    }

    if (active === "arrow") {
      const bearing = bearingDegrees(p, target);
      const glow = new google.maps.Marker({
        map,
        position: p,
        zIndex: 899,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 9,
          fillColor: ARROW_GLOW,
          fillOpacity: 0.24,
          strokeOpacity: 0,
        },
      });
      const marker = new google.maps.Marker({
        map,
        position: p,
        zIndex: 900,
        icon: {
          path: ARROW_PATH,
          scale: 1,
          anchor: new google.maps.Point(0, 0),
          fillColor: ARROW_FILL,
          fillOpacity: 1,
          strokeColor: ARROW_STROKE,
          strokeWeight: 1.2,
          rotation: 0,
        },
      });
      spellShapesRef.current.push(glow, marker);
      const started = performance.now();
      const duration = 2400;
      const spin = 720 + bearing;
      const generation = spellGenerationRef.current;
      const step = (now: number) => {
        if (generation !== spellGenerationRef.current) return;
        const k = Math.min(1, (now - started) / duration);
        const eased = 1 - Math.pow(1 - k, 3);
        marker.setIcon({
          path: ARROW_PATH,
          scale: 1,
          anchor: new google.maps.Point(0, 0),
          fillColor: ARROW_FILL,
          fillOpacity: 1,
          strokeColor: ARROW_STROKE,
          strokeWeight: 1.2,
          rotation: spin * eased,
        });
        if (k < 1) {
          requestAnimationFrame(step);
        } else {
          marker.setIcon({
            path: ARROW_PATH,
            scale: 1,
            anchor: new google.maps.Point(0, 0),
            fillColor: ARROW_FILL,
            fillOpacity: 1,
            strokeColor: ARROW_STROKE,
            strokeWeight: 1.2,
            rotation: bearing,
          });
        }
      };
      requestAnimationFrame(step);
      setSpellMessage({
        text: `${tRef.current("Azimuth")}: ${Math.round(bearing)}°`,
        tone: "info",
      });
      return true;
    }

    const distanceKm = haversineKm(p, target);

    if (active === "echo") {
      const circle = new google.maps.Circle({
        map,
        center: p,
        radius: distanceKm * 1000,
        fillOpacity: 0,
        strokeColor: "#7c3aed",
        strokeOpacity: 1,
        strokeWeight: 2.5,
        clickable: false,
      });
      const marker = new google.maps.Marker({
        map,
        position: p,
        zIndex: 900,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 6,
          fillColor: "#7c3aed",
          fillOpacity: 1,
          strokeColor: "#e9d5ff",
          strokeWeight: 2,
        },
      });
      spellShapesRef.current.push(circle, marker);
      const point = overlayRef.current
        ?.getProjection()
        ?.fromLatLngToContainerPixel(new google.maps.LatLng(p.lat, p.lng));
      if (point) {
        addBadge({
          kind: "echo",
          lat: p.lat,
          lng: p.lng,
          x: point.x,
          y: point.y,
          text: formatDistance(distanceKm),
        });
      }
      setSpellMessage({
        text: `${tRef.current("Distance")}: ${formatDistance(distanceKm)}`,
        tone: "info",
      });
      return true;
    }

    // OMEN: only a 1000-point bucket, never the exact score.
    const settings = scoreSettingsRef.current ?? { maxPoints: 5000, scoreScaleKm: 2000 };
    const range = spellScoreRange(computeScore(distanceKm, settings as Settings));
    const projection = overlayRef.current?.getProjection();
    const point = projection?.fromLatLngToContainerPixel(
      new google.maps.LatLng(p.lat, p.lng),
    );
    if (!point) return false;
    addBadge({ kind: "omen", lat: p.lat, lng: p.lng, x: point.x, y: point.y, text: range });
    setSpellMessage({
      text: `${tRef.current("Potential score")}: ${range}`,
      tone: "info",
    });
    return true;
  }

  // --- init map once ---
  useEffect(() => {
    let cancelled = false;
    let created: google.maps.Map | null = null;
    loadGoogleMaps().then((google) => {
      if (cancelled || !ref.current || mapRef.current) return;
      const map = new google.maps.Map(ref.current, {
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        minZoom: 2,
        backgroundColor: "#f5f5f5",
        streetViewControl: false,
        mapTypeControl: false,
        fullscreenControl: false,
        clickableIcons: false,
        gestureHandling: "greedy",
        styles: EARTHY_MAP_STYLE,
      });
      mapRef.current = map;
      created = map;
      map.addListener("click", (e: google.maps.MapMouseEvent) => {
        if (!e.latLng) return;
        const point = { lat: e.latLng.lat(), lng: e.latLng.lng() };
        const active = spellRef.current;
        if (active && spellTargetRef.current) {
          if (castSpell(active, point)) onSpellUsedRef.current?.(active);
          return;
        }
        if (onChangeRef.current) {
          commitPin(point, map.getZoom() ?? 2);
        }
      });
      // While a spell is armed, its icon rides the cursor (SCRY also shows its
      // future circle). Direct DOM writes keep mousemove off React's render path.
      map.addListener("mousemove", (e: google.maps.MapMouseEvent) => {
        const el = cursorPreviewRef.current;
        const container = ref.current;
        if (!el || !container || !spellRef.current || !spellTargetRef.current) return;
        const dom = e.domEvent as MouseEvent;
        const rect = container.getBoundingClientRect();
        el.style.left = `${dom.clientX - rect.left}px`;
        el.style.top = `${dom.clientY - rect.top}px`;
        el.style.display = "block";
      });
      map.addListener("mouseout", () => {
        if (cursorPreviewRef.current) cursorPreviewRef.current.style.display = "none";
      });
      setReady(true);
    });
    return () => {
      cancelled = true;
      // Tear the map down so StrictMode's remount builds a fresh one instead of
      // stacking a second renderer on the same container. `ready` is reset so
      // the dependent effects (markers, case shapes, overlay) re-run against the
      // new instance.
      if (created) {
        google.maps.event.clearInstanceListeners(created);
        mapRef.current = null;
        setReady(false);
      }
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current) return;
    mapRef.current.setOptions({
      restriction: restriction
        ? { latLngBounds: restriction, strictBounds: true }
        : undefined,
    });
  }, [restriction, ready]);

  // Projection helper: Google calls draw() on every render, keeping DOM badges glued.
  useEffect(() => {
    if (!ready || !mapRef.current || typeof google === "undefined") return;
    const overlay = new google.maps.OverlayView();
    overlay.onAdd = function () {};
    overlay.draw = function () {
      drawRef.current?.();
    };
    overlay.setMap(mapRef.current);
    overlayRef.current = overlay;
    return () => {
      overlay.setMap(null);
      overlayRef.current = null;
    };
  }, [ready]);

  // SCRY, OMEN and ECHO badges are DOM nodes; position them from the map's own
  // render pass so they never drift during a zoom animation.
  useEffect(() => {
    drawRef.current = () => {
      if (!overlayRef.current || typeof google === "undefined") return;
      const projection = overlayRef.current.getProjection();
      if (!projection) return;
      anchorLayerRef.current
        ?.querySelectorAll<HTMLElement>("[data-lat][data-lng]")
        .forEach((node) => {
          const point = projection.fromLatLngToContainerPixel(
            new google.maps.LatLng(
              Number(node.dataset.lat),
              Number(node.dataset.lng),
            ),
          );
          if (point) {
            node.style.left = `${point.x}px`;
            node.style.top = `${point.y}px`;
          }
        });
    };
    drawRef.current();
  }, [ready, badges]);

  useEffect(() => {
    if (cursorPreviewRef.current) cursorPreviewRef.current.style.display = "none";
  }, [spell]);

  useEffect(() => {
    if (ready) clearSpellShapes();
  }, [ready, resetViewKey]);

  useEffect(
    () => () => {
      clearSpellShapes(false);
    },
    [],
  );

  // --- blue Street View coverage overlay ---
  useEffect(() => {
    if (!ready || !mapRef.current || typeof google === "undefined") return;
    if (coverage && !coverageRef.current) {
      coverageRef.current = new google.maps.StreetViewCoverageLayer();
      coverageRef.current.setMap(mapRef.current);
    } else if (!coverage && coverageRef.current) {
      coverageRef.current.setMap(null);
      coverageRef.current = null;
    }
  }, [ready, coverage]);

  // --- snap back to default view ---
  useEffect(() => {
    if (!ready || !mapRef.current || resetViewKey === undefined) return;
    mapRef.current.setCenter(DEFAULT_CENTER);
    mapRef.current.setZoom(DEFAULT_ZOOM);
  }, [ready, resetViewKey]);

  // --- Отрисовка подсказок из кейсов и читов ---
  useEffect(() => {
    if (!ready || !mapRef.current || typeof google === "undefined") return;
    const map = mapRef.current;

    caseShapesRef.current.forEach((shape) => shape.setMap(null));
    caseShapesRef.current = [];

    map.data.forEach((feature) => {
      map.data.remove(feature);
    });

    if (caseHint) {
      const themeColor = caseHint.tierColor || "#eb4b4b";

      // 1. Если выпал круг (радиус поиска)
      if (caseHint.circle) {
        const circle = new google.maps.Circle({
          map,
          center: caseHint.circle.center,
          radius: caseHint.circle.radiusMeters,
          fillColor: themeColor,
          fillOpacity: 0.15,
          strokeColor: themeColor,
          strokeOpacity: 0.8,
          strokeWeight: 2,
          clickable: false,
        });
        caseShapesRef.current.push(circle);
      }

      // 2. Если выпала полоса (широта/долгота)
      if (caseHint.band) {
        const bounds =
          caseHint.band.axis === "lat"
            ? { north: caseHint.band.max, south: caseHint.band.min, east: 180, west: -180 }
            : { north: 90, south: -90, east: caseHint.band.max, west: caseHint.band.min };
        const rect = new google.maps.Rectangle({
          map,
          bounds,
          fillColor: themeColor,
          fillOpacity: 0.15,
          strokeColor: themeColor,
          strokeOpacity: 0.8,
          strokeWeight: 2,
          clickable: false,
        });
        caseShapesRef.current.push(rect);
      }

      // 3. Если выпала точная точка (Special / 5K)
      if (caseHint.exact) {
        const exactMarker = new google.maps.Marker({
          map,
          position: caseHint.exact,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 8,
            fillColor: themeColor,
            fillOpacity: 1,
            strokeColor: "#000",
            strokeWeight: 2,
          },
          title: "Точная цель (5K)",
          zIndex: 500,
        });
        caseShapesRef.current.push(exactMarker);
      }

      // 4. Если в caseHint передан готовый GeoJSON полигон
      if (caseHint.geoJson) {
        const addedFeatures = map.data.addGeoJson(caseHint.geoJson);
        map.data.setStyle({
          fillColor: themeColor,
          fillOpacity: 0.25,
          strokeColor: themeColor,
          strokeOpacity: 0.8,
          strokeWeight: 2,
          clickable: false,
        });
        const bounds = new google.maps.LatLngBounds();
        addedFeatures.forEach((feat) => {
          feat.getGeometry()?.forEachLatLng((latLng) => {
            bounds.extend(latLng);
          });
        });
        if (!bounds.isEmpty()) {
          map.fitBounds(bounds, 50);
        }
      }

      // 5. Подсветка страны из /data/countries.json по ISO коду, названию или координатам (Point-in-Polygon)
      const countryQuery =
        typeof caseHint.country === "string"
          ? caseHint.country
          : caseHint.country?.code ||
            caseHint.country?.iso ||
            caseHint.country?.name ||
            caseHint.iso ||
            caseHint.countryCode;

      const isCountryOutline = caseHint.outline === "outline_country" || !!countryQuery;

      if (isCountryOutline && !caseHint.geoJson) {
        fetchCountriesGeoJson().then((geoJson) => {
          if (!geoJson || !mapRef.current) return;
          const index = countriesIndex(geoJson);

          // Indexed lookup first; the substring scan only runs on a miss.
          let matchingFeatures: any[] = matchFeatures(index, countryQuery ?? null);

          if (matchingFeatures.length === 0 && caseHint.targetCoords) {
            const { lat, lng } = caseHint.targetCoords;
            const found = index.features.find((feature: any) =>
              featureContainsCoords(feature, lat, lng)
            );
            if (found) {
              matchingFeatures = [found];
            }
          }

          if (matchingFeatures.length > 0) {
            const featureCollection = {
              type: "FeatureCollection",
              features: matchingFeatures,
            };

            const addedFeatures = mapRef.current.data.addGeoJson(featureCollection);

            mapRef.current.data.setStyle({
              fillColor: themeColor,
              fillOpacity: 0.25,
              strokeColor: themeColor,
              strokeOpacity: 0.8,
              strokeWeight: 2,
              clickable: false,
            });

            const bounds = new google.maps.LatLngBounds();
            addedFeatures.forEach((feat) => {
              feat.getGeometry()?.forEachLatLng((latLng) => {
                bounds.extend(latLng);
              });
            });

            if (!bounds.isEmpty()) {
              mapRef.current.fitBounds(bounds, 50);
            }
          }
        });
      }

      // 6. Подсветка континента из /data/continents.json по коду, названию или координатам (Point-in-Polygon)
      const continentQuery =
        typeof caseHint.continent === "string"
          ? caseHint.continent
          : caseHint.continent?.code ||
            caseHint.continent?.name ||
            caseHint.continentCode;

      const isContinentOutline = caseHint.outline === "outline_continent" || !!continentQuery;

      if (isContinentOutline && !caseHint.country && !caseHint.geoJson) {
        fetchContinentsGeoJson().then((geoJson) => {
          if (!geoJson || !mapRef.current) return;
          const index = continentsIndex(geoJson);

          let matchingFeatures: any[] = matchFeatures(index, continentQuery ?? null);

          if (matchingFeatures.length === 0 && caseHint.targetCoords) {
            const { lat, lng } = caseHint.targetCoords;
            const found = index.features.find((feature: any) =>
              featureContainsCoords(feature, lat, lng)
            );
            if (found) {
              matchingFeatures = [found];
            }
          }

          if (matchingFeatures.length > 0) {
            const featureCollection = {
              type: "FeatureCollection",
              features: matchingFeatures,
            };

            const addedFeatures = mapRef.current.data.addGeoJson(featureCollection);

            mapRef.current.data.setStyle({
              fillColor: themeColor,
              fillOpacity: 0.2,
              strokeColor: themeColor,
              strokeOpacity: 0.8,
              strokeWeight: 2,
              clickable: false,
            });

            const bounds = new google.maps.LatLngBounds();
            addedFeatures.forEach((feat) => {
              feat.getGeometry()?.forEachLatLng((latLng) => {
                bounds.extend(latLng);
              });
            });

            if (!bounds.isEmpty()) {
              mapRef.current.fitBounds(bounds, 40);
            }
          }
        });
      }
    }
  }, [ready, caseHint]);

  // --- sync the user's draggable pin ---
  useEffect(() => {
    if (!ready || !mapRef.current || typeof google === "undefined") return;
    const map = mapRef.current;

    if (!value) {
      if (userMarkerRef.current) {
        userMarkerRef.current.setMap(null);
        userMarkerRef.current = null;
      }
      return;
    }

    const isEmoji = (m: ImageMarker | google.maps.Marker): m is ImageMarker =>
      "setEmoji" in m;

    if (
      userMarkerRef.current &&
      isEmoji(userMarkerRef.current) !== !!markerIcon
    ) {
      userMarkerRef.current.setMap(null);
      userMarkerRef.current = null;
    }

    if (!userMarkerRef.current) {
      if (markerIcon) {
        const m = createImageMarker({
          position: value,
          emoji: markerIcon,
          draggable: !!onChange,
          zIndex: 1000,
          onDrag: (p) => onDragRef.current?.(p, map.getZoom() ?? 2),
          onDragEnd: (p) => commitPin(p, map.getZoom() ?? 2),
        });
        m.setMap(map);
        userMarkerRef.current = m;
      } else {
        const m = new google.maps.Marker({ map, draggable: !!onChange });
        if (onChange) {
          m.addListener("dragend", (e: google.maps.MapMouseEvent) => {
            if (e.latLng) {
              commitPin({ lat: e.latLng.lat(), lng: e.latLng.lng() }, map.getZoom() ?? 2);
            }
          });
        }
        userMarkerRef.current = m;
      }
    }

    userMarkerRef.current.setPosition(value);
    if (markerIcon && isEmoji(userMarkerRef.current)) {
      userMarkerRef.current.setEmoji(markerIcon);
    }
  }, [ready, value, onChange, markerIcon]);

  // --- sync static markers + lines and live id'd markers ---
  useEffect(() => {
    if (!ready || !mapRef.current || typeof google === "undefined") return;
    const map = mapRef.current;

    const build = (m: MapMarker): ImageMarker | google.maps.Marker => {
      if (m.icon) {
        return createImageMarker({
          position: { lat: m.lat, lng: m.lng },
          emoji: m.icon,
          size: m.size,
          opacity: m.opacity,
        });
      }
      return new google.maps.Marker({
        position: { lat: m.lat, lng: m.lng },
        title: m.title,
        opacity: m.opacity,
        label: m.label
          ? { text: m.label, color: "#2b1a12", fontWeight: "700", fontSize: "11px" }
          : undefined,
        icon: m.color
          ? {
              path: google.maps.SymbolPath.CIRCLE,
              scale: 9,
              fillColor: m.color,
              fillOpacity: m.opacity ?? 1,
              strokeColor: "#2b1a12",
              strokeWeight: 2,
            }
          : undefined,
      });
    };

    const all = markers ?? [];

    extrasRef.current.forEach((m) => m.setMap(null));
    extrasRef.current = [];
    all
      .filter((m) => m.id == null)
      .forEach((m) => {
        const marker = build(m);
        marker.setMap(map);
        extrasRef.current.push(marker);
      });

    const seen = new Set<string>();
    all
      .filter((m): m is MapMarker & { id: string } => m.id != null)
      .forEach((m) => {
        seen.add(m.id);
        const existing = keyedRef.current.get(m.id);
        const wantEmoji = !!m.icon;
        if (existing && "setEmoji" in existing === wantEmoji) {
          existing.setPosition({ lat: m.lat, lng: m.lng });
          if ("setEmoji" in existing) {
            existing.setEmoji(m.icon!);
            existing.setOpacity(m.opacity ?? 1);
          } else {
            existing.setOpacity(m.opacity ?? 1);
          }
        } else {
          existing?.setMap(null);
          const marker = build(m);
          marker.setMap(map);
          keyedRef.current.set(m.id, marker);
        }
      });
    keyedRef.current.forEach((marker, id) => {
      if (!seen.has(id)) {
        marker.setMap(null);
        keyedRef.current.delete(id);
      }
    });

    linesRef.current.forEach((l) => l.setMap(null));
    linesRef.current = [];
    (lines ?? []).forEach((ln) => {
      const poly = new google.maps.Polyline({
        map,
        path: [ln.from, ln.to],
        geodesic: true,
        strokeColor: ln.color ?? "#ffffff",
        strokeOpacity: 0.7,
        strokeWeight: 2,
      });
      linesRef.current.push(poly);
    });

    if (fitToContent) {
      const pts = [
        ...(markers ?? []),
        ...(lines ?? []).flatMap((l) => [l.from, l.to]),
      ];
      if (pts.length === 1) {
        map.setCenter(pts[0]);
        map.setZoom(6);
      } else if (pts.length > 1) {
        const bounds = new google.maps.LatLngBounds();
        pts.forEach((p) => bounds.extend(p));
        map.fitBounds(bounds, 80);
      }
    }
  }, [ready, markers, lines, fitToContent]);

  return (
    <div
      className={`map-picker${className ? " " + className : ""}`}
      style={{ position: "relative", width: "100%", height: "100%" }}
      tabIndex={0}
      role="application"
      aria-label="Map"
      onKeyDown={handleMapKeyDown}
    >
      <div
        ref={ref}
        style={{ width: "100%", height: "100%" }}
        onClickCapture={function (event) {
          const target = event.target;
          if (target instanceof HTMLElement && target.closest("a")) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
      />
      {spell && spellTarget && (
        <div ref={cursorPreviewRef} className={`spell-cursor is-${spell}`}>
          {spell === "scry" && (
            <span className="spell-cursor-scry" aria-hidden="true" />
          )}
          <span className="spell-cursor-icon">
            <SpellIcon id={spell} />
          </span>
        </div>
      )}
      <div ref={anchorLayerRef} className="spell-anchor-layer">
        {badges.map((badge) => (
          <div
            key={badge.id}
            data-lat={badge.lat}
            data-lng={badge.lng}
            className={`spell-anchor is-${badge.kind}${
              badge.hit === true ? " is-hit" : badge.hit === false ? " is-miss" : ""
            }`}
            style={{ left: badge.x, top: badge.y }}
          >
            {badge.kind === "scry" && (
              <span className="scry-badge">
                <SpellIcon id="scry" />
              </span>
            )}
            {badge.kind === "omen" && (
              <>
                <span className="map-pill">{badge.text}</span>
                <span className="omen-badge">
                  <SpellIcon id="omen" />
                </span>
              </>
            )}
            {badge.kind === "echo" && (
              <span className="map-pill">{badge.text}</span>
            )}
            {badge.kind === "compass" && (
              <span className="map-pill compass-pill">
                <SpellIcon id="compass" />
                {badge.text}
              </span>
            )}
            {badge.kind === "heatmap" && (
              <span className="map-pill">{badge.text}</span>
            )}
          </div>
        ))}
      </div>
      {spellMessage && (
        <div className={`spell-message is-${spellMessage.tone}`}>{spellMessage.text}</div>
      )}
    </div>
  );
}