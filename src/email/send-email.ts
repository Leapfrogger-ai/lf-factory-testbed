import { ApplicationFailure } from '@temporalio/activity'

export type EmailPayload = {
  to: string
  subject: string
  text: string
  tags: { name: string; value: string }[]
}

export type SendEmail = (payload: EmailPayload, idempotencyKey: string) => Promise<{ id: string }>

export type ResendLike = {
  emails: {
    send(
      payload: EmailPayload & { from: string },
      options: { idempotencyKey: string },
    ): Promise<{
      data: { id: string } | null
      error: { name: string; message: string; statusCode: number | null } | null
    }>
  }
}

const RETRYABLE_NAMES = new Set(['rate_limit_exceeded', 'concurrent_idempotent_requests'])

function isRetryable(error: { name: string; statusCode: number | null }): boolean {
  return (
    RETRYABLE_NAMES.has(error.name) || error.statusCode === null || error.statusCode >= 500
  )
}

export function createSendEmail(deps: { resend: ResendLike; from: string }): SendEmail {
  return async (payload, idempotencyKey) => {
    const { data, error } = await deps.resend.emails.send(
      { ...payload, from: deps.from },
      { idempotencyKey },
    )
    if (error || !data) {
      const name = error?.name ?? 'no_data'
      const statusCode = error?.statusCode ?? null
      // The message carries only Resend's error name and status, never the payload.
      const message = `Resend send failed: ${name} (${statusCode ?? 'no status'})`
      throw error && !isRetryable(error)
        ? ApplicationFailure.nonRetryable(message, 'ResendError')
        : ApplicationFailure.retryable(message, 'ResendError')
    }
    return { id: data.id }
  }
}
