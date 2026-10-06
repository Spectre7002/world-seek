"use client";

import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps } from "@/lib/mapsLoader";
import type { LatLng } from "@/shared/types";

export interface ResolvedPano extends LatLng {
  panoId: string;
}

export interface StreetViewCam {
  panoId: string;
  heading: number;
  pitch: number;
  zoom: number;
}

interface Props {
  mode: "position" | "pano";
  position?: LatLng | null;
  panoId?: string | null;
  radius?: number;
  onPano?: (pano: ResolvedPano | null) => void;
  onView?: (view: StreetViewCam) => void;
  follow?: StreetViewCam | null;
  interactive?: boolean;
  className?: string;
}

function headingDelta(a: number, b: number): number {
  let d = Math.abs(a - b) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

function clickDistanceMeters(ny: number): number {
  const t = Math.max(0, Math.min(1, (0.8 - ny) / 0.58));
  return 20 + t * t * 380;
}

function fovFromZoom(zoom: number): number {
  return 180 / Math.pow(2, Math.max(0, zoom));
}

export default function StreetView(props: Props) {
  const mode = props.mode;
  const position = props.position;
  const panoId = props.panoId;
  const radius = props.radius || 120;
  const onPano = props.onPano;
  const onView = props.onView;
  const follow = props.follow;
  const interactive = props.interactive !== false;
  const className = props.className;

  const wrapRef = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  const panoRef = useRef<google.maps.StreetViewPanorama | null>(null);
  const onPanoRef = useRef(onPano);
  onPanoRef.current = onPano;
  const onViewRef = useRef(onView);
  onViewRef.current = onView;
  const applyingFollow = useRef(false);
  const [ready, setReady] = useState(false);
  const [heading, setHeading] = useState(0);

  useEffect(
    function () {
      let cancelled = false;
      let clickCleanup: (() => void) | null = null;

      loadGoogleMaps().then(function (google) {
        if (cancelled || !ref.current || panoRef.current) return;

        const pano = new google.maps.StreetViewPanorama(ref.current, {
          visible: true,
          addressControl: false,
          showRoadLabels: false,
          fullscreenControl: false,
          motionTracking: false,
          motionTrackingControl: false,
          panControl: false,
          linksControl: interactive,
          clickToGo: false,
          zoomControl: interactive,
          scrollwheel: interactive,
          disableDefaultUI: !interactive,
        });

        pano.addListener("position_changed", function () {
          if (mode === "position") {
            const id = pano.getPano();
            const pos = pano.getPosition();
            if (id && pos && onPanoRef.current) {
              onPanoRef.current({
                panoId: id,
                lat: pos.lat(),
                lng: pos.lng(),
              });
            }
          }
          emitView(pano);
        });

        pano.addListener("pov_changed", function () {
          const pov = pano.getPov();
          if (pov) setHeading(pov.heading);
          emitView(pano);
        });

        pano.addListener("zoom_changed", function () {
          emitView(pano);
        });

        if (interactive) {
          const wrap = wrapRef.current;
          if (wrap) clickCleanup = bindFarWalk(pano, wrap);
        }

        panoRef.current = pano;
        setReady(true);
      });

      return function () {
        cancelled = true;
        if (clickCleanup) clickCleanup();
      };
    },
    [mode, interactive]
  );

  useEffect(
    function () {
      if (!ready || !panoRef.current || mode !== "pano") return;
      if (follow) return;
      if (panoId) {
        panoRef.current.setPano(panoId);
      }
    },
    [ready, mode, panoId, follow]
  );

  useEffect(
    function () {
      if (!ready || !panoRef.current || !follow) return;
      const pano = panoRef.current;
      applyingFollow.current = true;
      if (follow.panoId && pano.getPano() !== follow.panoId) {
        pano.setPano(follow.panoId);
      }
      pano.setPov({ heading: follow.heading, pitch: follow.pitch });
      pano.setZoom(follow.zoom);
      setHeading(follow.heading);
      applyingFollow.current = false;
    },
    [ready, follow?.panoId, follow?.heading, follow?.pitch, follow?.zoom]
  );

  useEffect(
    function () {
      if (!ready || !panoRef.current || mode !== "position") return;
      if (!position) return;

      let active = true;
      const sv = new google.maps.StreetViewService();

      sv.getPanorama(
        {
          location: position,
          radius: radius,
          preference: google.maps.StreetViewPreference.NEAREST,
          source: google.maps.StreetViewSource.OUTDOOR,
        },
        function (data, status) {
          if (!active) return;

          if (
            status === google.maps.StreetViewStatus.OK &&
            data &&
            data.location &&
            data.location.pano &&
            panoRef.current
          ) {
            const foundPanoId = data.location.pano;
            const foundLat = data.location.latLng
              ? data.location.latLng.lat()
              : position.lat;
            const foundLng = data.location.latLng
              ? data.location.latLng.lng()
              : position.lng;

            panoRef.current.setPano(foundPanoId);

            if (onPanoRef.current) {
              onPanoRef.current({
                panoId: foundPanoId,
                lat: foundLat,
                lng: foundLng,
              });
            }
          } else {
            if (onPanoRef.current) {
              onPanoRef.current(null);
            }
          }
        }
      );

      return function () {
        active = false;
      };
    },
    [ready, mode, position?.lat, position?.lng, radius]
  );

  function emitView(pano: google.maps.StreetViewPanorama) {
    if (applyingFollow.current) return;
    const cb = onViewRef.current;
    if (!cb) return;
    const id = pano.getPano();
    const pov = pano.getPov();
    if (!id || !pov) return;
    cb({
      panoId: id,
      heading: pov.heading,
      pitch: pov.pitch,
      zoom: pano.getZoom(),
    });
  }

  return (
    <div
      ref={wrapRef}
      style={{ position: "relative", width: "100%", height: "100%" }}
      className={className}
    >
      <div ref={ref} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
      <div className="sv-compass" aria-hidden="true">
        <div className="sv-compass-rose" style={{ transform: "rotate(" + -heading + "deg)" }}>
          <span className="sv-compass-n">N</span>
          <span className="sv-compass-e">E</span>
          <span className="sv-compass-s">S</span>
          <span className="sv-compass-w">W</span>
          <div className="sv-compass-needle" />
        </div>
      </div>
    </div>
  );
}

function bindFarWalk(
  pano: google.maps.StreetViewPanorama,
  wrap: HTMLDivElement,
): () => void {
  let downX = 0;
  let downY = 0;
  let downAt = 0;

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    downX = e.clientX;
    downY = e.clientY;
    downAt = Date.now();
  }

  function onPointerUp(e: PointerEvent) {
    if (e.button !== 0) return;
    const dx = e.clientX - downX;
    const dy = e.clientY - downY;
    if (dx * dx + dy * dy > 64) return;
    if (Date.now() - downAt > 500) return;
    const target = e.target as HTMLElement | null;
    if (target && target.closest("button, .gm-control, .gm-iv-address, .sv-compass")) {
      return;
    }
    jumpFar(pano, wrap, e.clientX, e.clientY);
  }

  wrap.addEventListener("pointerdown", onPointerDown);
  wrap.addEventListener("pointerup", onPointerUp);
  return function () {
    wrap.removeEventListener("pointerdown", onPointerDown);
    wrap.removeEventListener("pointerup", onPointerUp);
  };
}

