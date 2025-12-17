import express from "express";
import { supabase } from "../supabaseClient";
import { requireAuth } from "../middleware/AuthMiddleware";
import { loadProfile } from "../middleware/LoadProfile";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

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
          test_clock: "clock_1Sf9LMK7Wvn4CJucfPKPhVaf",
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
  console.log("HERE");

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

    try {
      switch (event.type) {
        case "invoice.payment_succeeded": {
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
              plan_id: "pro",
              stripe_subscription_id: subscriptionId,
              current_period_start: startIso,
              current_period_end: endIso,
              subscription_status: "active",
            })
            .eq("stripe_customer_id", customerId);

          if (error) {
            console.error("Supabase update error:", error);
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

          const { error } = await supabase
            .from("profiles")
            .update({
              plan_id: "free",
              current_period_start: null,
              current_period_end: null,
              subscription_status: "none",
            })
            .eq("stripe_customer_id", customerId);

          if (error) {
            return res
              .status(500)
              .json({ error: "Error updating profile database" });
          }
        }

        case "customer.subscription.updated": {
          const sub = event.data.object as Stripe.Subscription;

          const stripeCustomerId =
            typeof sub.customer === "string" ? sub.customer : sub.customer?.id;

          const stripeSubscriptionId = sub.id;
          const stripePriceId = sub.items.data[0]?.price?.id ?? null;

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

          const isPro = stripeStatus === "active";

          const { error } = await supabase
            .from("profiles")
            .update({
              plan_id: isPro ? "pro" : "free",
              stripe_customer_id: stripeCustomerId,
              stripe_subscription_id: stripeSubscriptionId,
              current_period_start: startIso,
              current_period_end: endIso,
              subscription_status: cancelAt ? "canceled" : "active",
            })
            .eq("stripe_customer_id", stripeCustomerId);

          if (error) {
            console.error("Supabase update error:", error);
            return res.status(500).send("Error updating profile");
          }

          break;
        }

        case "customer.subscription.deleted": {
          const sub = event.data.object as Stripe.Subscription;

          const stripeCustomerId =
            typeof sub.customer === "string" ? sub.customer : sub.customer?.id;

          console.log(stripeCustomerId);

          const { error } = await supabase
            .from("profiles")
            .update({
              plan_id: "free",
              subscription_status: "none",
              current_period_start: null,
              current_period_end: null,
            })
            .eq("stripe_customer_id", stripeCustomerId);

          console.log(error);
          if (error) {
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
            return res.status(500).send("Error updating profile");
          }
        }

        default: {
          break;
        }
      }

      return res.json({ received: true });
    } catch (err) {
      console.error("Webhook handler error:", err);
      return res.status(500).send("Webhook handler failed");
    }
  }
);

export default router;
