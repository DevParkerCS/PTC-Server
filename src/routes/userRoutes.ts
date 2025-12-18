import express from "express";
import { supabase } from "../supabaseClient";
import { requireAuth } from "../middleware/AuthMiddleware";
import { loadProfile } from "../middleware/LoadProfile";
import rateLimit from "express-rate-limit";
import { Resend } from "resend";
import { stripe } from "../Stripe/Stripe";

export const contactLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 4,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "TOO_MANY_REQUESTS" },
});

const router = express.Router();
const resend = new Resend(process.env.RESEND_API_KEY);

router.get("/profile", requireAuth, loadProfile, async (req, res) => {
  const userId: string = (req as any).user?.id;
  const profile = (req as any).profile;

  if (!userId) {
    return res.status(400).json({ error: "Missing UserID" });
  }

  try {
    let generations_used_this_period = 0;
    let generations_remaining_this_period: number | null = null;

    // Paid plans: use the exact period stored on the profile (Stripe-authoritative)
    if (profile.plan_id !== "free" && profile.plan) {
      const periodStart = profile.current_period_start ?? null;
      const periodEnd = profile.current_period_end ?? null;

      if (periodStart && periodEnd) {
        const { data: usage, error: usageError } = await supabase
          .from("usage_limits")
          .select("generations_used, period_start, period_end")
          .eq("user_id", userId)
          .eq("period_start", periodStart)
          .eq("period_end", periodEnd)
          .maybeSingle();

        if (usageError) {
          console.log("usage error", usageError);
          // still return profile without usage
        }

        if (usage) {
          generations_used_this_period = usage.generations_used ?? 0;
        }
      }

      const limit = profile.plan.monthly_generation_limit ?? 0;
      generations_remaining_this_period = Math.max(
        0,
        limit - generations_used_this_period
      );
    } else if (profile.plan) {
      // Free plan (your existing logic)
      generations_remaining_this_period =
        (profile.plan.monthly_generation_limit ?? 0) -
        (profile.free_generations ?? 0);
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

router.post("/contact", contactLimiter, async (req, res) => {
  try {
    const { email, subject, message, hp } = req.body ?? {};

    if (hp) return res.status(200).json({ ok: true });

    if (!email || !subject || !message) {
      return res.status(400).json({ error: "MISSING_FIELDS" });
    }

    if (
      typeof email !== "string" ||
      typeof subject !== "string" ||
      typeof message !== "string"
    ) {
      return res.status(400).json({ error: "INVALID_FIELDS" });
    }

    if (subject.length > 120 || message.length > 4000) {
      return res.status(400).json({ error: "TOO_LONG" });
    }

    const { data, error } = await resend.emails.send({
      from: "support@passthatclass.com",
      to: "support@passthatclass.com",
      replyTo: email,
      subject: `[PTC Contact] ${subject}`,
      text: `From: ${email}\nIP: ${req.ip}\n\n${message}`,
    });

    console.log(data);
    console.log(error);

    return res.json({ ok: true });
  } catch (err) {
    console.log(err);
    return res.status(500).json({ error: "FAILED_TO_SEND" });
  }
});

router.delete("/account", requireAuth, loadProfile, async (req, res) => {
  const userId = (req as any).user.id;
  const profile = (req as any).profile;

  const stripeCustomerId = profile.stripe_customer_id;
  const stripeSubId = profile.stripe_subscription_id;

  try {
    // 1) Cancel subscription (stop billing)
    if (stripeSubId) {
      await stripe.subscriptions.cancel(stripeSubId); // immediate cancel
    }

    // 2) Detach all saved card payment methods
    if (stripeCustomerId) {
      const pms = await stripe.paymentMethods.list({
        customer: stripeCustomerId,
        type: "card",
      });

      await Promise.all(
        pms.data.map((pm) => stripe.paymentMethods.detach(pm.id))
      );

      // 3) Clear default
      await stripe.customers.update(stripeCustomerId, {
        invoice_settings: { default_payment_method: undefined },
      });
    }

    const { error } = await supabase.auth.admin.deleteUser(userId);
    if (error) return res.status(500).json({ error: "FAILED_TO_DELETE" });

    return res.status(204).send();
  } catch (e) {
    return res.status(500).json({ error: "FAILED_TO_DELETE" });
  }
});

export default router;
