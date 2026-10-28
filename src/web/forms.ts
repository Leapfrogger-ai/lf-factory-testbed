import { z } from 'zod';
import { CITIES } from '../config.ts';

const POSTGRES_INTEGER_MAX = 2_147_483_647;

const text = (max: number) => z.string().trim().min(1).max(max);

const isRealDate = (value: string) => {
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
};

const date = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isRealDate);

const time = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (typeof value === 'string' && value.trim() === '' ? undefined : value), schema.optional());

const minimum = z
  .string()
  .trim()
  .regex(/^\d+$/)
  .transform(Number)
  .pipe(z.number().int().min(2).max(POSTGRES_INTEGER_MAX));

export const publishFormSchema = z
  .object({
    city: z.string().trim().refine((city) => CITIES.includes(city)),
    area: text(200),
    timeWindow: text(200),
    format: text(40),
    venue: text(120),
    date,
    time,
    minimum,
    deadlineDate: optional(date),
    deadlineTime: optional(time),
    name: text(80),
    email: z.string().trim().min(3).max(254).pipe(z.email()),
  })
  .superRefine((form, context) => {
    if (form.deadlineDate !== undefined && form.deadlineTime === undefined) {
      context.addIssue({ code: 'custom', path: ['deadlineTime'], message: 'Give both a deadline date and time, or neither.' });
    }
    if (form.deadlineTime !== undefined && form.deadlineDate === undefined) {
      context.addIssue({ code: 'custom', path: ['deadlineDate'], message: 'Give both a deadline date and time, or neither.' });
    }
  })
  .transform((form) => ({ ...form, emailNormalized: form.email.toLowerCase() }));

export type PublishForm = z.output<typeof publishFormSchema>;
