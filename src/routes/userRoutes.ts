import express from "express";
import { supabase } from "../supabaseClient";
import { requireAuth } from "../middleware/AuthMiddleware";
import { loadProfile } from "../middleware/LoadProfile";

const router = express.Router();

router.get("/profile", requireAuth, loadProfile, async (req, res) => {
  const userId: string = (req as any).user?.id;
  const profile = (req as any).profile;

  if (!userId) {
    return res.status(400).json({ error: "Missing UserID" });
  }

  try {
    let generations_used_this_period = 0;
    let generations_remaining_this_period = null;

    // 2) If not on free plan, fetch this period's usage
    if (profile.plan_id !== "free" && profile.plan) {
      const nowIso = new Date().toISOString();

      const { data: usage, error: usageError } = await supabase
        .from("usage_limits")
        .select("generations_used, period_start, period_end")
        .eq("user_id", userId)
        .lte("period_start", nowIso)
        .gte("period_end", nowIso)
        .maybeSingle();

      if (usageError) {
        console.log("usage error", usageError);
        // you can choose to still return profile without usage
      }

      if (usage) {
        generations_used_this_period = usage.generations_used;
      }

      const limit = profile.plan.monthly_generation_limit ?? 0;
      generations_remaining_this_period = Math.max(
        0,
        limit - generations_used_this_period
      );
    } else if (profile.plan) {
      generations_remaining_this_period =
        profile.plan.monthly_generation_limit - profile.lifetime_generations;
    }

    return res.status(200).json({
      ...profile,
      generations_used_this_period,
      generations_remaining_this_period,
    });
  } catch (e) {
    console.log(e);
    return res.status(500).json({ error: "Error getting profile info" });
  }
});

export default router;
