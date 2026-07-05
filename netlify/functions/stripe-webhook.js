import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async (req) => {
  const sig = req.headers.get("stripe-signature");
  const body = await req.text();

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return new Response(`Webhook error: ${err.message}`, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const userId = session.metadata?.supabase_user_id;

    if (userId) {
      await supabase
        .from("profiles")
        .update({ is_pro: true })
        .eq("id", userId);
    }
  }

  if (event.type === "customer.subscription.deleted") {
    const subscription = event.data.object;
    // Buscar usuário pelo customer ID do Stripe
    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .eq("stripe_customer_id", subscription.customer)
      .maybeSingle();

    if (profile) {
      await supabase
        .from("profiles")
        .update({ is_pro: false })
        .eq("id", profile.id);
    }
  }

  return new Response(JSON.stringify({ received: true }), { status: 200 });
};

export const config = { path: "/api/stripe-webhook" };
