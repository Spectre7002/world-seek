"use client";

import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps } from "@/lib/mapsLoader";
import { EARTHY_MAP_STYLE } from "@/lib/mapStyle";
import { createImageMarker, type ImageMarker } from "@/lib/ImageMarkerOverlay";
import { playSfx } from "@/lib/sfx";
import type { LatLng, RegionBounds } from "@/shared/types";

// The world-overview the guess map opens on (and returns to each new round).
const DEFAULT_CENTER = { lat: 20, lng: 0 };
const DEFAULT_ZOOM = 2;

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
}

// Кэш для файлов геоданных
let cachedCountriesGeoJson: any = null;
let cachedContinentsGeoJson: any = null;

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
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const userMarkerRef = useRef<ImageMarker | google.maps.Marker | null>(null);
  const extrasRef = useRef<Array<ImageMarker | google.maps.Marker>>([]);
  // id'd markers reconciled in place so rapid live updates don't reload GIFs.
  const keyedRef = useRef<Map<string, ImageMarker | google.maps.Marker>>(new Map());
  const linesRef = useRef<google.maps.Polyline[]>([]);
  const coverageRef = useRef<google.maps.StreetViewCoverageLayer | null>(null);
  const caseShapesRef = useRef<Array<google.maps.Circle | google.maps.Marker | google.maps.Rectangle>>([]);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onDragRef = useRef(onDrag);
  onDragRef.current = onDrag;
  const [ready, setReady] = useState(false);

  function commitPin(p: LatLng, zoom: number) {
    playSfx("/click-2.mp3");
    onChangeRef.current?.(p, zoom);
  }

  // --- init map once ---
  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps().then((google) => {
      if (cancelled || !ref.current || mapRef.current) return;
      const map = new google.maps.Map(ref.current, {
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        minZoom: 2,
        backgroundColor: "#3a4530",
        streetViewControl: false,
        mapTypeControl: false,
        fullscreenControl: false,
        clickableIcons: false,
        gestureHandling: "greedy",
        styles: EARTHY_MAP_STYLE,
      });
      mapRef.current = map;
      if (onChangeRef.current) {
        map.addListener("click", (e: google.maps.MapMouseEvent) => {
          if (e.latLng) {
            commitPin({ lat: e.latLng.lat(), lng: e.latLng.lng() }, map.getZoom() ?? 2);
          }
        });
      }
      setReady(true);
    });
    return () => {
      cancelled = true;
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
          const targetQuery = countryQuery ? countryQuery.trim().toUpperCase() : null;

          let matchingFeatures: any[] = [];

          if (targetQuery) {
            matchingFeatures = geoJson.features?.filter((feature: any) => {
              const props = feature.properties || {};
              const isoA3 = (props.ISO_A3 || props.ADM0_A3 || props.iso_a3 || props.id || "").toUpperCase();
              const isoA2 = (props.ISO_A2 || props.iso_a2 || props.code || "").toUpperCase();
              const name = (props.NAME || props.NAME_LONG || props.ADMIN || props.name || "").toUpperCase();
              return (
                isoA3 === targetQuery ||
                isoA2 === targetQuery ||
                name === targetQuery ||
                name.includes(targetQuery)
              );
            }) || [];
          }

          if (matchingFeatures.length === 0 && caseHint.targetCoords) {
            const { lat, lng } = caseHint.targetCoords;
            const found = geoJson.features?.find((feature: any) =>
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
          const targetQuery = continentQuery ? continentQuery.trim().toUpperCase() : null;

          let matchingFeatures: any[] = [];

          if (targetQuery) {
            matchingFeatures = geoJson.features?.filter((feature: any) => {
              const props = feature.properties || {};
              const name = (props.CONTINENT || props.continent || props.NAME || props.name || props.id || "").toUpperCase();
              return name === targetQuery || name.includes(targetQuery);
            }) || [];
          }

          if (matchingFeatures.length === 0 && caseHint.targetCoords) {
            const { lat, lng } = caseHint.targetCoords;
            const found = geoJson.features?.find((feature: any) =>
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
      ref={ref}
      className={className}
      style={{ width: "100%", height: "100%" }}
      onClickCapture={function (event) {
        const target = event.target;
        if (target instanceof HTMLElement && target.closest("a")) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    />
  );
}