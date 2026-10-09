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
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const userMarkerRef = useRef<ImageMarker | google.maps.Marker | null>(null);
  const extrasRef = useRef<Array<ImageMarker | google.maps.Marker>>([]);
  // id'd markers reconciled in place so rapid live updates don't reload GIFs.
  const keyedRef = useRef<Map<string, ImageMarker | google.maps.Marker>>(new Map());
  const linesRef = useRef<google.maps.Polyline[]>([]);
  const coverageRef = useRef<google.maps.StreetViewCoverageLayer | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onDragRef = useRef(onDrag);
  onDragRef.current = onDrag;
  const [ready, setReady] = useState(false);

  // Committing the user's pin — a map click or a marker drag release — as
  // opposed to onDrag, which streams continuously while still mid-drag.
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
        // Color of the map div behind the tiles — visible in the void past the
        // edges of the world when zoomed out. Match the water tone so it blends.
        backgroundColor: "#3a4530",
        streetViewControl: false,
        mapTypeControl: false,
        fullscreenControl: false,
        clickableIcons: false,
        gestureHandling: "greedy",
        styles: [],
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

  // --- blue Street View coverage overlay (like Pegman on Google Maps) ---
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

  // --- snap back to the world view when the caller bumps resetViewKey ---
  // Only active when the prop is provided (e.g. the per-round guess map), so
  // maps that manage their own framing (fitToContent results map) are untouched.
  useEffect(() => {
    if (!ready || !mapRef.current || resetViewKey === undefined) return;
    mapRef.current.setCenter(DEFAULT_CENTER);
    mapRef.current.setZoom(DEFAULT_ZOOM);
  }, [ready, resetViewKey]);

  // --- sync the user's draggable pin (their emoji when markerIcon is set) ---
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
    // Tear down if the kind (emoji overlay vs classic pin) no longer matches.
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

  // --- sync static markers + lines (results) and live id'd markers ---
  useEffect(() => {
    if (!ready || !mapRef.current || typeof google === "undefined") return;
    const map = mapRef.current;

    // Build a fresh marker (not yet attached) from a spec.
    const build = (m: MapMarker): ImageMarker | google.maps.Marker => {
      if (m.icon) {
        // Emoji marker: <img> overlay (animates GIFs, constant footprint).
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

    // Plain (un-id'd) markers — results screen — rebuilt wholesale each change.
    extrasRef.current.forEach((m) => m.setMap(null));
    extrasRef.current = [];
    all
      .filter((m) => m.id == null)
      .forEach((m) => {
        const marker = build(m);
        marker.setMap(map);
        extrasRef.current.push(marker);
      });

    // Id'd markers (live pins) — reconciled in place so frequent updates don't
    // tear down and reload the emoji <img> (which would restart/flicker GIFs).
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
