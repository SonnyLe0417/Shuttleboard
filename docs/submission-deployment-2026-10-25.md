# Submission release status — October 25, 2026

The user authorized merging and publishing the current application. GitHub main
was fast-forwarded to the tested `6491a33` release and pushed successfully. The
outdated Lovable project was inspected only and was not published.

The app's existing Supabase project received the exact tested
`secure_ai_and_invitation_transactions` migration. The server assigned UTC version
`20261026013152`; the local migration was renamed from `20261025183506` to match,
with identical SQL bytes. Historical review manifests retain the original local
filename as provenance. Do not apply both names as separate migrations.

Post-migration permission checks passed: quota/invitation RPCs exist; anonymous
and ordinary authenticated users cannot call quota admission; service role can
call both server operations; direct authenticated invitation UPDATE is denied.
Existing account/match rows, VAPID keys, subscriptions and protected delivery cron
were not changed. Only that protected delivery cron currently exists; no new
reminder/summary/inactivity schedules were invented.

Cloudflare Workers is the selected first-hosting path for the existing Worker
build. Wrangler 4.152.0 was checked; an initial browser OAuth attempt timed out,
then authorization succeeded after the user signed in. The refreshed production
build, encrypted-secret deployment dry run and seven route/bundle checks passed.
The first upload was rejected because the generic template subdomain
`tanstack-start-ts` was unavailable. The package name was changed to the unique
`shuttleboard-sonnyle0417` (including lockfile metadata; dependencies unchanged),
then deployment succeeded with 83 assets and 123 Worker modules.

Live URL: https://shuttleboard.shuttleboard-sonnyle0417.workers.dev

Cloudflare version: `c4fd4370-1b49-46fb-8450-ea5085db1ac2`.
Server configuration was uploaded through the approved encrypted-secret option.
The first HTTPS checks hit a TLS handshake failure while the new workers.dev
subdomain was provisioning; passing live application checks are still pending.

The user approved reusing the existing OpenAI key. Uploading the broader local
credential set was rejected by automatic approval review; those credentials were
not uploaded. The user subsequently explicitly approved encrypted Supabase
server setup. The deployment helper accepts only those known app configuration
keys, sends the ignored file directly to Wrangler's encrypted-secret option,
and refuses unexpected keys.
No secret values are stored in this document or source control.

The application does not reference the legacy 31.6 MB public sample as an asset
URL. `public/.assetsignore` retains that original locally while excluding it from
Cloudflare's 25 MiB asset limit. Generated video result downloads are unaffected.
Saved comparison builds remain unchanged.

After deployment, verify the live homepage, scoring, auth guard, static assets,
offline manifest and unauthenticated API rejection without paid provider calls.
Google OAuth needs the final origin in Supabase's redirect allowlist. TrackNet's
Python inference remains local unless separately hosted; deploying the web Worker
does not move PyTorch/OpenVINO inference to Cloudflare.
