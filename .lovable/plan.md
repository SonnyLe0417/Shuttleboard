## Why the circle zig-zags

The local tracker in `src/routes/ai.tsx` picks the "best" motion blob every frame independently. When multiple things move (arms, racquet, background), the winning blob flips between them, and the circle teleports each frame. The current smoothing (`alpha = 0.72`) barely blends because it still snaps ~72% toward each new candidate, and the trail line then draws sharp zig-zags between those jumps.

## Plan

1. **Lock onto the tracked birdie between frames**
   - Strongly bias blob selection toward the predicted position: reject candidates farther than a velocity-scaled radius unless their score is dramatically higher.
   - Penalize (not reward) large distance from the prediction so a random far blob can't win.

2. **Smoother position updates**
   - Lower the blend factor (e.g. `alpha ~0.35`, higher when the birdie is moving fast) so each new detection nudges the circle instead of snapping to it.
   - Smooth velocity with exponential averaging instead of raw frame-to-frame delta, so prediction stops whipping around.
   - Clamp per-frame movement to a plausible max (birdies don't teleport across the frame in 16ms).

3. **Reject noisy detections**
   - Require a couple of consecutive consistent detections before "acquiring" a new track when there is no prior.
   - Ignore blobs whose motion direction reverses sharply vs. current velocity unless confidence is very high.
   - Raise the minimum motion threshold slightly and the minimum blob area so single-pixel noise stops registering.

4. **Cleaner trail rendering**
   - Drop trail points that jump more than the plausible max distance from the previous point (prevents drawing zig-zag lines across the frame).
   - Optionally render the trail as a smoothed (quadratic) path instead of straight segments between raw samples.

5. **Fade instead of snap on loss**
   - Keep existing coast-on-last-velocity behavior but shorten the coast window and fade opacity so a lost track doesn't reappear far away and yank the circle.

## Technical details

- All changes are in `src/routes/ai.tsx` — the `detectBirdieMotion` function (scoring, alpha, velocity smoothing, max-step clamp, acquisition hysteresis) and the overlay/trail drawing code (jump filtering, smoothed path).
- No changes to `src/routes/api/ai-vision.ts` or backend.
- No new dependencies; pure canvas math.
