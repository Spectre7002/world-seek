export function streetViewSource<T>(
  sources: { DEFAULT: T; OUTDOOR: T },
  allowUnofficialCoverage: boolean,
): T {
  return allowUnofficialCoverage ? sources.DEFAULT : sources.OUTDOOR;
}
