import { NextRequest, NextResponse } from "next/server";
import { verifyInboundToken } from "@/lib/inboundAuth";
import { parseEnrollmentPayload, ENROLLMENT_SOURCE_SLUGS } from "@/lib/enrollmentSourceParsers";
import { ingestEnrollment } from "@/lib/enrollmentIngest";

/**
 * Inbound Learnyst *course purchase* endpoint (paid enrollments, not free
 * demo/session registrations — those go through /api/webhooks/leads/[source]):
 *   POST /api/webhooks/enrollments/learnyst?token=xxxx
 *   POST /api/webhooks/enrollments/pabbly?token=xxxx   (Pabbly Connect relay)
 *   POST /api/webhooks/enrollments/zapier?token=xxxx   (Zapier relay)
 *
 * Token is per-source and managed under Settings > Inbound Webhooks.
 */
export async function POST(req: NextRequest, { params }: { params: { source: string } }) {
  const slug = params.source.toLowerCase();
  const source = ENROLLMENT_SOURCE_SLUGS[slug];
  if (!source) {
    return NextResponse.json({ error: `Unknown source '${slug}'` }, { status: 404 });
  }

  const token = req.nextUrl.searchParams.get("token");
  const authorized = await verifyInboundToken("ENROLLMENT", source, token);
  if (!authorized) {
    return NextResponse.json({ error: "Invalid or missing token" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON" }, { status: 400 });
  }

  try {
    const input = parseEnrollmentPayload(slug, body);
    const enrollment = await ingestEnrollment(input);
    return NextResponse.json({ ok: true, enrollmentId: enrollment.id }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to process enrollment";
    return NextResponse.json({ ok: false, error: message }, { status: 422 });
  }
}
