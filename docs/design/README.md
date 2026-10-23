# ShuttleBoard modern sports club redesign

The design was approved for the main app. Production routes now use the club
identity and navigation; the old isolated preview is retained only as a design
reference and is not part of normal navigation.

## Run the main app

```sh
npm run build
npm run preview
```

Open http://127.0.0.1:4174/. The local adapter serves the actual Cloudflare-targeted
production build. Restart it after rebuilding. Deployment output is unchanged.

## Integrated design

- Original shuttlecock mark, Manrope, warm white and court green, licensed photos.
- Desktop sidebar and labeled phone bottom navigation, with every existing route.
- Real landing page and interactive scoring example using the app's badminton
  rules: 21 points, win by two, capped at 30, with undo and reset.
- Dashboard with resume/start, analyze, recent matches, goal and retained details.
- Large scoring controls alongside serving information, court and existing tools.
- Video Upload → Set court → Analyze → Review workflow, dark player, fullscreen,
  timeline, review controls and expandable TrackNet configuration.
- Shared typography, forms, cards, borders and focus treatment across history,
  progress, community, rankings, rules, profiles, onboarding, auth and settings.
- Club light defaults for new users; existing themes and accessibility preferences
  retain their storage keys and values.

Existing data hooks, match logic, authentication guards and TrackNet engines remain
in use. No fixture results were moved into account pages. The anonymous match
allowance remains enforced. No backend schema or inference changes are included
in the redesign, and nothing has been pushed or deployed.

See [validation](validation.md) for evidence and outstanding checks, and
[asset credits](asset-licenses.md) for photo licenses.

## Brand files

- [Light wordmark](../../src/assets/club/shuttleboard-logo-light.svg)
- [Dark wordmark](../../src/assets/club/shuttleboard-logo-dark.svg)
- [App icon](../../public/shuttleboard-icon.svg)

The earlier reference can still be built with `npm run design:build`; its data
is explicitly labeled as examples. It is not the app entry point.
