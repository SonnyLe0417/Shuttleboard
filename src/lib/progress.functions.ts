import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const reflectionInput = z.object({
  match_id: z.string().uuid(),
  went_well: z.string().max(1000).default(""),
  difficult: z.string().max(1000).default(""),
  next_focus: z.string().max(1000).default(""),
  confidence_before: z.number().int().min(1).max(5).nullable().optional(),
  confidence_after: z.number().int().min(1).max(5).nullable().optional(),
});

const memoryInput = z.object({
  opponent_id: z.string().uuid().nullable().optional(),
  opponent_key: z.string().min(1).max(120),
  opponent_name: z.string().min(1).max(120),
  worked: z.string().max(1000).default(""),
  difficult: z.string().max(1000).default(""),
  tendencies: z.string().max(1000).default(""),
  next_plan: z.string().max(1000).default(""),
});

const progressSettingsInput = z.object({
  quest_cadence: z.enum(["weekly", "monthly"]).optional(),
  streaks_enabled: z.boolean().optional(),
  celebration_enabled: z.boolean().optional(),
});

export const getProgressSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { readProgressSummary } = await import("@/lib/progress.server");
    return readProgressSummary(context.supabase, context.userId);
  });
export const refreshMyProgress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { syncPlayerProgress } = await import("@/lib/progress.server");
    await syncPlayerProgress(context.userId);
    return { ok: true };
  });
export const saveMatchReflection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((raw: unknown) => reflectionInput.parse(raw))
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const { data: match, error: matchError } = await db
      .from("matches")
      .select("id,winner,status")
      .eq("id", data.match_id)
      .single();
    if (matchError || !match || match.status === "abandoned" || !match.winner)
      throw new Error("Choose one of your completed matches.");
    if (![data.went_well, data.difficult, data.next_focus].some((value) => value.trim()))
      throw new Error("Add at least one reflection before saving.");
    const { data: reflection, error } = await db
      .from("match_reflections")
      .upsert({ user_id: context.userId, ...data }, { onConflict: "user_id,match_id" })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    const { syncPlayerProgress } = await import("@/lib/progress.server");
    await syncPlayerProgress(context.userId);
    return reflection;
  });

export const saveOpponentMemory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((raw: unknown) => memoryInput.parse(raw))
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    if (
      ![data.worked, data.difficult, data.tendencies, data.next_plan].some((value) => value.trim())
    )
      throw new Error("Add a strategy note before saving.");
    const { data: memory, error } = await db
      .from("opponent_memories")
      .upsert({ user_id: context.userId, ...data }, { onConflict: "user_id,opponent_key" })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    const { syncPlayerProgress } = await import("@/lib/progress.server");
    await syncPlayerProgress(context.userId);
    return memory;
  });

export const updateProgressSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((raw: unknown) => progressSettingsInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { error } = await db.from("player_progress").upsert({ user_id: context.userId, ...data });
    if (error) throw new Error(error.message);
    const { syncPlayerProgress } = await import("@/lib/progress.server");
    await syncPlayerProgress(context.userId);
    return { ok: true };
  });
