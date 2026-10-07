"use client";

import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps } from "@/lib/mapsLoader";
import type { LatLng } from "@/shared/types";
import { useLanguage } from "@/lib/language";
import { streetViewSource } from "@/lib/streetViewSource";

export interface ResolvedPano extends LatLng {
  panoId: string;
}

export interface StreetViewCam {
  panoId: string;
  heading: number;
  pitch: number;
  zoom: number;
}

const COMPASS_POINTS = [
  { label: "N", bearing: 0 },
  { label: "NE", bearing: 45 },
  { label: "E", bearing: 90 },
  { label: "SE", bearing: 135 },
  { label: "S", bearing: 180 },
  { label: "SW", bearing: 225 },
  { label: "W", bearing: 270 },
  { label: "NW", bearing: 315 },
];

const ARROW_TELEPORT_DISTANCE_METERS = 40;
const ARROW_TELEPORT_RADIUS_METERS = 1;

interface Props {
  mode: "position" | "pano";
  position?: LatLng | null;
  panoId?: string | null;
  radius?: number;
  onPano?: (pano: ResolvedPano | null) => void;
  onView?: (view: StreetViewCam) => void;
  follow?: StreetViewCam | null;
  interactive?: boolean;
  allowUnofficialCoverage?: boolean;
  className?: string;
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
  const allowUnofficialCoverage = props.allowUnofficialCoverage === true;
  const className = props.className;

  const wrapRef = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  const prefetchRef = useRef<HTMLDivElement>(null);
  const panoRef = useRef<google.maps.StreetViewPanorama | null>(null);
  const prefetchPanoRef = useRef<google.maps.StreetViewPanorama | null>(null);
  const onPanoRef = useRef(onPano);
  onPanoRef.current = onPano;
  const onViewRef = useRef(onView);
  onViewRef.current = onView;
  const applyingFollow = useRef(false);
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const pendingHistoryIndexRef = useRef<number | null>(null);
  const pendingHistoryPanoRef = useRef<string | null>(null);
  const startPanoRef = useRef<string | null>(null);
  const lastPanoRef = useRef<string | null>(null);
  const lastPositionRef = useRef<google.maps.LatLng | null>(null);
  const positionsByPanoRef = useRef(new Map<string, google.maps.LatLng>());
  const linksRef = useRef<google.maps.StreetViewLink[]>([]);
  const linksByPanoRef = useRef(new Map<string, google.maps.StreetViewLink[]>());
  const skippedHistoryPanoRef = useRef<string | null>(null);
  const programmaticPanosRef = useRef(new Set<string>());
  const teleportingRef = useRef(false);
  const teleportRequestRef = useRef(0);
  const [ready, setReady] = useState(false);
  const [heading, setHeading] = useState(0);
  const [panoHistory, setPanoHistory] = useState<string[]>([]);
  const { t } = useLanguage();

  const onPanoChanged = useRef(function (panoId: string) {
    if (skippedHistoryPanoRef.current === panoId) {
      skippedHistoryPanoRef.current = null;
      return;
    }
    if (pendingHistoryPanoRef.current === panoId) {
      historyIndexRef.current = pendingHistoryIndexRef.current ?? historyIndexRef.current;
      pendingHistoryPanoRef.current = null;
      pendingHistoryIndexRef.current = null;
      return;
    }
    if (historyRef.current[historyIndexRef.current] === panoId) return;
    const nextHistory = historyRef.current.slice(0, historyIndexRef.current + 1);
    nextHistory.push(panoId);
    historyRef.current = nextHistory;
    historyIndexRef.current = nextHistory.length - 1;
    if (!startPanoRef.current) startPanoRef.current = panoId;
    setPanoHistory(nextHistory);
  });

