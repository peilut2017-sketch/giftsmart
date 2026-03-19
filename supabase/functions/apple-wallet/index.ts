/**
 * Apple Wallet Pass (.pkpass) — Supabase Edge Function
 *
 * Required env vars (set in Supabase Dashboard → Project Settings → Edge Functions):
 *   APPLE_PASS_TYPE_IDENTIFIER   — e.g. pass.com.yourapp.voucher
 *   APPLE_TEAM_IDENTIFIER        — 10-char Apple Team ID (e.g. ABCDE12345)
 *   APPLE_CERT_P12_BASE64        — base64 of your .p12 certificate file
 *   APPLE_CERT_PASSWORD          — .p12 certificate password
 *   APPLE_WWDR_CERT_PEM          — Apple WWDR intermediate cert PEM
 *                                  (download from https://www.apple.com/certificateauthority/)
 *
 * Setup:
 *   1. Apple Developer account → Certificates, IDs & Profiles → Pass Type IDs → create
 *   2. Generate a certificate for the Pass Type ID → download .cer → export as .p12
 *   3. Download Apple WWDR G4 certificate (PEM) from apple.com/certificateauthority
 *   4. base64-encode the .p12: `base64 -i cert.p12`
 *   5. Set env vars above in Supabase
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
// @deno-types="npm:@types/node-forge@1.3.10"
import forge from 'npm:node-forge@1.3.1'
// @deno-types="npm:@types/jszip@3.4.1"
import JSZip from 'npm:jszip@3.10.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Create a minimal 1×1 transparent PNG as placeholder icon
const PLACEHOLDER_PNG = Uint8Array.from(atob(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
), c => c.charCodeAt(0))

async function sha1(data: Uint8Array): Promise<string> {
  const hashBuf = await crypto.subtle.digest('SHA-1', data)
  return Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const passTypeId   = Deno.env.get('APPLE_PASS_TYPE_IDENTIFIER')
    const teamId       = Deno.env.get('APPLE_TEAM_IDENTIFIER')
    const certP12B64   = Deno.env.get('APPLE_CERT_P12_BASE64')
    const certPassword = Deno.env.get('APPLE_CERT_PASSWORD') || ''
    const wwdrPem      = Deno.env.get('APPLE_WWDR_CERT_PEM')

    if (!passTypeId || !teamId || !certP12B64 || !wwdrPem) {
      return new Response(
        JSON.stringify({ error: 'WALLET_NOT_CONFIGURED', message: 'Apple Wallet env vars are not set. See function comments.' }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const { storeName, balance, code, expiryDate, notes } = await req.json()
    if (!storeName || !code) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ---------- Build pass.json ----------
    const pass: Record<string, any> = {
      formatVersion: 1,
      passTypeIdentifier: passTypeId,
      serialNumber: crypto.randomUUID(),
      teamIdentifier: teamId,
      organizationName: 'ארנק שוברים',
      description: storeName,
      backgroundColor: 'rgb(22, 163, 74)',
      foregroundColor: 'rgb(255, 255, 255)',
      labelColor: 'rgb(255, 255, 255)',
      storeCard: {
        primaryFields: [
          { key: 'balance', label: 'יתרה', value: `₪${Number(balance).toLocaleString('he-IL')}` },
        ],
        secondaryFields: [
          { key: 'store', label: 'חנות', value: storeName },
          { key: 'code',  label: 'קוד',   value: String(code)  },
        ],
        auxiliaryFields: expiryDate ? [
          { key: 'expiry', label: 'תוקף עד', value: expiryDate, dateStyle: 'PKDateStyleShort', isRelative: true },
        ] : [],
        backFields: notes ? [
          { key: 'notes', label: 'הערות', value: notes },
        ] : [],
      },
      barcode: {
        message: String(code),
        format: 'PKBarcodeFormatQR',
        messageEncoding: 'iso-8859-1',
        altText: String(code),
      },
    }

    // ---------- Build file map ----------
    const passJson  = new TextEncoder().encode(JSON.stringify(pass))
    const iconPng   = PLACEHOLDER_PNG
    const icon2xPng = PLACEHOLDER_PNG

    const files: Record<string, Uint8Array> = {
      'pass.json':  passJson,
      'icon.png':   iconPng,
      'icon@2x.png': icon2xPng,
    }

    // ---------- Manifest ----------
    const manifest: Record<string, string> = {}
    for (const [name, data] of Object.entries(files)) {
      manifest[name] = await sha1(data)
    }
    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest))

    // ---------- Sign with PKCS#7 ----------
    const p12Der = forge.util.decode64(certP12B64)
    const p12Asn1 = forge.asn1.fromDer(p12Der)
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, certPassword)

    // Extract cert + key from p12
    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })
    const keyBags  = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })
    const passCert = (certBags[forge.pki.oids.certBag] as any[])[0]?.cert
    const passKey  = (keyBags[forge.pki.oids.pkcs8ShroudedKeyBag] as any[])[0]?.key
    const wwdrCert = forge.pki.certificateFromPem(wwdrPem)

    if (!passCert || !passKey) throw new Error('Could not extract cert/key from P12')

    const p7 = forge.pkcs7.createSignedData()
    p7.content = forge.util.createBuffer(new TextDecoder().decode(manifestBytes))
    p7.addCertificate(wwdrCert)
    p7.addCertificate(passCert)
    p7.addSigner({
      key: passKey,
      certificate: passCert,
      digestAlgorithm: forge.pki.oids.sha1,
      authenticatedAttributes: [
        { type: forge.pki.oids.contentType,   value: forge.pki.oids.data },
        { type: forge.pki.oids.messageDigest },
        { type: forge.pki.oids.signingTime,   value: new Date() },
      ],
    })
    p7.sign({ detached: true })

    const sigDer = forge.asn1.toDer(p7.toAsn1()).getBytes()
    const sigBytes = Uint8Array.from(sigDer, c => c.charCodeAt(0))

    // ---------- Bundle into ZIP (.pkpass) ----------
    const zip = new JSZip()
    for (const [name, data] of Object.entries(files)) zip.file(name, data)
    zip.file('manifest.json', manifestBytes)
    zip.file('signature', sigBytes)

    const pkpass = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })

    return new Response(pkpass, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/vnd.apple.pkpass',
        'Content-Disposition': `attachment; filename="${storeName}.pkpass"`,
      },
    })
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
