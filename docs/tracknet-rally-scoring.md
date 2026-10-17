# Direct-detection rally scoring

For newly analyzed uploaded videos, a point is proposed only when TrackNet directly sees the shuttle stay nearly still. Disappearance alone no longer proposes a point. InpaintNet's estimated positions still appear in the trail and processed video, but cannot prove a landing. Live-camera tracking continues to use its separate rules.

## How it works

- A direct point must be visible, have finite coordinates, have `detected !== false`, and have `repaired !== true`.
- Older-engine results without those last two fields still treat visible positions as direct detections.
- A rest needs at least 0.8 seconds of direct sightings, with at least 80% of position changes nearly still. Missing or repaired frames split the evidence; a direct-sighting gap over 0.35 seconds also splits it.
- A shuttle held near the service area does not create a point unless it was seen moving down just before stopping. Stops close to the image edge, outside the court, or near a court boundary need review. Nearby repeats are collapsed into one proposal.
- The existing confidence, evidence-length, court-boundary and review checks remain in force. Any point needing review stays out of the score until confirmed.
- The separate live-camera state machine still has its own gap timing; those settings do not control uploaded-video TrackNet scoring.

## Results and manual review

The results screen shows total, direct, repaired and missing frame counts, plus possible endings, confirmed endings and endings needing review. Frame counts describe returned coordinate rows, not a claim that every source-video frame was analyzed. Possible endings include confirmed and reviewable events.

Long results with many direct detections but five or fewer endings show a warning. The app does not describe that small number as the match's full point count. Uncounted winners are labelled suggestions, not confirmed points.

Choose P1 or P2 if needed, then press **Confirm rally**. That rally now contributes exactly one point. Repeated confirmation does not add more points. **Keep for review** removes its point again. The score is calculated from the saved rally list, keeping corrections and totals together. Review choices, job identity and frame diagnostics are saved in the browser tab's session storage; they are not a permanent cloud match record. Reopening the same completed job does not overwrite those choices.

## Related files (including earlier scoring work)

- `src/lib/tracknet-evidence.ts`: shared direct-point checks, frame counts and display trail.
- `src/lib/tracknet-rallies.ts`: extracted and tested TrackNet rally builder.
- `src/lib/rally-end-detector.ts`: live/browser scoring state machine, unchanged by the visible-rest update.
- `src/lib/analysis-results.ts`: score calculation, review confirmation, counts and warning.
- `src/lib/video-analysis-session.ts`: saved job identity and diagnostics.
- `src/routes/_authenticated/video.tsx`: connects direct scoring, display data and saved review state.
- `src/components/video/AnalysisResultsPanel.tsx`: diagnostics and clearer result labels.
- `tests/tracknet-rallies.test.mjs` and `tests/analysis-results.test.mjs`: scoring, gap, legacy, display and persistence tests.
- `scripts/test_tracknet_v3.py` and `tests/test_tracknet_v3_service.py`: regression checks that repaired positions retain their flags, zero confidence and video/API output.
- This document.

The Python runtime already kept the required detection labels and repaired video markers. It did not need a production-code change for this request. The existing TrackNet client format, service API and fallback engine remain available.

## Verification

- `npm test`: 86 passed after the visible-rest update.
- `node node_modules/typescript/bin/tsc --noEmit --pretty false`: passed.
- `npm run build`: passed.
- Python model checks were recorded before this scoring-only update. They could not be rerun because the local Python 3.11 installation referenced by the virtual environment is missing.
- Browser skill check using the real results component with isolated sample data: confirmed 0-0 becomes 0-1, repeated confirmation remains 0-1, and returning to review gives 0-0. This is a component interaction check, not a full authenticated-app video analysis.

## Remaining limits

The complete match has not been reanalyzed for this change. There is no measured claim that it now finds all match points. A real point may be missed when the shuttle is not directly visible for a long enough stop. Court calibration, camera motion, false detections and missed shuttles can still affect results. This change does not add serve recognition, reliable last-hitter detection, or three-set score reconstruction.

Reload the app to use the new confirmation behavior. Existing saved rallies are preserved, not silently rebuilt. Run a fresh video analysis to generate endings with the new rules.

No commit, push or publication was performed.
