/**
 * Direct WATI (https://www.wati.io) integration.
 *
 * WhatsApp Business rules require the FIRST message to a new contact to use a
 * pre-approved template (see WATI dashboard > Broadcast > Templates), so
 * acknowledgements go out via sendTemplateMessage. Free-form follow-ups within
 * the 24h customer-care window can use sendSessionMessage.
 */

function watiConfig() {
  const endpoint = process.env.WATI_API_ENDPOINT; // e.g. https://live-mt-server.wati.io/123456
  const apiKey = process.env.WATI_API_KEY;
  if (!endpoint || !apiKey) {
    throw new Error("WATI_API_ENDPOINT / WATI_API_KEY are not configured");
  }
  return { endpoint: endpoint.replace(/\/$/, ""), apiKey };
}

function toWatiPhone(phone: string) {
  // WATI expects digits only, with country code, no leading +
  return phone.replace(/[^\d]/g, "");
}

export async function sendWhatsAppTemplate(opts: {
  phone: string;
  templateName: string;
  bodyParams: string[]; // positional {{1}}, {{2}}, ... values
  broadcastName?: string;
}) {
  const { endpoint, apiKey } = watiConfig();
  const whatsappNumber = toWatiPhone(opts.phone);

  const res = await fetch(
    `${endpoint}/api/v1/sendTemplateMessage?whatsappNumber=${whatsappNumber}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json-patch+json",
      },
      body: JSON.stringify({
        template_name: opts.templateName,
        broadcast_name: opts.broadcastName ?? `${opts.templateName}_${Date.now()}`,
        parameters: opts.bodyParams.map((value, i) => ({ name: String(i + 1), value })),
      }),
    }
  );

  const data = (await res.json().catch(() => ({}))) as { result?: boolean; message?: string };
  if (!res.ok || data.result === false) {
    throw new Error(data.message ?? `WATI template send failed (${res.status})`);
  }
  return data;
}

export async function sendWhatsAppSessionMessage(opts: { phone: string; text: string }) {
  const { endpoint, apiKey } = watiConfig();
  const whatsappNumber = toWatiPhone(opts.phone);

  const res = await fetch(
    `${endpoint}/api/v1/sendSessionMessage/${whatsappNumber}?messageText=${encodeURIComponent(opts.text)}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
    }
  );

  const data = (await res.json().catch(() => ({}))) as { result?: boolean; message?: string };
  if (!res.ok || data.result === false) {
    throw new Error(data.message ?? `WATI session send failed (${res.status})`);
  }
  return data;
}
