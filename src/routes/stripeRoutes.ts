import express from "express";
import { supabase } from "../supabaseClient";
import { requireAuth } from "../middleware/AuthMiddleware";
import { loadProfile } from "../middleware/LoadProfile";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const HANDLED_STRIPE_EVENTS = new Set<string>([
  "invoice.paid",
  "invoice.payment_failed",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.deleted",
  "customer.subscription.created",
]);
const router = express.Router();

router.post(
  "/create-checkout-session",
  requireAuth,
  loadProfile,
  async (req, res) => {
    const profile = (req as any).profile;
    const user = (req as any).user;
    const email: string = user.email;
    const userId: string = user.id;

    let customerId = profile.stripe_customer_id;

    if (profile.plan_id === "pro") {
      return res.status(409).json({ error: "Already Have Pro Plan" });
    }

    try {
      if (!customerId) {
        const customer = await stripe.customers.create({
          email,
          metadata: { user_id: userId },
          test_clock: "clock_1SfasRK7Wvn4CJucyNmAmnaA",
        });
        customerId = customer.id;

        const { error } = await supabase
          .from("profiles")
          .update({ stripe_customer_id: customerId })
          .eq("user_id", userId);

        if (error) {
          await stripe.customers.del(customerId);
          return res
            .status(500)
            .json({ error: "Error adding customer id to account" });
        }
      }

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        metadata: { user_id: userId },
        line_items: [{ price: process.env.STRIPE_PRICE_ID!, quantity: 1 }],
        success_url: `${process.env.APP_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.APP_URL}/#pricing`,
      });

      return res.status(200).json({ url: session.url });
    } catch (e) {
      console.log(e);
      return res.status(500).json({ error: "Error creating checkout session" });
    }
  }
);

router.post("/portal", requireAuth, loadProfile, async (req, res) => {
  const userId = (req as any).user.id;
  const profile = (req as any).profile;

  if (!profile?.stripe_customer_id) {
    return res.status(400).json({ error: "No Stripe customer on file" });
  }

  const portalSession = await stripe.billingPortal.sessions.create({
    customer: profile.stripe_customer_id,
    return_url: `${process.env.APP_URL}/account`,
  });

  return res.json({ url: portalSession.url });
});

