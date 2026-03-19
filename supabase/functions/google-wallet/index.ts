/**
 * Google Wallet Pass — Supabase Edge Function
 *
 * Required env vars (set in Supabase Dashboard → Project Settings → Edge Functions):
 *   GOOGLE_WALLET_ISSUER_ID        — from pay.google.com/business/console
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL   — service account email
 *   GOOGLE_SERVICE_ACCOUNT_KEY     — RSA private key PEM (replace \n with literal newlines)
 *
 * Setup:
 *   1. Create a Google Cloud project and enable "Google Wallet API"
 *   2. Create a Service Account with role "Wallet Object Issuer"
 *   3. Register as a Google Wallet issuer at pay.google.com/business/console
 *   4. Set the three env vars above in Supabase
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

async function signRS256(payload: object, privateKeyPem: string, issuerEmail: string): Promise<string> {
  const header = { alg: 'RS256', typ: 'JWT' }
  const claims = { iss: issuerEmail, aud: 'google', iat: Math.floor(Date.now() / 1000), ...payload }

  const enc = (obj: object) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

  const signingInput = `${enc(header)}.${enc(claims)}`

  // Import RSA private key
  const pem = privateKeyPem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '')
  const keyBytes = Uint8Array.from(atob(pem), c => c.charCodeAt(0))

  const key = await crypto.subtle.importKey(
    'pkcs8',
    keyBytes.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput),
  )

  const encodedSig = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

  return `${signingInput}.${encodedSig}`
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const issuerId   = Deno.env.get('GOOGLE_WALLET_ISSUER_ID')
    const issuerEmail = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_EMAIL')
    const privateKey = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_KEY')

    if (!issuerId || !issuerEmail || !privateKey) {
      return new Response(
        JSON.stringify({ error: 'WALLET_NOT_CONFIGURED', message: 'Google Wallet env vars are not set. See function comments for setup instructions.' }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const { storeName, balance, code, expiryDate, notes } = await req.json()
    if (!storeName || !code) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: storeName, code' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const classId  = `${issuerId}.voucher_class`
    const objectId = `${issuerId}.voucher_${crypto.randomUUID().replace(/-/g, '')}`

    const textModules = [
      { id: 'balance', header: 'יתרה', body: `₪${Number(balance).toLocaleString('he-IL')}` },
      { id: 'code',    header: 'קוד שובר', body: String(code) },
    ]
    if (expiryDate) {
      textModules.push({
        id: 'expiry',
        header: 'תוקף עד',
        body: new Date(expiryDate).toLocaleDateString('he-IL'),
      })
    }
    if (notes) {
      textModules.push({ id: 'notes', header: 'הערות', body: String(notes) })
    }

    const passPayload = {
      typ: 'savetowallet',
      payload: {
        genericObjects: [{
          id: objectId,
          classId,
          state: 'ACTIVE',
          cardTitle:  { defaultValue: { language: 'he', value: 'ארנק שוברים' } },
          header:     { defaultValue: { language: 'he', value: storeName } },
          subheader:  { defaultValue: { language: 'he', value: 'שובר מתנה' } },
          hexBackgroundColor: '#16a34a',
          textModulesData: textModules,
          barcode: { type: 'TEXT_ONLY', value: String(code), alternateText: String(code) },
        }],
      },
    }

    const jwt = await signRS256(passPayload, privateKey, issuerEmail)
    const saveUrl = `https://pay.google.com/gp/v/save/${jwt}`

    return new Response(
      JSON.stringify({ url: saveUrl }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
