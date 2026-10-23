import test from "node:test";
import assert from "node:assert/strict";
import { findPreset, isGameOver, gameWinner } from "../src/lib/badminton-rules.ts";
import { getStoredTheme, getStoredPrefs } from "../src/lib/themes.ts";

test("standard badminton continues at 21–20 and requires two clear points", () => {
  const rules = findPreset("21");
  for (const score of [
    [20, 20],
    [20, 21],
    [21, 20],
    [28, 29],
    [29, 29],
  ]) {
    assert.equal(isGameOver(score, rules), false, score.join("–"));
    assert.equal(gameWinner(score, rules), null);
  }
  for (const score of [
    [21, 19],
    [22, 20],
    [29, 27],
    [30, 29],
  ]) {
    assert.equal(isGameOver(score, rules), true, score.join("–"));
    assert.equal(gameWinner(score, rules), 0);
    assert.equal(gameWinner([score[1], score[0]], rules), 1);
  }
});

test("new users get Club light while saved themes, modes and accessibility choices survive", () => {
  const previous = globalThis.window;
  const values = new Map();
  globalThis.window = { localStorage: { getItem: (key) => values.get(key) ?? null } };
  try {
    assert.equal(getStoredTheme(), "club");
    assert.equal(getStoredPrefs().mode, "light");
    values.set("shuttleboard-theme", "ember");
    assert.equal(getStoredTheme(), "ember");
    assert.equal(getStoredPrefs().mode, "dark");
    values.set("shuttleboard-mode", "light");
    values.set("shuttleboard-accent", "#123456");
    values.set("shuttleboard-text-scale", "xlarge");
    values.set("shuttleboard-high-contrast", "1");
    values.set("shuttleboard-reduced-motion", "1");
    assert.equal(getStoredTheme(), "ember");
    assert.deepEqual(
      Object.fromEntries(
        ["mode", "accent", "textScale", "highContrast", "reducedMotion"].map((key) => [
          key,
          getStoredPrefs()[key],
        ]),
      ),
      {
        mode: "light",
        accent: "#123456",
        textScale: "xlarge",
        highContrast: true,
        reducedMotion: true,
      },
    );
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
});
