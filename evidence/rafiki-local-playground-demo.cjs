'use strict'

// Real end-to-end run of agent-payments-bridge against Rafiki's own Local
// Playground (Cloud Nine Wallet, docker-compose, Postgres variant).
// No mocks below this line except the SDK's own createUnauthenticatedClient
// for wallet address discovery, which is a real HTTP call to a real local
// Rafiki backend, not a stub.
//
// How to reproduce (see ../README.md and 2026-09-14-run-log.md for context):
//   1. git clone --recurse-submodules https://github.com/interledger/rafiki.git
//   2. cd rafiki && pnpm i && pnpm localenv:compose:psql build
//   3. pnpm localenv:compose:psql up -d
//   4. From this package's directory: npm run build (so dist/ exists)
//   5. docker run --rm --network rafiki_rafiki \
//        -v <this-package-dir>:/bridge:ro \
//        -v <rafiki-clone>:/rafiki:ro \
//        -v <this-file>:/work/demo.cjs:ro \
//        node:24-alpine node /work/demo.cjs

const path = require('path')

// This script runs INSIDE the rafiki_rafiki docker network, so it addresses
// services by their real Compose service names — no localhost port mapping,
// no hosts-file tricks, no Host-header spoofing.
const BRIDGE_DIR = '/bridge'
const RAFIKI_DIR = '/rafiki'

const {
  createAuthenticatedClient,
  createUnauthenticatedClient,
} = require(path.join(BRIDGE_DIR, 'node_modules/@interledger/open-payments'))

const { anchorPaymentCompletion } = require(path.join(BRIDGE_DIR, 'dist/src/index.js'))

// Internal-network address of the IDP-facing service API. Verified live by
// probing the auth container: port 3009 answers /grant/:id/:nonce (200),
// port 3011 (SERVICE_API_PORT, a different internal API) 404s on it. This
// is what the Cloud Nine Wallet UI itself calls to resolve/accept a
// consent; we call the same endpoints directly instead of driving a browser.
const IDP_SERVICE_URL = 'http://cloud-nine-wallet-auth:3009'
const IDP_SECRET = '2pEcn2kkCclbOHQiGNEwhJ0rucATZhrA807HTm2rNXE='
// Bare auth server root (no tenant path) — matches AUTH_SERVER_DOMAIN in
// localenv/cloud-nine-wallet/docker-compose.yml, which is what the real
// Cloud Nine Wallet UI's ApiClient.endInteraction() calls for /interact/.../finish.
const AUTH_SERVER_ROOT = 'http://cloud-nine-wallet-auth:3006'

const SENDER_WALLET_ADDRESS = 'https://cloud-nine-wallet-backend/accounts/bhamchest'
const RECEIVER_WALLET_ADDRESS = 'https://cloud-nine-wallet-backend/accounts/gfranklin'
// Verified live against the freshly-seeded instance: every Cloud Nine
// personal account shares the ASE's one private-key.pem (same JWK `x` for
// all of them), registered under a per-account kid = `keyid-<accountId>`
// (accountId from localenv/cloud-nine-wallet/seed.yml). bhamchest's id is
// a9adbe1a-df31-4766-87c9-d2cb2e636a9b. These are the ASE's own well-known
// local-dev test credentials — not secrets, and not real money.
const KEY_ID = 'keyid-a9adbe1a-df31-4766-87c9-d2cb2e636a9b'
const PRIVATE_KEY_PATH = path.join(RAFIKI_DIR, 'localenv/cloud-nine-wallet/private-key.pem')

