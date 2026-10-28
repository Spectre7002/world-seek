"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { HorrorRunView } from "@/components/horror/types";

export type HorrorStatus = "connecting" | "in-game" | "error";

export interface HorrorActResult {
  ok: boolean;
  reason?: string;
  run?: HorrorRunView;
  actionResult?: {
    kind: string;
    ok: boolean;
    reason?: string;
    caught?: boolean;
    fell?: boolean;
    dead?: boolean;
    rejected?: boolean;
    fullHeal?: boolean;
    distanceKm?: number;
    score?: number;
    destroyed?: boolean;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

const SEQ_STORAGE_KEY = (runId: string) => `horror-seq:${runId}`;

function loadSeq(runId: string): number {
  if (typeof window === "undefined") return 0;
  const raw = window.localStorage.getItem(SEQ_STORAGE_KEY(runId));
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function saveSeq(runId: string, seq: number): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SEQ_STORAGE_KEY(runId), String(seq));
}

export function useHorrorRun(runId: string | null) {
  const [run, setRun] = useState<HorrorRunView | null>(null);
  const [status, setStatus] = useState<HorrorStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const seqRef = useRef<number>(0);
  const runIdRef = useRef<string | null>(runId);
  // Actions are serialised: two concurrent calls must not share a `seq`.
  const queueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    runIdRef.current = runId;
    if (!runId) {
      setStatus("error");
      setError("missing_runId");
      return;
    }
    seqRef.current = loadSeq(runId);
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/horror/run?runId=${encodeURIComponent(runId)}`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok || !data.ok) {
          setStatus("error");
          setError(data.reason ?? "not_found");
          return;
        }
        setRun(data.run as HorrorRunView);
        setStatus("in-game");
      } catch (e) {
        if (cancelled) return;
        setStatus("error");
        setError(e instanceof Error ? e.message : "network_error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  const send = useCallback(
    async (
      rid: string,
      action: Record<string, unknown>,
      retried = false,
    ): Promise<HorrorActResult> => {
      // Persist the sequence BEFORE the request: the server accepts it before
      // running the action, so a lost response must not reuse the same number.
      const nextSeq = ++seqRef.current;
      saveSeq(rid, nextSeq);
      try {
        const res = await fetch("/api/horror/act", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runId: rid, seq: nextSeq, action }),
        });
        const data = await res.json();
        if (!res.ok) {
          if (res.status === 409 && data.reason === "replay_detected" && !retried) {
            // The server is ahead of us (e.g. a response was lost). Skip one
            // sequence number and retry exactly once.
            seqRef.current += 1;
            saveSeq(rid, seqRef.current);
            return send(rid, action, true);
          }
          return { ok: false, reason: data.reason ?? "request_failed" };
        }
        if (data.ok === false) {
          // The action was rejected. Keep the previous run state; the caller
          // still receives the reason and the action result.
          const actionResult = data.run?.actionResult;
          return {
            ok: false,
            reason: actionResult?.reason ?? data.reason ?? "action_failed",
            actionResult,
          };
        }
        if (data.run) {
          setRun(data.run as HorrorRunView);
        }
        return { ok: true, run: data.run, actionResult: data.run?.actionResult };
      } catch (e) {
        return { ok: false, reason: e instanceof Error ? e.message : "network_error" };
      }
    },
    [],
  );

  const act = useCallback(
    (action: Record<string, unknown>): Promise<HorrorActResult> => {
      const rid = runIdRef.current;
      if (!rid) return Promise.resolve({ ok: false, reason: "no_run" });
      const result = queueRef.current.then(() => send(rid, action));
      // Keep the queue alive even if one action rejects.
      queueRef.current = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
    [send],
  );

  const createRun = useCallback(
    async (difficulty: string, seed?: number): Promise<string | null> => {
      try {
        const res = await fetch("/api/horror/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ difficulty, seed }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          setError(data.reason ?? "create_failed");
          return null;
        }
        const newRun = data.run as HorrorRunView;
        runIdRef.current = newRun.runId;
        setRun(newRun);
        setStatus("in-game");
        seqRef.current = 0;
        saveSeq(newRun.runId, 0);
        return newRun.runId;
      } catch (e) {
        setError(e instanceof Error ? e.message : "network_error");
        return null;
      }
    },
    [],
  );

  return { run, status, error, act, createRun, setRun };
}