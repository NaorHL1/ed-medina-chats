import { NextResponse } from 'next/server';
import { markPaid, stripeProvider } from '@/lib/server/billing';

/** Stripe's payment confirmation. The signature is checked before anything is marked paid. */
export async function POST(request: Request) {
  const secret = process.env['STRIPE_WEBHOOK_SECRET'];
  const key = process.env['STRIPE_SECRET_KEY'];
  if (!secret || !key) return NextResponse.json({ error: 'Stripe is not configured.' }, { status: 404 });
  const body = await request.text();
  const purchaseId = stripeProvider(key, secret).parseWebhook(body, request.headers.get('stripe-signature'));
  if (purchaseId) markPaid(purchaseId, null);
  return NextResponse.json({ received: true });
}
