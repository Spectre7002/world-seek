import test from "node:test";
import assert from "node:assert/strict";
import { computeScore, formatDistance, haversineKm } from "../src/shared/scoring";
import { DEFAULT_SETTINGS } from "../src/shared/types";

test("haversineKm is zero for identical points", () => {
  assert.equal(haversineKm({ lat: 10, lng: 20 }, { lat: 10, lng: 20 }), 0);
});

test("haversineKm matches a known great-circle distance", () => {
  // London -> Paris is ~344 km.
  const km = haversineKm({ lat: 51.5074, lng: -0.1278 }, { lat: 48.8566, lng: 2.3522 });
  assert.ok(km > 330 && km < 360, `expected ~344 km, got ${km}`);
});

test("computeScore awards maxPoints for a perfect guess", () => {
  assert.equal(computeScore(0, DEFAULT_SETTINGS), DEFAULT_SETTINGS.maxPoints);
});

test("computeScore decays monotonically with distance", () => {
  const settings = { ...DEFAULT_SETTINGS, maxPoints: 5000, scoreScaleKm: 2000 };
  let previous = computeScore(0, settings);
  for (const km of [100, 500, 1000, 3000, 8000]) {
    const next = computeScore(km, settings);
    assert.ok(next <= previous, `score must not rise at ${km} km`);
    assert.ok(next >= 0);
    previous = next;
  }
});

test("formatDistance switches units at the documented thresholds", () => {
  assert.equal(formatDistance(0.5), "500 m");
  assert.equal(formatDistance(42.4), "42.4 km");
  assert.match(formatDistance(1234.5), /km$/);
});
