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
  const panoRef = useRef<google.maps.StreetViewPanorama | null>(null);
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
  const roadSearchRef = useRef(0);
  const [ready, setReady] = useState(false);
  const [heading, setHeading] = useState(0);
  const [panoHistory, setPanoHistory] = useState<string[]>([]);
  const [roadStatus, setRoadStatus] = useState("");
  const [findingRoad, setFindingRoad] = useState(false);
  const [roadLinks, setRoadLinks] = useState<google.maps.StreetViewLink[]>([]);
  const nextHeadingRef = useRef<{ panoId: string; heading: number } | null>(null);

  const onPanoChanged = useRef(function (panoId: string) {
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
        if (cancelled || !ref.current || panoRef.current) return;

        const pano = new google.maps.StreetViewPanorama(ref.current, {
          visible: true,
          addressControl: false,
          showRoadLabels: false,
          fullscreenControl: false,
          motionTracking: false,
          motionTrackingControl: false,
          panControl: false,
          linksControl: false,
          clickToGo: false,
          zoomControl: interactive,
          scrollwheel: interactive,
          disableDefaultUI: !interactive,
        });
        clearListeners = function () {
          google.maps.event.clearInstanceListeners(pano);
        };

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

        pano.addListener("pano_changed", function () {
          const id = pano.getPano();
          if (id) {
            setRoadLinks([]);
            onPanoChanged.current(id);
            const nextHeading = nextHeadingRef.current;
            if (nextHeading?.panoId === id) {
              pano.setPov({ heading: nextHeading.heading, pitch: pano.getPov().pitch });
              nextHeadingRef.current = null;
            }
          }
        });

        pano.addListener("links_changed", function () {
          setRoadLinks(
            (pano.getLinks() || []).filter(function (
              link,
            ): link is google.maps.StreetViewLink {
              return Boolean(link && link.pano && link.heading != null);
            }),
          );
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
      setPanoHistory([]);
      setRoadStatus("");
      setFindingRoad(false);
      setRoadLinks([]);
      return function () {
        roadSearchRef.current += 1;
      };
    },
    [mode, position?.lat, position?.lng, panoId]
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
          source: allowUnofficialCoverage
            ? google.maps.StreetViewSource.DEFAULT
            : google.maps.StreetViewSource.OUTDOOR,
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
    pano.setPano(target);
  }

  function returnToStart() {
    const start = startPanoRef.current;
    const index = historyRef.current.indexOf(start || "");
    if (index !== -1) navigateToHistory(index);
  }

  function goBack() {
    if (historyIndexRef.current > 0) navigateToHistory(historyIndexRef.current - 1);
  }

  function findNearestRoad() {
    const pano = panoRef.current;
    const location = pano?.getPosition();
    if (!pano || !location || findingRoad) return;
    const activePano = pano;
    setFindingRoad(true);
    setRoadStatus("");
    const searchId = ++roadSearchRef.current;
    const service = new google.maps.StreetViewService();
    const radii = [100, 300, 750, 1500, 3000];
    let attempt = 0;

    function search() {
      service.getPanorama(
        {
          location: location,
          radius: radii[attempt],
          preference: google.maps.StreetViewPreference.NEAREST,
          source: google.maps.StreetViewSource.OUTDOOR,
        },
        function (data, status) {
          if (searchId !== roadSearchRef.current) return;
          const connectedLinks = (data?.links || []).filter(function (
            link,
          ): link is google.maps.StreetViewLink {
            return Boolean(link && link.pano && link.heading != null);
          });
          if (
            status === google.maps.StreetViewStatus.OK &&
            data?.location?.pano &&
            data.location.pano !== activePano.getPano() &&
            connectedLinks.length > 0
          ) {
            const firstRoad = connectedLinks[0];
            if (firstRoad.heading != null && firstRoad.pano) {
              nextHeadingRef.current = {
                panoId: data.location.pano,
                heading: firstRoad.heading,
              };
            }
            activePano.setPano(data.location.pano);
            setRoadLinks(connectedLinks);
            setFindingRoad(false);
            setRoadStatus("");
            return;
          }
          attempt += 1;
          if (attempt < radii.length) {
            search();
          } else {
            setFindingRoad(false);
            setRoadStatus("Поблизу не знайдено офіційної панорами дороги.");
          }
        }
      );
    }

    search();
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
      <div ref={ref} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
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
              На старт
            </button>
            <button type="button" onClick={goBack} disabled={historyIndexRef.current <= 0}>
              Назад
            </button>
            <button type="button" onClick={findNearestRoad} disabled={findingRoad || !ready}>
              {findingRoad ? "Шукаю дорогу…" : "На найближчу дорогу"}
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
      {interactive && roadLinks.map(function (link, index) {
        const targetPano = link.pano;
        const targetHeading = link.heading;
        if (!targetPano || targetHeading == null) return null;
        const delta = ((targetHeading - heading + 540) % 360) - 180;
        const fieldOfView = 180 / Math.pow(2, Math.max(0, panoRef.current?.getZoom() || 0));
        if (Math.abs(delta) > fieldOfView / 2 + 12) return null;
        return (
          <button
            type="button"
            className="sv-road-arrow"
            key={targetPano}
            title={link.description || "Continue along the road"}
            aria-label={link.description || "Continue along the road"}
            style={{
              left: 50 + (delta / fieldOfView) * 100 + "%",
              top: 65 + (index % 2) * 10 + "%",
              transform: "translate(-50%, -50%) rotate(" + delta + "deg)",
            }}
            onClick={function (event) {
              event.stopPropagation();
              nextHeadingRef.current = { panoId: targetPano, heading: targetHeading };
              panoRef.current?.setPano(targetPano);
            }}
          >
            ↑
          </button>
        );
      })}
      {roadStatus && <div className="sv-road-status" role="status">{roadStatus}</div>}
    </div>
  );
}
