"use client";

import { emojiUrl } from "@/shared/emojis";
import type { LatLng } from "@/shared/types";

// An emoji image rendered as a Google Maps marker via a custom OverlayView.
// Why not google.maps.Marker / AdvancedMarkerElement?
//  - classic Marker rasterizes its icon, so animated GIFs DON'T animate;
//  - AdvancedMarkerElement would force a Map ID, which disables the inline
//    EARTHY_MAP_STYLE. A plain <img> in an overlay animates GIFs and keeps the
//    style. The image lives in a fixed-size square box (.emoji-img is
//    object-fit: contain) so any source size/ratio keeps a constant footprint.

export interface ImageMarkerOptions {
  position: LatLng;
  /** Emoji id (see src/shared/emojis.ts). */
  emoji: string;
  /** Square footprint in px. */
  size?: number;
  /** 0..1 marker opacity (e.g. a tentative, un-confirmed pin). Defaults to 1. */
  opacity?: number;
  draggable?: boolean;
  /** Streamed continuously while the marker is being dragged. */
  onDrag?: (p: LatLng) => void;
  onDragEnd?: (p: LatLng) => void;
  zIndex?: number;
}

export interface ImageMarker {
  setMap(map: google.maps.Map | null): void;
  setPosition(p: LatLng): void;
  setEmoji(emoji: string): void;
  setOpacity(o: number): void;
}

// The OverlayView subclass can only be defined once `google.maps` exists, so we
// build it lazily on first use and memoize the class.
let klass: (new (opts: ImageMarkerOptions) => ImageMarker) | null = null;

export function createImageMarker(opts: ImageMarkerOptions): ImageMarker {
  if (!klass) klass = buildClass();
  return new klass(opts);
}

function buildClass(): new (opts: ImageMarkerOptions) => ImageMarker {
  class ImageMarkerOverlay extends google.maps.OverlayView implements ImageMarker {
    private position: LatLng;
    private emoji: string;
    private opacity: number;
    private readonly size: number;
    private readonly draggable: boolean;
    private readonly onDrag?: (p: LatLng) => void;
    private readonly onDragEnd?: (p: LatLng) => void;
    private readonly zIndex: number;
    private wrap: HTMLDivElement | null = null;
    private img: HTMLImageElement | null = null;
    // grab offset (container px) between pointer and the marker anchor
    private grab: { dx: number; dy: number } | null = null;

    constructor(o: ImageMarkerOptions) {
      super();
      this.position = o.position;
      this.emoji = o.emoji;
      this.opacity = o.opacity ?? 1;
      this.size = o.size ?? 40;
      this.draggable = !!o.draggable;
      this.onDrag = o.onDrag;
      this.onDragEnd = o.onDragEnd;
      this.zIndex = o.zIndex ?? 0;
    }

    override onAdd(): void {
      const wrap = document.createElement("div");
      wrap.style.position = "absolute";
      wrap.style.width = `${this.size}px`;
      wrap.style.height = `${this.size}px`;
      wrap.style.transform = "translate(-50%, -50%)";
      wrap.style.zIndex = String(this.zIndex);
      wrap.style.userSelect = "none";
      wrap.style.pointerEvents = this.draggable ? "auto" : "none";
      wrap.style.cursor = this.draggable ? "grab" : "";
      wrap.style.filter = "drop-shadow(0 2px 3px rgba(0,0,0,0.45))";
      wrap.style.opacity = String(this.opacity);
      wrap.style.display = "flex";
      wrap.style.alignItems = "center";
      wrap.style.justifyContent = "center";
      wrap.style.transition = "opacity 150ms ease";

      const img = document.createElement("img");
      img.className = "map-pin-img";
      img.src = emojiUrl(this.emoji);
      img.draggable = false;
      img.alt = "";
      wrap.appendChild(img);

      this.wrap = wrap;
      this.img = img;
      // overlayMouseTarget receives pointer events (needed for dragging).
      this.getPanes()!.overlayMouseTarget.appendChild(wrap);

      if (this.draggable) wrap.addEventListener("pointerdown", this.onPointerDown);
    }

    override draw(): void {
      if (!this.wrap) return;
      const proj = this.getProjection();
      if (!proj) return;
      const pt = proj.fromLatLngToDivPixel(
        new google.maps.LatLng(this.position.lat, this.position.lng),
      );
      if (!pt) return;
      this.wrap.style.left = `${pt.x}px`;
      this.wrap.style.top = `${pt.y}px`;
    }

    override onRemove(): void {
      if (this.wrap) {
        this.wrap.removeEventListener("pointerdown", this.onPointerDown);
        this.wrap.remove();
      }
      this.wrap = null;
      this.img = null;
    }

    setPosition(p: LatLng): void {
      this.position = p;
      this.draw();
    }

    setEmoji(emoji: string): void {
      this.emoji = emoji;
      if (this.img) this.img.src = emojiUrl(emoji);
    }

    setOpacity(o: number): void {
      this.opacity = o;
      if (this.wrap) this.wrap.style.opacity = String(o);
    }

    // --- dragging (pointer-based; disables map panning while active) ---
    private containerPx(e: PointerEvent): { x: number; y: number } {
      const map = this.getMap() as google.maps.Map;
      const rect = map.getDiv().getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    private onPointerDown = (e: PointerEvent): void => {
      if (!this.wrap) return;
      e.preventDefault();
      e.stopPropagation();
      const map = this.getMap() as google.maps.Map;
      map.setOptions({ gestureHandling: "none" });
      this.wrap.style.cursor = "grabbing";
      this.wrap.setPointerCapture(e.pointerId);
      // Preserve the grab point so the marker doesn't snap its anchor to the cursor.
      const proj = this.getProjection();
      const anchor = proj.fromLatLngToContainerPixel(
        new google.maps.LatLng(this.position.lat, this.position.lng),
      );
      const p = this.containerPx(e);
      this.grab = anchor ? { dx: p.x - anchor.x, dy: p.y - anchor.y } : { dx: 0, dy: 0 };
      this.wrap.addEventListener("pointermove", this.onPointerMove);
      this.wrap.addEventListener("pointerup", this.onPointerUp);
      this.wrap.addEventListener("pointercancel", this.onPointerUp);
    };

    private onPointerMove = (e: PointerEvent): void => {
      if (!this.grab) return;
      e.preventDefault();
      const proj = this.getProjection();
      const p = this.containerPx(e);
      const ll = proj.fromContainerPixelToLatLng(
        new google.maps.Point(p.x - this.grab.dx, p.y - this.grab.dy),
      );
      if (ll) {
        this.setPosition({ lat: ll.lat(), lng: ll.lng() });
        this.onDrag?.(this.position);
      }
    };

    private onPointerUp = (e: PointerEvent): void => {
      if (!this.wrap) return;
      this.grab = null;
      this.wrap.style.cursor = "grab";
      try {
        this.wrap.releasePointerCapture(e.pointerId);
      } catch {
        /* capture may already be gone */
      }
      this.wrap.removeEventListener("pointermove", this.onPointerMove);
      this.wrap.removeEventListener("pointerup", this.onPointerUp);
      this.wrap.removeEventListener("pointercancel", this.onPointerUp);
      // Restore the app's default gesture mode (set in MapPicker).
      (this.getMap() as google.maps.Map).setOptions({ gestureHandling: "greedy" });
      this.onDragEnd?.(this.position);
    };
  }

  return ImageMarkerOverlay;
}
