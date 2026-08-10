import { NextRequest, NextResponse } from "next/server";
import { verifyInboundToken } from "@/lib/inboundAuth";
import { parseLeadPayload, SOURCE_SLUGS } from "@/lib/leadSourceParsers";
import { ingestLead } from "@/lib/leadIngest";

/**
 * Inbound lead capture endpoint, shared by all sources:
 *   POST /api/webhooks/leads/tally?token=xxxx
 *   POST /api/webhooks/leads/webflow?token=xxxx
 *   POST /api/webhooks/leads/pabbly?token=xxxx   (Pabbly Connect relay, incl. Meta Ads)
 *   POST /api/webhooks/leads/zapier?token=xxxx   (Zapier relay, incl. Meta Ads)
 *
 * Token is per-source and managed under Settings > Inbound Webhooks.
 */
export async function POST(req: NextRequest, { params }: { params: { source: string } }) {
  const slug = params.source.toLowerCase();
  const source = SOURCE_SLUGS[slug];
  if (!source) {
    return NextResponse.json({ error: `Unknown source '${slug}'` }, { status: 404 });
  }

  const token = req.nextUrl.searchParams.get("token");
  const authorized = await verifyInboundToken(source, token);
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
    const input = parseLeadPayload(slug, body);
    const lead = await ingestLead(input);
    return NextResponse.json({ ok: true, leadId: lead.id }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to process lead";
    return NextResponse.json({ ok: false, error: message }, { status: 422 });
  }
}
