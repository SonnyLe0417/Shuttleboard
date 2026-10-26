# Video rally scoring

The uploaded-video analyzer turns TrackNet's shuttle positions into rallies, and the rallies into a badminton match: games to 21, change of ends, and a winner. It was rebuilt against a hand-labelled singles match, `tests/fixtures/singles-match-1.json` (72 rallies, p2 wins 21-18, 21-12, players change ends at 14:22).

## From positions to rallies

`src/lib/tracknet-rallies.ts` uses only direct TrackNet detections (visible, finite, `detected !== false`, `repaired !== true`; older results without those fields count as direct).

- **A rally is fast flight.** It starts with a serve: a burst of at least three fast sightings (0.25 image units/s) within half a second, after at least 4 s without rally flight. It ends at the first rest that starts within 1.5 s of the last movement, or when the shuttle has not flown for 2.5 s.
- **Dead time is never a landing.** Between rallies the shuttle lies on the floor for 7-30 s, is picked up, carried, sometimes flicked across the net, and held for the serve. None of that starts or ends a rally. A pickup or flick never moves the clock that decides what counts as a serve.
- **A rest** is at least 0.8 s in which the shuttle stays within about three cells of TrackNetV3's 512x288 grid of where it stopped. One-cell flicker and a lone stray detection are ignored. Only a dropped frame or two is bridged; time the shuttle was not seen does not count as rest.
- **A landing nobody saw** (the camera loses it, or a player blocks it) is still offered for review once the next rally is served. A disappearance with no following serve proposes nothing.

Each rally records what was seen, not who won: the landing time, the end it fell on (`near` is the bottom of the picture), the in/out call against the singles or doubles lines with no slack, and which end served it.

**Which end served** is read from the shuttle held still before the serve. A server stands behind their short service line, and a shuttle held above the floor only ever projects further from the camera than it really is. So a hold that projects short of the far service line is the far server's, and one at least 40% of the way in from the far back line is the near server's. Without a visible hold only the launch point is left, which needs a clearer margin.

## From rallies to a match

`src/lib/video-match.ts` derives everything from the rally list on every change, so confirming or correcting one rally re-scores everything after it.

- **Landing rule.** A shuttle that lands in court, or a net fault that drops on the hitter's own side, loses the rally for the player at that end. An out shot lands beyond the winner's lines, so the player at that end wins. In singles the doubles alley is out.
- **Ends.** Players start where the reviewer says (player 1 at the near end by default) and change ends after each game and when the leader first reaches 11 in the deciding game (8 of 15, 6 of 11). Reviewers can instead mark the times the players changed ends; marks take precedence over the score.
- **Next serve.** The winner of a rally serves the next one. When the next serve's end and the landing agree, a line or net call is settled; when they disagree, the rally goes to review. For an unseen landing the next serve is the suggested winner. At a game point both readings can fit (the far player won and the ends changed, or the near player won), and then the serve decides nothing.
- **Games** follow the best reading of every rally with evidence, including suggestions, so one rally waiting for review does not delay the change of ends and hand the rallies after it to the wrong players. The confirmed tally per game counts reviewed or clean rallies only, and the page says how many rallies are still suggestions.

## Review

A landing goes to review when it is within 15 cm of a boundary line, within 0.6 m of the net, more than 2 m outside the court, not seen coming down, at the edge of the picture, short on evidence, or low in confidence. The first four are doubts about the call that a matching next serve settles; the others stay with the reviewer.

In the results list, **Confirm rally** counts the rally with the winner shown and pins that winner. **Keep for review** takes it out of the score and out of the reading of ends. Choosing **P1/P2** pins a winner. **Mark IN/OUT** lets the in/out rule decide again, which hands the rally to the other player at the same spot. A shot label is only a label.

Saved reviews carry a scoring version; reviews saved under older rules are dropped rather than shown with their old winners.

## Checking against a labelled video

`tests/video-match.test.mjs` turns the annotation into a TrackNet-style trace (`tests/fixtures/annotation-trace.mjs`: serves from the right end and service court, shuttle flights that slow and drop steeply, the 512x288 grid, floor rests with occlusions, pickups and held serves, unseen landings, the change of ends) and runs it through the production builder. All 72 rallies are found once with the right winner, the match is 18-21, 12-21 to p2, and only the 9 rallies whose landing the annotator could not see are left for review.

That is a simulation, not the real video. To measure the real thing, run TrackNet on the match, then:

```bash
node --import ./scripts/register-typescript.mjs scripts/evaluate-annotated-match.mjs --annotation tests/fixtures/singles-match-1.json --coordinates path/to/tracknet-result.json --corners path/to/court-calibration.json
```

- `--coordinates` is the TrackNet job result (`{ "coordinates": [...] }`, as served by `GET /jobs/{id}/result`) or a bare array of rows.
- `--corners` is the calibration the video page saves in the browser (`localStorage["shuttleboard.tracknet-court"]`, `{ corners, homography }`) or an array of the four normalized outer corners: near-left, near-right, far-right, far-left.
- `--marked-ends` uses the annotated side changes, `--offset <s>` shifts a trimmed clip, `--report <file>` writes the full result, and `--min-recall` / `--min-winner-accuracy` exit non-zero below a threshold. `--simulate` runs on the generated trace instead.

It lists every annotated rally the app missed, ended twice, or gave to the wrong player, then the totals and the games next to the annotation's.

## The annotation

`tests/annotated-match.test.mjs` pins the fixture: strict times, one gap in the student's list (the 22:32 rally serves next at 22:54, but the next listed rally starts at 23:06, and game 2 cannot finish without it), and the replay to 18-21, 12-21. That rally is recorded under `unannotatedRallies` with only what is known: its window and that p2 won it. `reviewNotes` lists the descriptions that contradict their winners. Re-watch 22:54-23:06 and the 18:38 rally to confirm them.

## Known limits

The thresholds come from the student's earlier tuning, BWF court geometry and the simulation; they have not yet been measured on the real video. A player knocking the shuttle back to the server more than 4 s after a rally can look like a short rally of its own. A net-hung shuttle projects past the net. The browser motion detector cannot see a shuttle at rest, so its landings are review items at the last place it was seen.