  useEffect(
    function () {
      let cancelled = false;
      let clearListeners: (() => void) | null = null;

      loadGoogleMaps().then(function (google) {
        if (cancelled || !ref.current || !prefetchRef.current || panoRef.current) return;

        const pano = new google.maps.StreetViewPanorama(ref.current, {
          visible: true,
          addressControl: false,
          showRoadLabels: false,
          fullscreenControl: false,
          motionTracking: false,
          motionTrackingControl: false,
          panControl: false,
          linksControl: interactive,
          clickToGo: interactive,
          zoomControl: interactive,
          scrollwheel: interactive,
          disableDefaultUI: !interactive,
        });
        const prefetchPano = new google.maps.StreetViewPanorama(prefetchRef.current, {
          visible: true,
          addressControl: false,
          showRoadLabels: false,
          fullscreenControl: false,
          motionTracking: false,
          motionTrackingControl: false,
          panControl: false,
          linksControl: false,
          clickToGo: false,
          zoomControl: false,
          scrollwheel: false,
          disableDefaultUI: true,
        });
        clearListeners = function () {
          google.maps.event.clearInstanceListeners(pano);
          google.maps.event.clearInstanceListeners(prefetchPano);
        };

        pano.addListener("position_changed", function () {
          const position = pano.getPosition();
          lastPositionRef.current = position;
          const currentPano = pano.getPano();
          if (position && currentPano) {
            positionsByPanoRef.current.set(currentPano, position);
          }
          if (mode === "position") {
            const id = pano.getPano();
            const pos = position;
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

        pano.addListener("pano_changed", function () {
          const id = pano.getPano();
          if (id) {
            const previousPanoId = lastPanoRef.current;
            const previousPosition =
              (previousPanoId && positionsByPanoRef.current.get(previousPanoId)) ||
              lastPositionRef.current;
            const programmatic = programmaticPanosRef.current.delete(id);
            if (teleportingRef.current && programmatic) {
              teleportingRef.current = false;
            }
            const previousLinks =
              (previousPanoId && linksByPanoRef.current.get(previousPanoId)) ||
              linksRef.current;
            const link = previousLinks.find(function (candidate) {
              return candidate.pano === id;
            });

            if (
              interactive &&
              !programmatic &&
              previousPanoId &&
              previousPosition &&
              link &&
              link.heading !== null
            ) {
              skippedHistoryPanoRef.current = id;
              teleportAlongArrow(pano, previousPosition, link.heading);
            }

            lastPanoRef.current = id;
            onPanoChanged.current(id);
          }
        });

        pano.addListener("links_changed", function () {
          const links = (pano.getLinks() || []).filter(function (
            link
          ): link is google.maps.StreetViewLink {
            return !!link && link.pano !== null && link.heading !== null;
          });
          linksRef.current = links;
          const currentPano = pano.getPano();
          if (currentPano) linksByPanoRef.current.set(currentPano, links);
          prefetchNextPano(prefetchPano, links, pano.getPov().heading);
        });

        pano.addListener("pov_changed", function () {
          const pov = pano.getPov();
          if (pov) setHeading(pov.heading);
          emitView(pano);
        });

        pano.addListener("zoom_changed", function () {
          emitView(pano);
        });

        panoRef.current = pano;
        prefetchPanoRef.current = prefetchPano;
        setReady(true);
      });

      return function () {
        cancelled = true;
        if (clearListeners) clearListeners();
      };
    },
    [mode, interactive]
  );

  useEffect(
    function () {
      historyRef.current = [];
      historyIndexRef.current = -1;
      pendingHistoryIndexRef.current = null;
      pendingHistoryPanoRef.current = null;
      startPanoRef.current = null;
      lastPanoRef.current = null;
      lastPositionRef.current = null;
      positionsByPanoRef.current.clear();
      linksRef.current = [];
      linksByPanoRef.current.clear();
      skippedHistoryPanoRef.current = null;
      programmaticPanosRef.current.clear();
      teleportingRef.current = false;
      teleportRequestRef.current += 1;
      prefetchPanoRef.current = null;
      setPanoHistory([]);
    },
    [mode, position?.lat, position?.lng, panoId]
  );

  useEffect(
    function () {
      if (!ready || !panoRef.current || mode !== "pano") return;
      if (follow) return;
      if (panoId) {
        programmaticPanosRef.current.add(panoId);
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
        programmaticPanosRef.current.add(follow.panoId);
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
          source: streetViewSource(
            google.maps.StreetViewSource,
            allowUnofficialCoverage,
          ),
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
    [ready, mode, position?.lat, position?.lng, radius, allowUnofficialCoverage]
  );

  function navigateToHistory(index: number) {
    const target = historyRef.current[index];
    const pano = panoRef.current;
    if (!target || !pano) return;
    historyIndexRef.current = index;
    pendingHistoryIndexRef.current = index;
    pendingHistoryPanoRef.current = target;
    setPanoHistory(historyRef.current.slice());
    programmaticPanosRef.current.add(target);
    pano.setPano(target);
  }

  function teleportAlongArrow(
    pano: google.maps.StreetViewPanorama,
    origin: google.maps.LatLng,
    heading: number,
  ) {
    teleportingRef.current = true;
    const requestId = ++teleportRequestRef.current;

    const targetLatLng = google.maps.geometry.spherical.computeOffset(
      origin,
      ARROW_TELEPORT_DISTANCE_METERS,
      heading,
    );
    const service = new google.maps.StreetViewService();
    const currentPov = pano.getPov();
    const currentZoom = pano.getZoom();

    function applyTargetPano(
      data: google.maps.StreetViewPanoramaData | null,
      status: google.maps.StreetViewStatusString,
    ) {
        if (requestId !== teleportRequestRef.current) return;
        if (
          status !== google.maps.StreetViewStatus.OK ||
          !data ||
          !data.location ||
          !data.location.pano
        ) {
          teleportingRef.current = false;
          return;
        }

        const targetPano = data.location.pano;
        programmaticPanosRef.current.add(targetPano);
        pano.setPano(targetPano);
        pano.setPov({
          heading,
          pitch: currentPov.pitch,
        });
        pano.setZoom(currentZoom);
    }

    service.getPanorama(
      {
        location: targetLatLng,
        radius: ARROW_TELEPORT_RADIUS_METERS,
        source: google.maps.StreetViewSource.OUTDOOR,
      },
      function (data, status) {
        if (status === google.maps.StreetViewStatus.ZERO_RESULTS) {
          service.getPanorama(
            {
              location: targetLatLng,
              radius: 5,
              source: google.maps.StreetViewSource.OUTDOOR,
            },
            applyTargetPano,
          );
          return;
        }
        applyTargetPano(data, status);
      },
    );
  }

  function prefetchNextPano(
    prefetchPano: google.maps.StreetViewPanorama,
    links: google.maps.StreetViewLink[],
    viewHeading: number,
  ) {
    let nextLink: google.maps.StreetViewLink | null = null;
    let closestDelta = Infinity;
    for (const link of links) {
      if (link.pano === null || link.heading === null) continue;
      const delta = Math.abs((((link.heading - viewHeading + 540) % 360) - 180));
      if (delta < closestDelta) {
        closestDelta = delta;
        nextLink = link;
      }
    }
    if (nextLink?.pano && prefetchPano.getPano() !== nextLink.pano) {
      prefetchPano.setPano(nextLink.pano);
    }
  }

  function returnToStart() {
    const start = startPanoRef.current;
    const index = historyRef.current.indexOf(start || "");
    if (index !== -1) navigateToHistory(index);
  }

  function goBack() {
    if (historyIndexRef.current > 0) navigateToHistory(historyIndexRef.current - 1);
  }

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
      <div
        ref={ref}
        className="street-view-canvas"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      />
      <div
        ref={prefetchRef}
        aria-hidden="true"
        style={{
          position: "absolute",
          width: "1px",
          height: "1px",
          left: "-10px",
          top: "-10px",
          opacity: 0,
          pointerEvents: "none",
        }}
      />
      <div className="sv-heading-band" aria-hidden="true">
        {COMPASS_POINTS.map(function (point) {
          const delta = ((point.bearing - heading + 540) % 360) - 180;
          return (
            <span
              className={point.label === "N" ? "is-north" : ""}
              key={point.label}
              style={{ left: 50 + delta / 3.6 + "%" }}
            >
              {point.label}
            </span>
          );
        })}
        <i />
      </div>
      <div className="sv-topbar">
        {interactive && (
          <div className="sv-navigation">
            <button type="button" onClick={returnToStart} disabled={panoHistory.length === 0}>
              {t("Back to start")}
            </button>
            <button type="button" onClick={goBack} disabled={historyIndexRef.current <= 0}>
              {t("Back")}
            </button>
          </div>
        )}
      </div>
      <div className="sv-compass-dial" aria-label={`Heading ${Math.round(heading)} degrees`}>
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
    </div>
  );
}
