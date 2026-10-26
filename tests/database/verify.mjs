import assert from "node:assert/strict";
import { runOfflineDatabaseChecks } from "./offline-checks.mjs";
const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const user = id(1),
  guest = id(2),
  other = id(3),
  match = id(10),
  invite = id(20);
const service = (query) => `SET ROLE service_role; ${query}`;
const auth = (actor, query) =>
  `SET ROLE authenticated; SET request.jwt.claim.sub='${actor}'; ${query}`;
const rpc = (actor = guest, key = invite, accept = true) =>
  `SELECT public.respond_to_match_invite('${actor}','${key}',NULL,${accept});`;
const reservation = () => `SELECT public.reserve_ai_vision('${user}',60,1000,10000);`;
export async function runDatabaseChecks(sql) {
  const json = async (query) => JSON.parse((await sql(query)).split("\n").at(-1));
  await sql(
    `INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES ${[1, 2, 3].map((n) => `('${id(n)}','fake-${n}@example.test','{"handle":"bugfix${n}"}')`).join(",")};`,
  );
  await sql(`INSERT INTO public.matches(id,creator_id,mode,format,points_to_win,team_a_names,team_b_names,team_a_user_ids)
    VALUES('${match}','${user}','singles','21',21,ARRAY['Fake owner'],ARRAY['Fake guest'],ARRAY['${user}']::uuid[]);
    INSERT INTO public.match_invites(id,match_id,sender_id,recipient_id,team_side) VALUES('${invite}','${match}','${user}','${guest}','B');`);
  // Exercise actual roles/policies rather than service-role-only simulations.
  await assert.rejects(sql(auth(guest, rpc())), /permission denied/i);
  await assert.rejects(
    sql(auth(guest, `UPDATE public.match_invites SET status='accepted' WHERE id='${invite}';`)),
    /permission denied/i,
  );
  await assert.rejects(
    sql(
      auth(
        guest,
        `INSERT INTO public.match_invites(match_id,sender_id,recipient_id,team_side) VALUES('${match}','${guest}','${other}','B');`,
      ),
    ),
    /row-level security/i,
  );
  await assert.rejects(sql(`SET ROLE anon; ${reservation()}`), /permission denied/i);
  await assert.rejects(sql(auth(user, reservation())), /permission denied/i);
  await assert.rejects(
    sql(auth(user, "SELECT * FROM app_private.ai_vision_users;")),
    /permission denied/i,
  );
  assert.equal(
    await sql(auth(guest, `SELECT count(*) FROM public.matches WHERE id='${match}';`)),
    "0",
  );
  assert.equal((await json(service(rpc()))).ok, true);
  assert.equal((await json(service(rpc()))).ok, true, "same actor retry is idempotent");
  assert.equal(
    await sql(auth(guest, `SELECT count(*) FROM public.matches WHERE id='${match}';`)),
    "1",
  );
  await assert.rejects(sql(service(rpc(other))), /not addressed/i);
  await sql(
    `UPDATE public.matches SET team_b_user_ids='{}' WHERE id='${match}'; UPDATE public.match_invites SET recipient_id=NULL,status='pending',token_hash=repeat('a',64),accepted_at=NULL WHERE id='${invite}';`,
  );
  const claim = (actor) =>
    service(`SELECT public.respond_to_match_invite('${actor}',NULL,repeat('a',64),true);`);
  const claims = await Promise.allSettled([sql(claim(guest)), sql(claim(other))]);
  assert.equal(
    claims.filter((r) => r.status === "fulfilled").length,
    1,
    "single-use concurrent claims have one winner",
  );
  assert.equal(
    await sql(`SELECT cardinality(team_b_user_ids) FROM public.matches WHERE id='${match}';`),
    "1",
  );
  // Inject an invite write failure after the match UPDATE, then check complete rollback.
  await sql(`UPDATE public.matches SET team_b_user_ids='{}' WHERE id='${match}'; UPDATE public.match_invites SET recipient_id='${guest}',status='pending',accepted_at=NULL WHERE id='${invite}';
    CREATE FUNCTION public.bugfix_fail_invite() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced invite write failure'; END $$;
    CREATE TRIGGER bugfix_fail_invite BEFORE UPDATE ON public.match_invites FOR EACH ROW EXECUTE FUNCTION public.bugfix_fail_invite();`);
  await assert.rejects(sql(service(rpc())), /forced invite write failure/);
  assert.equal(
    await sql(`SELECT cardinality(team_b_user_ids) FROM public.matches WHERE id='${match}';`),
    "0",
  );
  assert.equal(
    await sql(`SELECT status FROM public.match_invites WHERE id='${invite}';`),
    "pending",
  );
  await sql(
    "DROP TRIGGER bugfix_fail_invite ON public.match_invites; DROP FUNCTION public.bugfix_fail_invite();",
  );
  await sql(
    `UPDATE public.match_invites SET expires_at=now()-interval '1 second' WHERE id='${invite}';`,
  );
  await assert.rejects(sql(service(rpc())), /no longer available/);
  await sql(
    `UPDATE public.match_invites SET expires_at=now()+interval '1 day' WHERE id='${invite}';`,
  );
  await assert.rejects(sql(service(rpc(user))), /not addressed/);
  await sql(`UPDATE public.match_invites SET recipient_id='${user}' WHERE id='${invite}';`);
  await assert.rejects(sql(service(rpc(user))), /other team/);
  await sql(
    `UPDATE public.match_invites SET recipient_id='${guest}' WHERE id='${invite}'; UPDATE public.matches SET team_b_user_ids=ARRAY['${other}']::uuid[] WHERE id='${match}';`,
  );
  await assert.rejects(sql(service(rpc())), /team is full/);
  await sql(`UPDATE public.matches SET mode='doubles' WHERE id='${match}';`);
  assert.equal((await json(service(rpc()))).ok, true);
  await sql(
    `UPDATE public.match_invites SET status='pending',accepted_at=NULL WHERE id='${invite}';`,
  );
  assert.equal((await json(service(rpc(guest, invite, false)))).accepted, false);
  assert.equal((await json(service(rpc(guest, invite, false)))).accepted, false);
  // Separate psql processes model independent server instances.
  const admissions = await Promise.all(
    Array.from({ length: 5 }, () => json(service(reservation()))),
  );
  assert.equal(admissions.filter((r) => r.allowed).length, 1);
  assert.ok(admissions.filter((r) => !r.allowed).every((r) => r.code === "request_in_progress"));
  const lease = admissions.find((r) => r.allowed).lease_id;
  await sql(service(`SELECT public.release_ai_vision('${user}','${id(999)}');`));
  assert.equal(
    (await json(service(reservation()))).code,
    "request_in_progress",
    "stale lease cannot release current request",
  );
  await sql(service(`SELECT public.release_ai_vision('${user}','${lease}');`));
  // Put the exact boundary checks in one transaction so wall-clock minute rollover
  // cannot make this a flaky 60-process timing test.
  const minuteBoundary = (
    await sql(`BEGIN; UPDATE app_private.ai_vision_users
    SET minute=date_trunc('minute',now()),minute_used=59 WHERE user_id='${user}';
    SET LOCAL ROLE service_role; ${reservation()} ${reservation()} COMMIT;`)
  )
    .split("\n")
    .map(JSON.parse);
  assert.equal(minuteBoundary[0].allowed, true);
  assert.equal(minuteBoundary[1].code, "minute_limit");
  await sql(
    `UPDATE app_private.ai_vision_users SET minute=now()-interval '2 minutes',day_used=1000 WHERE user_id='${user}';`,
  );
  assert.equal((await json(service(reservation()))).code, "day_limit");
  assert.equal(
    (await json(service(`SELECT public.reserve_ai_vision('${other}',60,1000,10000);`))).allowed,
    true,
    "account daily limits are independent",
  );
  await sql(
    `UPDATE app_private.ai_vision_days SET used=10000 WHERE day=(now() AT TIME ZONE 'UTC')::date;`,
  );
  assert.equal(
    (await json(service(`SELECT public.reserve_ai_vision('${guest}',60,1000,10000);`))).code,
    "global_limit",
  );
  await sql(
    `UPDATE app_private.ai_vision_days SET used=0; UPDATE app_private.ai_vision_users SET day=(now() AT TIME ZONE 'UTC')::date-1,minute=now()-interval '2 minutes',lease_until=now()-interval '1 second' WHERE user_id='${user}';`,
  );
  assert.equal(
    (await json(service(reservation()))).allowed,
    true,
    "UTC day/minute reset and abandoned lease expiry permit admission",
  );
  await runOfflineDatabaseChecks(sql);
}
