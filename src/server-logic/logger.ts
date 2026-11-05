type Level = "info" | "warn" | "error";
type Fields = Record<string, unknown>;

/**
 * Structured logging: one JSON object per line.
 *
 * JSON lines let a log shipper parse fields without a regex per message and
 * keep the level/payload machine-readable. `console` is still the sink so the
 * default behaviour is unchanged in dev.
 */
function emit(level: Level, msg: string, fields?: Fields): void {
  const entry = { ts: new Date().toISOString(), level: level, msg: msg, ...fields };
  const sink = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  sink(JSON.stringify(entry));
}

export const log = {
  info(msg: string, fields?: Fields): void {
    emit("info", msg, fields);
  },
  warn(msg: string, fields?: Fields): void {
    emit("warn", msg, fields);
  },
  error(msg: string, fields?: Fields): void {
    emit("error", msg, fields);
  },
};

export type ErrorReporter = (error: unknown, context?: Fields) => void;

let reporter: ErrorReporter | null = null;

/**
 * Install an external error reporter (Sentry, an HTTP collector, ...). The hook
 * is optional and failure-tolerant: a throwing reporter must never take down
 * the process that was already handling an error.
 */
export function setErrorReporter(fn: ErrorReporter | null): void {
  reporter = fn;
}

/** Log an unexpected error structurally and forward it to the reporter hook. */
export function reportError(error: unknown, context?: Fields): void {
  log.error("unhandled_error", {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    ...context,
  });
  if (reporter) {
    try {
      reporter(error, context);
    } catch {
      // A broken reporter must not mask the original error.
    }
  }
}
