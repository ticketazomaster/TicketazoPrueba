import Stripe from "https://esm.sh/stripe@14.14.0"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  // Preflight CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') as string, {
      apiVersion: '2023-10-16',
      httpClient: Stripe.createFetchHttpClient(),
    })

    const body = await req.json()
    const { amount, currency = 'mxn', eventTitle, eventId, qty, userId } = body

    // Validación mínima (Stripe necesita mínimo 1000 centavos = $10 MXN)
    if (!amount || typeof amount !== 'number' || amount < 1000) {
      return new Response(
        JSON.stringify({ error: 'Monto inválido. El mínimo es $10.00 MXN.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Crear PaymentIntent en Stripe
    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency,
      description: `${qty}x boleto(s) — ${eventTitle}`,
      metadata: {
        eventId:    String(eventId  || ''),
        userId:     String(userId   || 'guest'),
        qty:        String(qty      || 1),
        eventTitle: String(eventTitle || ''),
      },
    })

    return new Response(
      JSON.stringify({
        clientSecret:    paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    console.error('[stripe-checkout]', err)
    return new Response(
      JSON.stringify({ error: err.message || 'Error interno del servidor.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
