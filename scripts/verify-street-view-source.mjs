import assert from "node:assert/strict";
import { streetViewSource } from "../src/lib/streetViewSource.ts";

const mockedSources = {
  DEFAULT: "mock-default-including-unofficial",
  OUTDOOR: "mock-outdoor-official",
};

assert.equal(
  streetViewSource(mockedSources, false),
  mockedSources.OUTDOOR,
  "unchecked coverage must restrict lookup to official outdoor panoramas",
);
assert.equal(
  streetViewSource(mockedSources, true),
  mockedSources.DEFAULT,
  "checked coverage must allow unofficial panoramas",
);

console.log("Street View coverage source checks passed (mocked enums; no Google API calls).");