router.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"] as string | undefined;
    const webhookSecret = process.env.STRIPE_WEBHOOK_KEY;

    if (!sig || !webhookSecret) {
      return res.status(400).send("Missing stripe-signature or webhook secret");
    }

    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err: any) {
      console.error("Webhook signature verification failed:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (!HANDLED_STRIPE_EVENTS.has(event.type)) {
      return res.status(200).json({ received: "true" });
    }

    // --- Idempotency / de-dupe guard ---
    const STALE_MS = 3 * 60 * 1000;
    const nowIso = new Date().toISOString();

    try {
      // Get existing row (single or null)
      const { data: existing, error: fetchErr } = await supabase
        .from("stripe_events")
        .select("event_id,status,processing_started_at")
        .eq("event_id", event.id)
        .maybeSingle();

      if (fetchErr) {
        console.error(fetchErr);
        return res.status(500).json({ error: "Error getting stripe event" });
      }

      // No row yet -> try to "lock" it as processing
      if (!existing) {
        const { error: insErr } = await supabase.from("stripe_events").insert({
          event_id: event.id,
          status: "processing",
          type: event.type,
          processing_started_at: nowIso,
        });

        // If this fails due to unique conflict, another request beat us — re-fetch and handle below
        if (insErr) {
          // You can optionally check insErr.code for unique violation, but simplest is refetch:
          const { data: again, error: againErr } = await supabase
            .from("stripe_events")
            .select("event_id,status,processing_started_at")
            .eq("event_id", event.id)
            .maybeSingle();

          if (againErr) {
            console.error(againErr);
            return res
              .status(500)
              .json({ error: "Error re-checking stripe event" });
          }

          if (again?.status === "processed") {
            return res.json({ received: true });
          }

          if (again?.status === "processing") {
            const started = again.processing_started_at
              ? Date.parse(again.processing_started_at)
              : 0;

            // Not stale -> ack so Stripe stops retrying
            if (started && Date.now() - started < STALE_MS) {
              return res.json({ received: true });
            }

            // Stale -> reclaim lock and continue processing
            await supabase
              .from("stripe_events")
              .update({ processing_started_at: nowIso, status: "processing" })
              .eq("event_id", event.id);
          }
        }
      } else {
        // Existing row found
        if (existing.status === "processed") {
          return res.json({ received: true });
        }

        if (existing.status === "processing") {
          const started = existing.processing_started_at
            ? Date.parse(existing.processing_started_at)
            : 0;

          // Not stale -> ACK (don’t 500 forever)
          if (started && Date.now() - started < STALE_MS) {
            return res.json({ received: true });
          }

          // Stale -> reclaim and continue processing
          const { error: reclaimErr } = await supabase
            .from("stripe_events")
            .update({ processing_started_at: nowIso, status: "processing" })
            .eq("event_id", event.id);

          if (reclaimErr) {
            console.error(reclaimErr);
            return res
              .status(500)
              .json({ error: "Error reclaiming stale event" });
          }
        }
      }
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "Error handling event ID" });
    }

    try {
      switch (event.type) {
        case "invoice.paid": {
          const invoice = event.data.object as Stripe.Invoice;

          const customerId =
            typeof invoice.customer === "string"
              ? invoice.customer
              : invoice.customer?.id;

          const subscriptionId =
            invoice.parent?.subscription_details?.subscription ?? null;

          const lines = invoice.lines?.data ?? [];

          const subLine =
            lines.find(
              (l) =>
                l.parent?.type === "subscription_item_details" &&
                l.parent.subscription_item_details?.proration === false
            ) ??
            lines.find((l) => l.parent?.type === "subscription_item_details") ??
            lines[0];

          const linePeriodStart = subLine?.period?.start ?? null;
          const linePeriodEnd = subLine?.period?.end ?? null;

          const startIso = linePeriodStart
            ? new Date(linePeriodStart * 1000).toISOString()
            : null;

          const endIso = linePeriodEnd
            ? new Date(linePeriodEnd * 1000).toISOString()
            : null;

          const { error } = await supabase
            .from("profiles")
            .update({
              stripe_subscription_id: subscriptionId ?? undefined,
              current_period_start: startIso,
              current_period_end: endIso,
            })
            .eq("stripe_customer_id", customerId);

          if (error) {
            try {
              await supabase
                .from("stripe_events")
                .update({ status: "failed" })
                .eq("event_id", event.id);
            } catch (e) {
              return res.status(500).send("Error updating profile");
            }
            return res.status(500).send("Error updating profile");
          }

          break;
        }

        case "invoice.payment_failed": {
          const invoice = event.data.object as Stripe.Invoice;

          const customerId =
            typeof invoice.customer === "string"
              ? invoice.customer
              : invoice.customer?.id;

          const subscriptionId =
            invoice.parent?.subscription_details?.subscription ?? null;

          if (!customerId || !subscriptionId) break;

          const { error } = await supabase
            .from("profiles")
            .update({
              subscription_status: "past_due",
            })
            .eq("stripe_customer_id", customerId)
            .eq("stripe_subscription_id", subscriptionId) // ✅ only mutate the active sub
            .neq("subscription_status", "none"); // ✅ don't resurrect ended users

          if (error) {
            await supabase
              .from("stripe_events")
              .update({ status: "failed" })
              .eq("event_id", event.id);
            return res
              .status(500)
              .json({ error: "Error updating profile database" });
          }

          break;
        }

        case "customer.subscription.created": {
          const sub = event.data.object as Stripe.Subscription;

          const stripeCustomerId =
            typeof sub.customer === "string" ? sub.customer : sub.customer?.id;

          const stripeStatus = sub.status;
          const cancelAt = !!sub.cancel_at;

          // Treat these as "Pro has access" (adjust if you want different behavior)
          const isPro =
            stripeStatus === "active" ||
            stripeStatus === "trialing" ||
            stripeStatus === "past_due";

          const { error } = await supabase
            .from("profiles")
            .update({
              stripe_customer_id: stripeCustomerId,
              stripe_subscription_id: sub.id,
              plan_id: isPro ? "pro" : "free",
              subscription_status: cancelAt
                ? "canceled"
                : isPro
                ? "active"
                : "none",
            })
            .eq("stripe_customer_id", stripeCustomerId);

          if (error) {
            console.error("Supabase update error:", error);
            await supabase
              .from("stripe_events")
              .update({ status: "failed" })
              .eq("event_id", event.id);
            return res.status(500).send("Error updating profile");
          }

          break;
        }

        case "customer.subscription.updated": {
          const sub = event.data.object as Stripe.Subscription;

          const stripeCustomerId =
            typeof sub.customer === "string" ? sub.customer : sub.customer?.id;

          const item0 = sub.items?.data?.[0];

          const current_period_start = item0?.current_period_start ?? null;
          const current_period_end = item0?.current_period_end ?? null;

          const startIso = current_period_start
            ? new Date(current_period_start * 1000).toISOString()
            : null;

          const endIso = current_period_end
            ? new Date(current_period_end * 1000).toISOString()
            : null;

          const stripeStatus = sub.status;
          const cancelAt = !!sub.cancel_at;

          const isProPlan =
            stripeStatus === "active" ||
            stripeStatus === "trialing" ||
            stripeStatus === "past_due";

          console.log(isProPlan);
          console.log(stripeStatus);

          const { error } = await supabase
            .from("profiles")
            .update({
              stripe_customer_id: stripeCustomerId,
              stripe_subscription_id: sub.id,
              plan_id: isProPlan ? "pro" : "free",
              subscription_status:
                stripeStatus === "past_due"
                  ? "past_due"
                  : cancelAt
                  ? "canceled"
                  : "active",
            })
            .eq("stripe_customer_id", stripeCustomerId);

          if (error) {
            console.error("Supabase update error:", error);
            await supabase
              .from("stripe_events")
              .update({ status: "failed" })
              .eq("event_id", event.id);
            return res.status(500).send("Error updating profile");
          }

          break;
        }

        case "customer.subscription.deleted": {
          const sub = event.data.object as Stripe.Subscription;

          const stripeCustomerId =
            typeof sub.customer === "string" ? sub.customer : sub.customer?.id;

          const { error } = await supabase
            .from("profiles")
            .update({
              plan_id: "free",
              subscription_status: "none",
              stripe_subscription_id: null,
              current_period_start: null,
              current_period_end: null,
            })
            .eq("stripe_customer_id", stripeCustomerId);

          console.log(error);
          if (error) {
            await supabase
              .from("stripe_events")
              .update({ status: "failed" })
              .eq("event_id", event.id);
            console.error("Supabase update error:", error);
            return res.status(500).send("Error updating profile");
          }
          break;
        }

        case "customer.deleted": {
          const customer = event.data.object as Stripe.Customer;

          const customerId = customer.id;
          console.log("deleting");

          const { error } = await supabase
            .from("profiles")
            .update({
              plan_id: "free",
              subscription_status: "none",
              current_period_start: null,
              current_period_end: null,
              stripe_customer_id: null,
              stripe_subscription_id: null,
            })
            .eq("stripe_customer_id", customerId);

          if (error) {
            console.error("Supabase update error", error);
            await supabase
              .from("stripe_events")
              .update({ status: "failed" })
              .eq("event_id", event.id);
            return res.status(500).send("Error updating profile");
          }

          break;
        }

        default: {
          break;
        }
      }
      try {
        await supabase
          .from("stripe_events")
          .update({ status: "processed" })
          .eq("event_id", event.id);
      } catch (e) {}

      return res.json({ received: true });
    } catch (err) {
      console.error("Webhook handler error:", err);
      try {
        await supabase
          .from("stripe_events")
          .update({ status: "failed" })
          .eq("event_id", event.id);
      } catch (e) {}

      return res.status(500).send("Webhook handler failed");
    }
  }
);

export default router;
