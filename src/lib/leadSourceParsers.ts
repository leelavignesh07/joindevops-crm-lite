import type { LeadSourceType } from "@prisma/client";
import type { NormalizedLeadInput } from "@/lib/leadIngest";

// URL slug -> Prisma enum
export const SOURCE_SLUGS: Record<string, LeadSourceType> = {
  tally: "TALLY",
  webflow: "WEBFLOW",
  pabbly: "PABBLY", // generic relay, also used for Meta Ads leads forwarded via Pabbly Connect
  zapier: "ZAPIER", // generic relay, also used for Meta Ads leads forwarded via Zapier
  learnyst: "LEARNYST", // free-session/demo registrations captured directly on Learnyst
};

type JsonObject = Record<string, unknown>;

function asString(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

/** Tally.so webhook payload: { eventId, eventType, data: { fields: [{label,type,value}] } } */
function parseTally(body: JsonObject): NormalizedLeadInput {
  const data = (body.data as JsonObject) ?? {};
  const fields = (data.fields as Array<{ label?: string; key?: string; type?: string; value?: unknown }>) ?? [];

  const find = (...labels: string[]) => {
    const match = fields.find((f) =>
      labels.some((l) => (f.label ?? "").toLowerCase().includes(l))
    );
    if (!match) return undefined;
    const value = match.value;
    if (Array.isArray(value)) return asString(value[0]);
    return asString(value);
  };

  return {
    name: find("name"),
    email: find("email"),
    phone: find("phone", "mobile", "whatsapp"),
    course: find("course", "program", "interested"),
    message: find("message", "comment", "query"),
    source: "TALLY",
    sourceRef: asString(data.formName) ?? asString(body.formId),
    // Tally doesn't forward the respondent's IP by default; only populated if
    // you add a hidden field (label containing "ip") mapped to the visitor's IP.
    ipAddress: find("ip address", "ip"),
    rawPayload: body,
  };
}

/** Webflow Forms webhook v2 payload: { name, site, data: { <field label>: value, ... }, formId } */
function parseWebflow(body: JsonObject): NormalizedLeadInput {
  const data = (body.data as JsonObject) ?? (body.payload as JsonObject) ?? {};
  const get = (...keys: string[]) => {
    for (const key of Object.keys(data)) {
      if (keys.some((k) => key.toLowerCase().replace(/[^a-z]/g, "").includes(k))) {
        return asString(data[key]);
      }
    }
    return undefined;
  };

  return {
    name: get("name", "fullname"),
    email: get("email"),
    phone: get("phone", "mobile", "whatsapp"),
    course: get("course", "program", "interest"),
    message: get("message", "comment", "query"),
    source: "WEBFLOW",
    sourceRef: asString(body.name) ?? asString(body.formId),
    // Only populated if the form has a hidden field capturing the visitor's IP.
    ipAddress: get("ipaddress", "ip"),
    rawPayload: body,
  };
}

/**
 * Generic flat-JSON payload used for the Pabbly Connect / Zapier relay —
 * this is also how Meta (Facebook/Instagram) Lead Ads leads and Learnyst
 * free-session/demo registrations reach the CRM, since Pabbly/Zapier pulls
 * them from the source and forwards a flat JSON body here. Accepts common
 * field name variants so simple Zap/Pabbly mappings just work.
 */
function parseGeneric(body: JsonObject, source: LeadSourceType): NormalizedLeadInput {
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const value = asString(body[key]);
      if (value) return value;
    }
    return undefined;
  };

  return {
    name: pick("name", "full_name", "fullName"),
    email: pick("email", "email_address"),
    phone: pick("phone", "phone_number", "whatsapp", "mobile"),
    course: pick("course", "course_name", "program", "interested_in"),
    message: pick("message", "comment", "query", "notes"),
    source,
    sourceRef: pick("ad_id", "adgroup_id", "campaign_name", "form_id", "source_ref"),
    // Only populated if the relay (Pabbly/Zapier step, or the source form
    // itself) explicitly forwards the visitor's IP — most lead-ad platforms
    // don't include it, so treat this as best-effort.
    ipAddress: pick("ip", "ip_address", "client_ip", "visitor_ip"),
    utmSource: pick("utm_source"),
    utmMedium: pick("utm_medium"),
    utmCampaign: pick("utm_campaign", "campaign_name"),
    rawPayload: body,
  };
}

export function parseLeadPayload(slug: string, body: JsonObject): NormalizedLeadInput {
  const source = SOURCE_SLUGS[slug];
  if (!source) throw new Error(`Unknown lead source: ${slug}`);

  switch (source) {
    case "TALLY":
      return parseTally(body);
    case "WEBFLOW":
      return parseWebflow(body);
    default:
      return parseGeneric(body, source);
  }
}