function jumpFar(
  pano: google.maps.StreetViewPanorama,
  wrap: HTMLDivElement,
  clientX: number,
  clientY: number,
) {
  const pos = pano.getPosition();
  const pov = pano.getPov();
  if (!pos || !pov) return;

  const rect = wrap.getBoundingClientRect();
  if (rect.width < 8 || rect.height < 8) return;
  const nx = (clientX - rect.left) / rect.width;
  const ny = (clientY - rect.top) / rect.height;
  if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return;

  const fov = fovFromZoom(pano.getZoom());
  const heading = pov.heading + (nx - 0.5) * fov;
  const meters = clickDistanceMeters(ny);

  const dest = google.maps.geometry.spherical.computeOffset(pos, meters, heading);
  const sv = new google.maps.StreetViewService();

  sv.getPanorama(
    {
      location: dest,
      radius: Math.max(35, meters * 0.55),
      preference: google.maps.StreetViewPreference.NEAREST,
      source: google.maps.StreetViewSource.OUTDOOR,
    },
    function (data, status) {
      if (status === google.maps.StreetViewStatus.OK && data && data.location && data.location.pano) {
        if (data.location.pano !== pano.getPano()) {
          pano.setPano(data.location.pano);
          return;
        }
      }
      stepAlongHeading(pano, heading);
    },
  );
}

function stepAlongHeading(pano: google.maps.StreetViewPanorama, heading: number) {
  const links = pano.getLinks() || [];
  let best: google.maps.StreetViewLink | null = null;
  let bestDiff = 70;
  for (let i = 0; i < links.length; i++) {
    const link = links[i];
    if (!link || link.heading == null || !link.pano) continue;
    const d = headingDelta(heading, link.heading);
    if (d < bestDiff) {
      bestDiff = d;
      best = link;
    }
  }
  if (best && best.pano) {
    pano.setPano(best.pano);
  }
}
