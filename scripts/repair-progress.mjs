import { supabaseAdmin } from "../src/integrations/supabase/client.server.ts";
import { syncPlayerProgress } from "../src/lib/progress.server.ts";

const users = new Set();
for (let offset = 0; ; offset += 500) {
  const { data, error } = await supabaseAdmin
    .from("matches")
    .select("creator_id,team_a_user_ids,team_b_user_ids")
    .neq("status", "abandoned")
    .in("winner", ["A", "B"])
    .order("id")
    .range(offset, offset + 499);
  if (error) throw new Error(error.message);
  for (const match of data)
    for (const id of [match.creator_id, ...match.team_a_user_ids, ...match.team_b_user_ids])
      if (id) users.add(id);
  if (data.length < 500) break;
}
console.log(`Found ${users.size} players with completed matches.`);
if (process.argv.includes("--apply")) {
  let completed = 0;
  for (const id of users) {
    await syncPlayerProgress(id);
    console.log(`Synchronized ${++completed}/${users.size} players.`);
  }
} else
  console.log(
    "Read-only preview. Pass --apply to rebuild derived progress; repeat runs don't duplicate XP.",
  );
