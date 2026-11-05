"use client";

import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps } from "@/lib/mapsLoader";
import type { LatLng, MovementMode } from "@/shared/types";
import { useLanguage } from "@/lib/language";
import { streetViewSource } from "@/lib/streetViewSource";

export interface ResolvedPano extends LatLng {
  panoId: string;
  arrowCount?: number;
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

const MAX_STREET_VIEW_SEARCH_RADIUS = 50000;
const PEDESTRIAN_REGEX =
  /park|trail|footpath|pedestrian|walkway|cycleway|bike path|hiking|plaza|square|парк|тропа|аллея|пешеходн|велодорожка|сквер|hotel|bistro|museum/i;

interface Props {
  mode: "position" | "pano";
  position?: LatLng | null;
  panoId?: string | null;
  radius?: number;
  onPano?: (pano: ResolvedPano | null) => void;
  onPanoError?: (reason: "not_official_road" | "none") => void;
  onView?: (view: StreetViewCam) => void;
  follow?: StreetViewCam | null;
  interactive?: boolean;
  allowUnofficialCoverage?: boolean;
  className?: string;
  /**
   * Movement rule for this panorama.
   *
   *   "free"           — walk and look around.
   *   "no-move"        — NMPZ: no travel to a neighbouring panorama, but the
   *                      camera may still rotate/pitch/zoom.
   *   "NMPZ"           — the camera is frozen as well: one static frame.
   *
   * The lock is applied by disabling the panorama's own navigation controls and
   * by pinning the pano id, so a stray click on a link arrow cannot move the
   * player. It is a client-side rule by necessity — Street View runs in the
   * browser — but the server records the setting, so every client in the room
   * gets the same lock.
   */
  movementMode?: MovementMode;
}

export default function StreetView(props: Props) {
  const mode = props.mode;
  const position = props.position;
  const panoId = props.panoId;
  const radius = Math.min(
    MAX_STREET_VIEW_SEARCH_RADIUS,
    Math.max(1, props.radius || 120)
  );
  const onPano = props.onPano;
  const onPanoError = props.onPanoError;
  const onView = props.onView;
  const follow = props.follow;
  const interactive = props.interactive !== false;
  const allowUnofficialCoverage = props.allowUnofficialCoverage === true;
  const className = props.className;
  const movementMode: MovementMode = props.movementMode ?? "free";
  // NMPZ: no travel. The strict variant also freezes the camera.
  const noMove = movementMode !== "free";
  const noPan = movementMode === "NMPZ";
  const movementModeRef = useRef(movementMode);
  movementModeRef.current = movementMode;
  // The pano the player is pinned to while NMPZ is active.
  const lockedPanoRef = useRef<string | null>(null);
  // The camera the player is pinned to in the strict variant.
  const lockedPovRef = useRef<{ heading: number; pitch: number } | null>(null);

  const wrapRef = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  const prefetchRef = useRef<HTMLDivElement>(null);
  const panoRef = useRef<google.maps.StreetViewPanorama | null>(null);
  const prefetchPanoRef = useRef<google.maps.StreetViewPanorama | null>(null);

  const onPanoRef = useRef(onPano);
  onPanoRef.current = onPano;
  const onViewRef = useRef(onView);
  onViewRef.current = onView;
  const onPanoErrorRef = useRef(onPanoError);
  onPanoErrorRef.current = onPanoError;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const interactiveRef = useRef(interactive);
  interactiveRef.current = interactive;

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
  const followPanoIdRef = useRef<string | null>(null);
  const followRef = useRef<StreetViewCam | null>(follow ?? null);
  followRef.current = follow ?? null;

  const [ready, setReady] = useState(false);
  const [heading, setHeading] = useState(0);
  const [panoHistory, setPanoHistory] = useState<string[]>([]);
  const { t } = useLanguage();

  async function hybridRoadSnap(
    clickPosition: LatLng,
    panorama: google.maps.StreetViewPanorama,
    active: () => boolean,
    sv: google.maps.StreetViewService
  ): Promise<void> {
    // 1. СНАЧАЛА ИЩЕМ ТОЧНУЮ УЛИЦУ ВОЗЛЕ КЛИКА ЧЕРЕЗ GOOGLE API (радиус 500м)
    sv.getPanorama(
      {
        location: clickPosition,
        radius: 500,
        preference: google.maps.StreetViewPreference.NEAREST,
        source: streetViewSource(
          google.maps.StreetViewSource,
          allowUnofficialCoverage
        ),
      },
      async (data, status) => {
        if (!active()) return;

        if (
          status === google.maps.StreetViewStatus.OK &&
          data &&
          data.location?.pano
        ) {
          const links = (data.links || []).filter(
            (l) => !!l && l.pano !== null && l.heading !== null
          );
          const description = data.location.description || "";
          const isPedestrian = PEDESTRIAN_REGEX.test(description);

          // Проверяем: минимуму 2 стрелки (автодорога) и отсутствие пешеходных стоп-слов
          if ((allowUnofficialCoverage || links.length >= 2) && !isPedestrian) {
            const foundPanoId = data.location.pano;
            const foundLat = data.location.latLng
              ? data.location.latLng.lat()
              : clickPosition.lat;
            const foundLng = data.location.latLng
              ? data.location.latLng.lng()
              : clickPosition.lng;

            panorama.setPano(foundPanoId);
            onPanoRef.current?.({
              panoId: foundPanoId,
              lat: foundLat,
              lng: foundLng,
              arrowCount: links.length,
            });
            return;
          }
        }

        // 2. ЕСЛИ В РАДИУСЕ 500М НЕТ АВТОДОРОГ GOOGLE (ОКЕАН / ГЛУШЬ) — ФОЛЛБЕК НА VALI
        try {
          const response = await fetch(
            `/api/road-snap?lat=${encodeURIComponent(
              clickPosition.lat
            )}&lng=${encodeURIComponent(clickPosition.lng)}`
          );
          if (!response.ok)
            throw new Error(`road snap returned ${response.status}`);
          const result = (await response.json()) as {
            ok: boolean;
            location?: {
              lat: number;
              lng: number;
              panoId: string;
              heading: number;
            };
          };

          const location = result.location;
          if (!active() || !result.ok || !location) {
            onPanoErrorRef.current?.("none");
            onPanoRef.current?.(null);
            return;
          }

          panorama.setPano(location.panoId);
          onPanoRef.current?.({
            lat: location.lat,
            lng: location.lng,
            panoId: location.panoId,
            arrowCount: 2,
          });
        } catch (error) {
          console.error("[street-view] Vali fallback failed", error);
          if (active()) {
            onPanoErrorRef.current?.("none");
            onPanoRef.current?.(null);
          }
        }
      }
    );
  }

  const onPanoChanged = useRef(function (panoId: string) {
    if (skippedHistoryPanoRef.current === panoId) {
      skippedHistoryPanoRef.current = null;
      return;
    }
    if (pendingHistoryPanoRef.current === panoId) {
      historyIndexRef.current =
        pendingHistoryIndexRef.current ?? historyIndexRef.current;
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

  /**
   * Wires the panorama listeners and returns a detach function.
   *
   * Kept separate from creation so React StrictMode's mount → unmount → mount
   * cycle re-attaches listeners to the *same* panorama. Creating a second
   * StreetViewPanorama on a container that already holds one leaks the first
   * and leaves two renderers fighting over the same DOM node.
   */
  function attachListeners(
    google: typeof globalThis.google,
    pano: google.maps.StreetViewPanorama,
    prefetchPano: google.maps.StreetViewPanorama
  ): () => void {
    function applyFollowCamera() {
      const currentFollow = followRef.current;
      if (!currentFollow || pano.getPano() !== currentFollow.panoId) return;

      const h =
        typeof currentFollow.heading === "number" &&
        Number.isFinite(currentFollow.heading)
          ? currentFollow.heading
          : 0;
      const p =
        typeof currentFollow.pitch === "number" &&
        Number.isFinite(currentFollow.pitch)
          ? currentFollow.pitch
          : 0;
      pano.setPov({ heading: h, pitch: p });
      if (
        typeof currentFollow.zoom === "number" &&
        Number.isFinite(currentFollow.zoom)
      ) {
        pano.setZoom(currentFollow.zoom);
      }
      setHeading(h);
    }

    pano.addListener("position_changed", function () {
      const position = pano.getPosition();
      lastPositionRef.current = position;
      const currentPano = pano.getPano();
      if (position && currentPano) {
        positionsByPanoRef.current.set(currentPano, position);
      }
      if (modeRef.current === "position") {
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
        // NMPZ: if the panorama changed to anything other than the pinned one,
        // snap straight back. This catches a link-arrow click, a keyboard
        // shortcut, or any other path that bypasses the disabled controls.
        const locked = lockedPanoRef.current;
        if (locked && id !== locked) {
          programmaticPanosRef.current.add(locked);
          pano.setPano(locked);
          return;
        }
        programmaticPanosRef.current.delete(id);
        lastPanoRef.current = id;
        onPanoChanged.current(id);
        applyFollowCamera();
        emitView(pano);
      }
    });

    pano.addListener("status_changed", function () {
      if (pano.getStatus() === google.maps.StreetViewStatus.OK) {
        applyFollowCamera();
        emitView(pano);
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
      // Strict NMPZ: the camera is frozen, so any rotation is undone. The
      // spawn heading is captured when the lock is armed.
      if (movementModeRef.current === "NMPZ" && lockedPovRef.current) {
        const want = lockedPovRef.current;
        if (
          Math.abs(pov.heading - want.heading) > 0.5 ||
          Math.abs(pov.pitch - want.pitch) > 0.5
        ) {
          pano.setPov(want);
          return;
        }
      }
      emitView(pano);
    });

    pano.addListener("zoom_changed", function () {
      emitView(pano);
    });

    return function () {
      google.maps.event.clearInstanceListeners(pano);
      google.maps.event.clearInstanceListeners(prefetchPano);
    };
  }

  useEffect(function () {
    let cancelled = false;
    let detach: (() => void) | null = null;

    loadGoogleMaps().then(function (google) {
      if (cancelled || !ref.current || !prefetchRef.current) return;

      // Reuse an existing panorama when StrictMode re-runs this effect; only
      // build one the first time.
      let pano = panoRef.current;
      let prefetchPano = prefetchPanoRef.current;
      if (!pano || !prefetchPano) {
        pano = new google.maps.StreetViewPanorama(ref.current, {
          visible: true,
          addressControl: false,
          showRoadLabels: false,
          fullscreenControl: false,
          motionTracking: false,
          motionTrackingControl: false,
          panControl: false,
          // NMPZ disables travel (link arrows and click-to-go) while leaving the
          // camera controls alone; the strict variant disables those too.
          linksControl: interactive && !noMove,
          clickToGo: interactive && !noMove,
          zoomControl: interactive && !noPan,
          scrollwheel: interactive && !noPan,
          disableDefaultUI: !interactive,
        });

        prefetchPano = new google.maps.StreetViewPanorama(
          prefetchRef.current,
          {
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
          }
        );

        panoRef.current = pano;
        prefetchPanoRef.current = prefetchPano;
      }

      detach = attachListeners(google, pano, prefetchPano);
      setReady(true);
    });

    return function () {
      cancelled = true;
      // Detach listeners but keep the panorama instances: the next effect run
      // re-attaches to them rather than creating a duplicate.
      if (detach) detach();
    };
  }, []);

  // Apply the movement rule to an already-built panorama. The options above
  // only take effect at construction, and the panorama is deliberately reused
  // across StrictMode remounts, so the lock has to be re-applied on change.
  useEffect(
    function () {
      const pano = panoRef.current;
      if (!pano) return;
      pano.setOptions({
        linksControl: interactive && !noMove,
        clickToGo: interactive && !noMove,
        zoomControl: interactive && !noPan,
        scrollwheel: interactive && !noPan,
      });
      if (noMove) {
        // Pin the current panorama (or the requested one) as the only reachable
        // frame, and remember the spawn camera for the strict variant.
        const pinned = panoId ?? pano.getPano() ?? null;
        lockedPanoRef.current = pinned;
        const pov = pano.getPov();
        lockedPovRef.current = noPan && pov ? { heading: pov.heading, pitch: pov.pitch } : null;
      } else {
        lockedPanoRef.current = null;
        lockedPovRef.current = null;
      }
    },
    [ready, noMove, noPan, interactive, panoId],
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
      followPanoIdRef.current = null;
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
      if (!ready || !panoRef.current || !follow) {
        if (!follow) followPanoIdRef.current = null;
        return;
      }
      const pano = panoRef.current;
      applyingFollow.current = true;
      pano.setVisible(true);
      if (follow.panoId && followPanoIdRef.current !== follow.panoId) {
        followPanoIdRef.current = follow.panoId;
        programmaticPanosRef.current.add(follow.panoId);
        pano.setPano(follow.panoId);
      }
      const h =
        typeof follow.heading === "number" && Number.isFinite(follow.heading)
          ? follow.heading
          : 0;
      const p =
        typeof follow.pitch === "number" && Number.isFinite(follow.pitch)
          ? follow.pitch
          : 0;
      pano.setPov({ heading: h, pitch: p });
      if (typeof follow.zoom === "number" && Number.isFinite(follow.zoom)) {
        pano.setZoom(follow.zoom);
      }
      setHeading(h);
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

      hybridRoadSnap(position, panoRef.current, () => active, sv);

      return function () {
        active = false;
      };
    },
    [
      ready,
      mode,
      position?.lat,
      position?.lng,
      radius,
      allowUnofficialCoverage,
    ]
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

  function prefetchNextPano(
    prefetchPano: google.maps.StreetViewPanorama,
    links: google.maps.StreetViewLink[],
    viewHeading: number
  ) {
    let nextLink: google.maps.StreetViewLink | null = null;
    let closestDelta = Infinity;
    for (const link of links) {
      if (link.pano === null || link.heading === null) continue;
      const delta = Math.abs(
        (((link.heading - viewHeading + 540) % 360) - 180)
      );
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
    if (historyIndexRef.current > 0)
      navigateToHistory(historyIndexRef.current - 1);
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
      className={`${className ?? ""}${noPan ? " street-view-strict-lock" : ""}`}
      onClickCapture={function (event) {
        const target = event.target;
        if (target instanceof HTMLElement && target.closest("a")) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      <div
        ref={ref}
        className="street-view-canvas"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
        }}
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
      {interactive && (
        <div className="sv-topbar">
          <div className="sv-navigation">
            <button
              type="button"
              onClick={returnToStart}
              disabled={panoHistory.length === 0}
            >
              {t("Back to start")}
            </button>
            <button
              type="button"
              onClick={goBack}
              disabled={historyIndexRef.current <= 0}
            >
              {t("Back")}
            </button>
          </div>
        </div>
      )}
      <div
        className="sv-compass-dial"
        aria-label={`Heading ${Math.round(heading)} degrees`}
      >
        <div className="sv-compass" aria-hidden="true">
          <div
            className="sv-compass-rose"
            style={{ transform: "rotate(" + -heading + "deg)" }}
          >
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