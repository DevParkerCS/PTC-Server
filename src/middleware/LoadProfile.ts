import type { Request, Response, NextFunction } from "express";
import { supabase } from "../supabaseClient";

export async function loadProfile(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const userId = (req as any).user?.id as string | undefined;

  if (!userId) {
    return res.status(400).json({ error: "Missing UserID" });
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select(
      `
        plan_id,
        subscription_status,
        lifetime_generations,
        free_generations,
        current_period_start,
        current_period_end,
        plan:plans (
          id,
          name,
          monthly_generation_limit,
          price_cents
        )
      `
    )
    .eq("user_id", userId)
    .single();

  if (error || !profile) {
    console.log(error);
    return res.status(500).json({ error: "Error getting profile info" });
  }

  // normalize plan here
  const plan = normalizePlan(profile.plan as unknown);

  (req as any).profile = {
    ...profile,
    plan, // now guaranteed to be PlanRow | null, not array
  };

  next();
}

type PlanRow = {
  id: string;
  name: string;
  monthly_generation_limit: number;
  price_cents: number;
};

function normalizePlan(rawPlan: unknown): PlanRow | null {
  if (!rawPlan) return null;

  if (Array.isArray(rawPlan)) {
    return (rawPlan[0] ?? null) as PlanRow | null;
  }

  return rawPlan as PlanRow;
}
