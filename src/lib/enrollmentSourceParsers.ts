import type { LeadSourceType } from "@prisma/client";

// URL slug -> Prisma enum. Learnyst enrollments typically arrive via a
// Pabbly/Zapier relay (same pattern as leads), but a slug is kept per-relay
// so each gets its own inbound secret token.
export const ENROLLMENT_SOURCE_SLUGS: Record<string, LeadSourceType> = {
  learnyst: "LEARNYST",
  pabbly: "PABBLY",
  zapier: "ZAPIER",
};

export type NormalizedEnrollmentInput = {
  name?: string;
  email?: string;
  phone?: string;
  courseName: string;
  courseRef?: string;
  amount?: number;
  source: LeadSourceType;
  rawPayload?: unknown;
};

type JsonObject = Record<string, unknown>;

function asString(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

function asNumber(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Generic flat-JSON payload for a Learnyst course purchase, forwarded via
 * Pabbly Connect / Zapier (Learnyst's own webhooks, if enabled on your plan,
 * can also be pointed here directly with the same field-name mapping).
 */
export function parseEnrollmentPayload(slug: string, body: JsonObject): NormalizedEnrollmentInput {
  const source = ENROLLMENT_SOURCE_SLUGS[slug];
  if (!source) throw new Error(`Unknown enrollment source: ${slug}`);

  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const value = asString(body[key]);
      if (value) return value;
    }
    return undefined;
  };
  const pickNumber = (...keys: string[]) => {
    for (const key of keys) {
      const value = asNumber(body[key]);
      if (value !== undefined) return value;
    }
    return undefined;
  };

  const courseName = pick("course_name", "courseName", "course", "product_name", "productName");
  if (!courseName) throw new Error("Enrollment payload is missing a course name");

  return {
    name: pick("name", "full_name", "fullName", "student_name"),
    email: pick("email", "email_address", "student_email"),
    phone: pick("phone", "phone_number", "whatsapp", "mobile", "student_phone"),
    courseName,
    courseRef: pick("course_id", "courseId", "product_id", "productId"),
    amount: pickNumber("amount", "amount_paid", "price", "order_amount", "order_total"),
    source,
    rawPayload: body,
  };
}
