"use client";

import { useRef, useState } from "react";
import type { PointerEvent, ReactNode } from "react";

interface Props {
  title: string;
  children: ReactNode;
  className?: string;
}

interface DragState {
  pointerX: number;
  pointerY: number;
  left: number;
  top: number;
}

export default function FloatingMap(props: Props) {
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const dragRef = useRef<DragState | null>(null);

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!bounds) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      left: bounds.left,
      top: bounds.top,
    };
    setPosition({ left: bounds.left, top: bounds.top });
    event.preventDefault();
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const left = Math.max(
      8,
      Math.min(window.innerWidth - 180, drag.left + event.clientX - drag.pointerX),
    );
    const top = Math.max(
      8,
      Math.min(window.innerHeight - 140, drag.top + event.clientY - drag.pointerY),
    );
    setPosition({ left: left, top: top });
  }

  function stopDrag(event: PointerEvent<HTMLDivElement>) {
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <section
      className={`floating-map${props.className ? " " + props.className : ""}`}
      style={position ? { left: position.left, top: position.top, right: "auto", bottom: "auto" } : undefined}
    >
      <div
        className="floating-map-header"
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
      >
        <span>{props.title}</span>
        <span className="floating-map-grip" aria-hidden="true">⠿</span>
      </div>
      <div className="floating-map-content">{props.children}</div>
    </section>
  );
}
