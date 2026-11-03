import { ApplicationFailure } from '@temporalio/activity'
import { describe, expect, it } from 'vitest'
import { createSendEmail } from './send-email.ts'
import type { EmailPayload, ResendLike } from './send-email.ts'

type SendResult = Awaited<ReturnType<ResendLike['emails']['send']>>
type SendCall = Parameters<ResendLike['emails']['send']>

const payload: EmailPayload = {
  to: 'sam@example.test',
  subject: 'Your link',
  text: 'Manage: https://calvin.test/m/secret',
  tags: [{ name: 'kind', value: 'manage_link' }],
}

function fakeResend(result: SendResult) {
  const calls: SendCall[] = []
  const resend: ResendLike = {
    emails: {
      async send(...args) {
        calls.push(args)
        return result
      },
    },
  }
  return { resend, calls }
}

function failure(name: string, statusCode: number | null): SendResult {
  return { data: null, error: { name, message: 'resend said no', statusCode } }
}

describe('createSendEmail', () => {
  it('sends with from and the idempotency key, and returns the id', async () => {
    const { resend, calls } = fakeResend({ data: { id: 'abc' }, error: null })
    const sendEmail = createSendEmail({ resend, from: 'calvin <hi@send.calvin.test>' })

    await expect(sendEmail(payload, 'manage_link/p/c')).resolves.toEqual({ id: 'abc' })

    expect(calls).toEqual([
      [{ ...payload, from: 'calvin <hi@send.calvin.test>' }, { idempotencyKey: 'manage_link/p/c' }],
    ])
  })

  it.each([
    ['rate_limit_exceeded', 429],
    ['concurrent_idempotent_requests', 409],
    ['application_error', 500],
    ['service_unavailable', 503],
    ['application_error', null],
  ])('retries %s (%s)', async (name, statusCode) => {
    const { resend } = fakeResend(failure(name, statusCode))
    const sendEmail = createSendEmail({ resend, from: 'f' })
    const error = await sendEmail(payload, 'k').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApplicationFailure)
    expect((error as ApplicationFailure).nonRetryable).toBe(false)
  })

  it.each([
    ['validation_error', 422],
    ['invalid_api_key', 403],
    ['restricted_api_key', 401],
    ['daily_quota_exceeded', 429],
    ['monthly_quota_exceeded', 429],
  ])('does not retry %s (%s)', async (name, statusCode) => {
    const { resend } = fakeResend(failure(name, statusCode))
    const sendEmail = createSendEmail({ resend, from: 'f' })
    const error = await sendEmail(payload, 'k').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApplicationFailure)
    expect((error as ApplicationFailure).nonRetryable).toBe(true)
  })

  it('keeps the payload out of the error message', async () => {
    const { resend } = fakeResend(failure('validation_error', 422))
    const sendEmail = createSendEmail({ resend, from: 'f' })
    const error = (await sendEmail(payload, 'k').catch((e: unknown) => e)) as ApplicationFailure
    expect(error.message).not.toContain('sam@example.test')
    expect(error.message).not.toContain('secret')
  })
})
