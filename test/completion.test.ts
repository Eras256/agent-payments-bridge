import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mockIncomingPayment, mockOutgoingPayment } from '@interledger/open-payments'
import { checkIncomingPaymentCompletion, checkOutgoingPaymentCompletion } from '../src/completion'

test('incoming payment: completed=true is reported as completed', () => {
  const payment = mockIncomingPayment({ completed: true })
  assert.deepEqual(checkIncomingPaymentCompletion(payment), { status: 'completed' })
})

test('incoming payment: completed=false is reported as pending', () => {
  const payment = mockIncomingPayment({ completed: false })
  assert.deepEqual(checkIncomingPaymentCompletion(payment), { status: 'pending' })
})

test('outgoing payment: failed=true is reported as failed, regardless of amounts', () => {
  const payment = mockOutgoingPayment({
    failed: true,
    sentAmount: { value: '0', assetCode: 'USD', assetScale: 2 },
    receiveAmount: { value: '1000', assetCode: 'USD', assetScale: 2 },
  })
  const result = checkOutgoingPaymentCompletion(payment)
  assert.equal(result.status, 'failed')
})

test('outgoing payment: sentAmount fully matching receiveAmount is completed', () => {
  const payment = mockOutgoingPayment({
    failed: false,
    sentAmount: { value: '1000', assetCode: 'USD', assetScale: 2 },
    receiveAmount: { value: '1000', assetCode: 'USD', assetScale: 2 },
  })
  assert.deepEqual(checkOutgoingPaymentCompletion(payment), { status: 'completed' })
})

test('outgoing payment: sentAmount exceeding receiveAmount (e.g. fees rounding) still counts as completed', () => {
  const payment = mockOutgoingPayment({
    failed: false,
    sentAmount: { value: '1005', assetCode: 'USD', assetScale: 2 },
    receiveAmount: { value: '1000', assetCode: 'USD', assetScale: 2 },
  })
  assert.deepEqual(checkOutgoingPaymentCompletion(payment), { status: 'completed' })
})

test('outgoing payment: partial sentAmount is pending', () => {
  const payment = mockOutgoingPayment({
    failed: false,
    sentAmount: { value: '400', assetCode: 'USD', assetScale: 2 },
    receiveAmount: { value: '1000', assetCode: 'USD', assetScale: 2 },
  })
  assert.deepEqual(checkOutgoingPaymentCompletion(payment), { status: 'pending' })
})

test('outgoing payment: mismatched asset denominations are indeterminate, never guessed', () => {
  const payment = mockOutgoingPayment({
    failed: false,
    sentAmount: { value: '1000', assetCode: 'USD', assetScale: 2 },
    receiveAmount: { value: '900', assetCode: 'EUR', assetScale: 2 },
  })
  const result = checkOutgoingPaymentCompletion(payment)
  assert.equal(result.status, 'indeterminate')
  assert.match(result.reason ?? '', /does not document a conversion/)
})

test('outgoing payment: mismatched assetScale (same code) is also indeterminate', () => {
  const payment = mockOutgoingPayment({
    failed: false,
    sentAmount: { value: '100000', assetCode: 'USD', assetScale: 4 },
    receiveAmount: { value: '1000', assetCode: 'USD', assetScale: 2 },
  })
  assert.equal(checkOutgoingPaymentCompletion(payment).status, 'indeterminate')
})
