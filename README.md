# agent-payments-bridge

Minimal, real piece of the "agent-payments bridge" design in
`_strategy/investigacion/rafiki-gap-proposal.md`: given an Open Payments
payment a caller already has a URL and access token for, poll it until it
reaches a genuine completion state, then hand a normalized event to a
caller-supplied audit sink.

This is the first slice, not the full bridge. It does **not** implement
GNAP grant negotiation, the outgoing-payment consent-once-then-repeat-spend
flow, or an x402-like facilitator. Those remain design-only until there's a
reason to build them for real (see the proposal doc).

## What it actually does

1. Takes an already-created Open Payments `incoming-payment` or
   `outgoing-payment` resource URL + access token.
2. Polls it (`GET`) at an interval until it reaches a terminal state.
3. On genuine completion, builds a normalized `PaymentAnchorEvent` and calls
   `AuditSink.record(event)` — a one-method interface each consumer
   implements against its own audit trail. This package never writes to a
   specific audit store itself.

## Why polling, not a webhook

Checked directly against the OpenAPI specs shipped inside
`@interledger/open-payments@7.4.0`
(`node_modules/@interledger/open-payments/dist/openapi/specs/*.yaml`) on
2026-09-14: none of the resource-server, auth-server, or
wallet-address-server specs define a webhook or push-notification resource.
Open Payments' client-facing API is pull-only. A push mechanism would have
to come from the wallet operator's own (Rafiki) backend, which is a
different, much larger integration this package does not attempt.

## Completion is not the same field for both payment types

Verified against the same spec files, not assumed:

- **Incoming payment**: `completed: boolean` — direct field.
- **Outgoing payment**: no `completed` field. Derived here as
  `!failed && sentAmount >= receiveAmount`, comparing `BigInt` values only
  when `assetCode`/`assetScale` match between the two amounts. When they
  don't match (a cross-currency payment) this package reports
  `'indeterminate'` rather than guessing an FX rate. See
  `src/completion.ts`.

Why `indeterminate` is the right answer there, read from Rafiki `main` on
2026-09-29 (`packages/backend/src/open_payments/payment/outgoing/model.ts`
and `.../quote/model.ts`): `sentAmount` is denominated in the payment's own
asset, which is the quote's asset, i.e. the **sender's**, and it excludes
fees (in the real run under `evidence/`: `sentAmount` 500, `receiveAmount`
500, `debitAmount` 610). `receiveAmount` is denominated in the
**receiver's** asset. For a cross-currency payment the two are different
units, so no comparison of them can mean "done". I have not run a
cross-currency payment; this comes from reading the getters.

**Known limitation.** `failed` is true only for Cancelled/Failed, so a
COMPLETED and a still-SENDING payment both read `failed: false`. Reading
`outgoing/lifecycle.ts`, a payment can end COMPLETED with
`sentAmount < receiveAmount` when its receiver is missing or no longer
active by the time it is processed. This package would keep polling that
payment until `timeoutMs` and return `pending`, never anchoring it. That
fails safe (nothing is recorded as complete on a guess) but it is a false
negative. Not reproduced. This is raised upstream as a question in
[interledger/rafiki#3984](https://github.com/interledger/rafiki/issues/3984).

## What "anchored" does and doesn't mean

`observedAt` on a `PaymentAnchorEvent` is when *this bridge* polled and saw
completion — not a wallet-attested settlement timestamp. Open Payments
exposes no completion timestamp on either resource (only `createdAt` and,
for incoming payments, `expiresAt`). If a consumer needs a trustworthy
settlement time, it has to come from the wallet operator directly, not from
this package.

## Usage

```ts
import { createBridgeClient, anchorPaymentCompletion } from 'agent-payments-bridge'

const client = await createBridgeClient({
  walletAddressUrl: 'https://ilp.interledger-test.dev/yourname',
  keyId: '...',
  privateKey: './private.key',
})

const result = await anchorPaymentCompletion({
  client,
  kind: 'incoming',
  resourceUrl: 'https://ilp.interledger-test.dev/yourname/incoming-payments/<id>',
  accessToken: '...',
  sink: myAuditSink, // implements AuditSink
})
```

See `examples/anchor-to-audit-trail.ts` for a runnable version against the
real Interledger test network (`wallet.interledger-test.dev` — create a
free test account there, add a wallet address, and generate a Developer
Key to get `keyId` + `privateKey`).

## Setup

```
npm install
npm test    # builds, then runs real tests (node:test) — no network calls,
            # uses @interledger/open-payments' own mock*() fixture helpers
```

## Status

Built 2026-09-14. Not yet published anywhere, not yet consumed by any real
project — that's a separate step with its own confirmation, not implied by
this package existing.
