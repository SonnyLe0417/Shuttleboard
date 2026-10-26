import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("expanded singles annotations remain strict JSON with valid rally ranges", () => {
  const fixture = JSON.parse(readFileSync("tests/fixtures/singles-match-1.json", "utf8"));
  const seconds = (value) =>
    typeof value === "number"
      ? value
      : value
          .split(":")
          .map(Number)
          .reduce((n, v) => n * 60 + v, 0);
  assert.ok(fixture.points.length);
  for (const point of fixture.points) {
    assert.ok(["p1", "p2"].includes(point.winner));
    assert.ok(Number.isFinite(seconds(point.fromSecond)));
    assert.ok(seconds(point.toSecond) >= seconds(point.fromSecond));
  }
});
