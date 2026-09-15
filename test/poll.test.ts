import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mockIncomingPayment } from '@interledger/open-payments'
import { pollUntilComplete } from '../src/poll'
import type { AuthenticatedClient } from '@interledger/open-payments'

function fakeClientReturning(sequence: ReturnType<typeof mockIncomingPayment>[]): AuthenticatedClient {
  let call = 0
  return {
    incomingPayment: {
      get: async () => {
        const payment = sequence[Math.min(call, sequence.length - 1)]
        call += 1
        return payment
      },
    },
  } as unknown as AuthenticatedClient
}

test('pollUntilComplete stops as soon as the resource reports completed=true', async () => {
  const client = fakeClientReturning([
    mockIncomingPayment({ completed: false }),
    mockIncomingPayment({ completed: false }),
    mockIncomingPayment({ completed: true }),
  ])

  const result = await pollUntilComplete({
    client,
    kind: 'incoming',
    resourceUrl: 'https://ilp.interledger-test.dev/alice/incoming-payments/test',
    accessToken: 'test-token',
    intervalMs: 1,
    timeoutMs: 1000,
  })

  assert.equal(result.status, 'completed')
  assert.equal(result.attempts, 3)
})

test('pollUntilComplete gives up at the timeout and reports pending, not completed', async () => {
  const client = fakeClientReturning([mockIncomingPayment({ completed: false })])

  const result = await pollUntilComplete({
    client,
    kind: 'incoming',
    resourceUrl: 'https://ilp.interledger-test.dev/alice/incoming-payments/test',
    accessToken: 'test-token',
    intervalMs: 5,
    timeoutMs: 20,
  })

  assert.equal(result.status, 'pending')
  assert.match(result.reason ?? '', /timed out/)
})
