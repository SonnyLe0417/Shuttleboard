# Main app validation — October 19, 2026

The user approved the design for production integration. These checks refer to
actual app routes on http://127.0.0.1:4174/, unless marked as historical.

## Completed checks

- Unit suite: 104 passing tests, including deuce/cap scoring and theme migration.
- Final typecheck and production client/server build passed. Lint passed with
  zero errors and three existing React Fast Refresh warnings.
- Main entry JavaScript: 192,272 bytes in the final build,
  compared with 194,301 bytes before the redesign. This compares the entry
  file only, not all route chunks or measured loading time.
- Production landing visually reviewed on desktop; no horizontal document overflow
  at 360, 390, 768, 1024 and 1440 px.
- Interactive example continues at 20–21 with both point buttons enabled; 20–22
  ends the game. The existing shared rules enforce the 30-point cap.
- Actual scoreboard point control advanced 0–0 to 1–0; phone layout displayed both
  score controls. Subsequent scoring checks reached the enforced anonymous trial
  limit and correctly offered account creation. No quota bypass was added.
- Mobile More dialog opens, exposes secondary destinations, closes on navigation,
  and Rules is reachable. Analyze while signed out redirects to authentication.
- Direct /video navigation previously reproduced React hydration error #418. With
  the client-only outlet boundary for session-dependent routes, a fresh direct
  navigation rendered sign-in and recorded no browser console errors.
- Public pages retain server rendering. Account guards and server authorization
  remain unchanged.

## Remaining verification before release

The local browser is still signed out. Real-account dashboard data, match save,
profile/community actions and video upload/calibration/cancel/retry/review need
end-to-end checks after sign-in. Do not interpret source integration or the unit
suite as proof of a live TrackNet inference run. Browser and both TrackNet engine
controls remain wired to their existing implementation.

The latest scoring court layout, authenticated responsive views, full-screen
landscape scoring, OS high contrast/reduced motion and keyboard appearance need
complete device checks. Saved theme and accessibility values have unit coverage;
full assistive-technology testing remains outstanding.

The earlier phase-1 screenshots in screenshots/ show the approved fixture-based
reference. Files prefixed main- capture the integrated app. The standalone design
reference remains available for historical comparison and is not the main app.

No release, push, database migration or paid asset purchase was performed.
