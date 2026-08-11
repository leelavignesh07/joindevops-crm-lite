import type { Lead } from "@prisma/client";

/** Replaces {{field}} placeholders with values from the lead. Unknown fields render blank. */
export function renderTemplate(
  template: string,
  lead: Pick<Lead, "name" | "email" | "phone" | "interestedCourse" | "source">
) {
  const vars: Record<string, string> = {
    name: lead.name?.trim() || "there",
    email: lead.email ?? "",
    phone: lead.phone ?? "",
    course: lead.interestedCourse ?? "our programs",
    source: lead.source,
    brand: process.env.BRAND_NAME ?? "JoinDevOps",
  };
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key: string) => vars[key] ?? "");
}