class ConsoleAuditSink {
  async record(event) {
    console.log('\n[audit sink] payment anchored:')
    console.log(JSON.stringify(event, null, 2))
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// The auth server's own responses (interact.redirect, continue.uri) embed
// its AUTH_SERVER_DOMAIN, which docker-compose sets to a browser-facing
// http://localhost:3006 — meaningless from inside this container's network
// namespace. Rewrite it to the real internal hostname before we call it.
function toInternalAuthUrl(url) {
  return url.replace('http://localhost:3006', 'http://cloud-nine-wallet-auth:3006')
}

async function main() {
  console.log('=== 1. Discover wallet addresses (real HTTP GET) ===')
  const unauth = await createUnauthenticatedClient({ useHttp: true })
  const senderWA = await unauth.walletAddress.get({ url: SENDER_WALLET_ADDRESS })
  const receiverWA = await unauth.walletAddress.get({ url: RECEIVER_WALLET_ADDRESS })
  console.log('sender:', senderWA.id, senderWA.assetCode, senderWA.assetScale, 'authServer=', senderWA.authServer)
  console.log('receiver:', receiverWA.id, receiverWA.assetCode, receiverWA.assetScale, 'authServer=', receiverWA.authServer)

  const client = await createAuthenticatedClient({
    walletAddressUrl: SENDER_WALLET_ADDRESS,
    privateKey: PRIVATE_KEY_PATH,
    keyId: KEY_ID,
    useHttp: true, // no TLS termination for the internal hostnames here
  })

  console.log('\n=== 2. Grant: incoming-payment (non-interactive, on receiver auth server) ===')
  const incomingGrant = await client.grant.request(
    { url: receiverWA.authServer },
    { access_token: { access: [{ type: 'incoming-payment', actions: ['create', 'read', 'complete', 'list'] }] } },
  )
  if (!('access_token' in incomingGrant)) {
    throw new Error('expected a non-interactive incoming-payment grant, got: ' + JSON.stringify(incomingGrant))
  }
  console.log('incoming-payment grant issued, access_token present:', !!incomingGrant.access_token.value)

  console.log('\n=== 3. Create incoming payment on receiver (real resource, $5.00 USD) ===')
  const incomingPayment = await client.incomingPayment.create(
    { url: receiverWA.resourceServer, accessToken: incomingGrant.access_token.value },
    {
      walletAddress: RECEIVER_WALLET_ADDRESS,
      incomingAmount: { value: '500', assetCode: receiverWA.assetCode, assetScale: receiverWA.assetScale },
    },
  )
  console.log('incoming payment id:', incomingPayment.id)
  console.log('completed (should be false so far):', incomingPayment.completed)

  console.log('\n=== 4. Grant: quote (non-interactive, on sender auth server) ===')
  const quoteGrant = await client.grant.request(
    { url: senderWA.authServer },
    { access_token: { access: [{ type: 'quote', actions: ['create', 'read'] }] } },
  )
  if (!('access_token' in quoteGrant)) {
    throw new Error('expected a non-interactive quote grant, got: ' + JSON.stringify(quoteGrant))
  }

  console.log('\n=== 5. Create quote (sender pays the incoming payment) ===')
  const quote = await client.quote.create(
    { url: senderWA.resourceServer, accessToken: quoteGrant.access_token.value },
    { walletAddress: SENDER_WALLET_ADDRESS, receiver: incomingPayment.id, method: 'ilp' },
  )
  console.log('quote id:', quote.id)
  console.log('debitAmount:', quote.debitAmount, 'receiveAmount:', quote.receiveAmount)

  console.log('\n=== 6. Grant: outgoing-payment (INTERACTIVE — real GNAP redirect + consent) ===')
  const outgoingGrantPending = await client.grant.request(
    { url: senderWA.authServer },
    {
      access_token: {
        access: [
          {
            type: 'outgoing-payment',
            actions: ['create', 'read', 'list'],
            identifier: SENDER_WALLET_ADDRESS,
            limits: { debitAmount: quote.debitAmount },
          },
        ],
      },
      interact: { start: ['redirect'] },
    },
  )
  if (!('interact' in outgoingGrantPending)) {
    throw new Error('expected an interactive pending grant, got: ' + JSON.stringify(outgoingGrantPending))
  }
  console.log('pending grant redirect:', outgoingGrantPending.interact.redirect)
  console.log('continue uri:', outgoingGrantPending.continue.uri)

  // Actual shape observed: http://<auth-domain>/interact/{interactId}/{nonce}?clientName=...
  // interactId and nonce are path segments here, not query params.
  const redirectUrl = new URL(outgoingGrantPending.interact.redirect)
  const segments = redirectUrl.pathname.split('/').filter(Boolean)
  const interactIdx = segments.indexOf('interact')
  const interactId = interactIdx >= 0 ? segments[interactIdx + 1] : undefined
  const nonce = interactIdx >= 0 ? segments[interactIdx + 2] : undefined
  if (!interactId || !nonce) {
    throw new Error('could not extract interactId/nonce from redirect: ' + outgoingGrantPending.interact.redirect)
  }
  console.log('interactId:', interactId, 'nonce:', nonce)

  console.log('\n=== 7. Script the mock IDP consent (real HTTP, no browser — same calls a browser would trigger) ===')

  // A real browser's FIRST hit is the auth server's own front-channel start
  // route (what interact.redirect points at before its own 302 to the mock
  // IDP UI). That call is what establishes the session cookie tying this
  // interactId to this nonce — required later by /finish. We replicate it
  // directly instead of rendering anything.
  const startRes = await fetch(toInternalAuthUrl(outgoingGrantPending.interact.redirect), {
    redirect: 'manual',
  })
  console.log('GET /interact/:id/:nonce (start) ->', startRes.status)
  const sessionCookie = (startRes.headers.getSetCookie?.() ?? [startRes.headers.get('set-cookie')].filter(Boolean))
    .map((c) => c.split(';')[0])
    .join('; ')
  if (!sessionCookie) throw new Error('no session cookie returned by /interact start route')

  const getGrantRes = await fetch(`${IDP_SERVICE_URL}/grant/${interactId}/${nonce}`, {
    headers: { 'x-idp-secret': IDP_SECRET },
  })
  console.log('GET /grant/:id/:nonce ->', getGrantRes.status)
  if (getGrantRes.status !== 200) throw new Error('mock idp getGrant failed: ' + (await getGrantRes.text()))

  const acceptRes = await fetch(`${IDP_SERVICE_URL}/grant/${interactId}/${nonce}/accept`, {
    method: 'POST',
    headers: { 'x-idp-secret': IDP_SECRET },
  })
  console.log('POST /grant/:id/:nonce/accept ->', acceptRes.status)
  if (acceptRes.status !== 202) throw new Error('mock idp accept failed: ' + (await acceptRes.text()))

  const finishRes = await fetch(`${AUTH_SERVER_ROOT}/interact/${interactId}/${nonce}/finish`, {
    redirect: 'manual',
    headers: { Cookie: sessionCookie },
  })
  console.log('GET /interact/:id/:nonce/finish ->', finishRes.status)

  console.log('\n=== 8. Continuation request (real GNAP continue call) ===')
  const waitSeconds = outgoingGrantPending.continue.wait ?? 5
  console.log(`server-mandated GNAP "wait" before continuing: ${waitSeconds}s`)
  await sleep((waitSeconds + 1) * 1000)
  const finalizedGrant = await client.grant.continue({
    url: toInternalAuthUrl(outgoingGrantPending.continue.uri),
    accessToken: outgoingGrantPending.continue.access_token.value,
  })
  if (!('access_token' in finalizedGrant)) {
    throw new Error('continuation did not finalize the grant: ' + JSON.stringify(finalizedGrant))
  }
  console.log('outgoing-payment access token obtained.')

  console.log('\n=== 9. Create the outgoing payment (real money movement, local ILP settlement) ===')
  const outgoingPayment = await client.outgoingPayment.create(
    { url: senderWA.resourceServer, accessToken: finalizedGrant.access_token.value },
    { walletAddress: SENDER_WALLET_ADDRESS, quoteId: quote.id },
  )
  console.log('outgoing payment id:', outgoingPayment.id)
  console.log('sentAmount (immediately after creation):', outgoingPayment.sentAmount)

  console.log('\n=== 10. THE ACTUAL agent-payments-bridge CODE — anchor the INCOMING payment ===')
  const incomingResult = await anchorPaymentCompletion({
    client,
    kind: 'incoming',
    resourceUrl: incomingPayment.id,
    accessToken: incomingGrant.access_token.value,
    sink: new ConsoleAuditSink(),
    intervalMs: 1000,
    timeoutMs: 30_000,
  })
  console.log('\nincoming-payment anchor result:', incomingResult)

  console.log('\n=== 11. THE ACTUAL agent-payments-bridge CODE — anchor the OUTGOING payment ===')
  const outgoingResult = await anchorPaymentCompletion({
    client,
    kind: 'outgoing',
    resourceUrl: outgoingPayment.id,
    accessToken: finalizedGrant.access_token.value,
    sink: new ConsoleAuditSink(),
    intervalMs: 1000,
    timeoutMs: 30_000,
  })
  console.log('\noutgoing-payment anchor result:', outgoingResult)

  console.log('\n=== DONE ===')
}

main().catch((err) => {
  console.error('\nFAILED:', err)
  process.exitCode = 1
})
