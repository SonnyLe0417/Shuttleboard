import assert from "node:assert/strict";
export async function runOfflineDatabaseChecks(sql) {
  const owner = "10000000-0000-4000-8000-000000000001",
    other = "10000000-0000-4000-8000-000000000002",
    id = "10000000-0000-4000-8000-000000000040";
  const asUser = (user, query) =>
    `SET ROLE authenticated; SET request.jwt.claim.sub='${user}'; ${query}`;
  const insert = `INSERT INTO public.matches(id,creator_id,mode,format,points_to_win,best_of,team_a_names,team_b_names,team_a_user_ids,status,winner,started_at,finished_at,games)
    VALUES('${id}','${owner}','singles','Golden Point',21,1,ARRAY['Fake A'],ARRAY['Fake B'],ARRAY['${owner}']::uuid[],'finished','A','2026-01-01T10:00:00Z','2026-01-01T10:10:00Z','[{"a":21,"b":10}]');`;
  const results = await Promise.allSettled([
    sql(asUser(owner, insert)),
    sql(asUser(owner, insert)),
  ]);
  assert.equal(
    results.filter((row) => row.status === "fulfilled").length,
    1,
    "concurrent inserts have exactly one winner",
  );
  assert.equal(
    await sql(
      asUser(
        owner,
        `SELECT count(*) FROM public.matches WHERE id='${id}' AND creator_id='${owner}';`,
      ),
    ),
    "1",
  );
  assert.equal(
    await sql(
      asUser(
        other,
        `SELECT count(*) FROM public.matches WHERE id='${id}' AND creator_id='${other}';`,
      ),
    ),
    "0",
    "a different account cannot recover the receipt",
  );
  await assert.rejects(sql(asUser(other, insert)), /row-level security|duplicate key/i);
  assert.equal(
    await sql(`SELECT games::text FROM public.matches WHERE id='${id}';`),
    '[{"a": 21, "b": 10}]',
  );
  assert.equal(
    await sql(
      `SELECT extract(epoch FROM (finished_at-started_at))::integer FROM public.matches WHERE id='${id}';`,
    ),
    "600",
  );
  const reward = `SET ROLE service_role; SELECT public.award_player_rewards('${owner}','[{"event_key":"offline-match:${id}","kind":"match","xp":10}]');`;
  await Promise.all([sql(reward), sql(reward)]);
  assert.equal(
    await sql(
      `SELECT count(*) FROM public.reward_events WHERE user_id='${owner}' AND event_key='offline-match:${id}';`,
    ),
    "1",
    "retries award one reward event",
  );
  assert.equal(
    await sql(
      `SELECT xp FROM public.reward_events WHERE user_id='${owner}' AND event_key='offline-match:${id}';`,
    ),
    "10",
  );
}
