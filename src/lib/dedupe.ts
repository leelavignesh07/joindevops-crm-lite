import { prisma } from "@/lib/prisma";
import type { IdentifierType } from "@prisma/client";

/**
 * Normalizes contact fields to stable keys so the same person is matched
 * regardless of formatting differences (spacing, casing, +country codes).
 */
export function normalizeEmail(email: string | undefined | null): string | undefined {
  const trimmed = email?.trim().toLowerCase();
  return trimmed ? trimmed : undefined;
}

/** Strips everything but digits and keeps the last 10 (works across +91/0/00 country-code prefixes). */
export function normalizePhone(phone: string | undefined | null): string | undefined {
  const digits = phone?.replace(/\D/g, "");
  if (!digits || digits.length < 7) return undefined;
  return digits.slice(-10);
}

export function normalizeName(name: string | undefined | null): string | undefined {
  const normalized = name?.trim().toLowerCase().replace(/\s+/g, " ");
  return normalized ? normalized : undefined;
}

export function normalizeIp(ip: string | undefined | null): string | undefined {
  const trimmed = ip?.trim();
  return trimmed ? trimmed : undefined;
}

export type MatchSignals = {
  email?: string;
  phone?: string;
  name?: string;
  ip?: string;
};

/**
 * Finds an existing Lead that this inbound registration almost certainly
 * belongs to, so we never create a duplicate for the same person.
 *
 * Priority order (strongest signal first):
 *   1. Exact normalized email match — a strong identity key.
 *   2. Exact normalized phone match — a strong identity key.
 *   3. Same normalized full name AND same IP address — two weak signals
 *      combined into one reasonably confident match (an IP alone is shared
 *      by too many people — an office, a college lab, a home network — to
 *      ever be trusted on its own).
 *
 * Returns null when nothing matches, meaning a new Lead should be created.
 */
export async function findExistingLead(signals: MatchSignals): Promise<string | null> {
  if (signals.email) {
    const match = await prisma.contactIdentifier.findFirst({
      where: { type: "EMAIL", normalizedValue: signals.email },
      select: { leadId: true },
    });
    if (match) return match.leadId;
  }

  if (signals.phone) {
    const match = await prisma.contactIdentifier.findFirst({
      where: { type: "PHONE", normalizedValue: signals.phone },
      select: { leadId: true },
    });
    if (match) return match.leadId;
  }

  if (signals.name && signals.ip) {
    const ipMatches = await prisma.contactIdentifier.findMany({
      where: { type: "IP", normalizedValue: signals.ip },
      select: { leadId: true, lead: { select: { name: true } } },
    });
    const sameName = ipMatches.find((m) => normalizeName(m.lead.name) === signals.name);
    if (sameName) return sameName.leadId;
  }

  return null;
}

/** Records any identifiers on this Lead that haven't been seen before (no-op for repeats). */
export async function recordNewIdentifiers(leadId: string, signals: MatchSignals) {
  const candidates: Array<{ type: IdentifierType; value: string; normalizedValue: string }> = [];
  if (signals.email) candidates.push({ type: "EMAIL", value: signals.email, normalizedValue: signals.email });
  if (signals.phone) candidates.push({ type: "PHONE", value: signals.phone, normalizedValue: signals.phone });
  if (signals.ip) candidates.push({ type: "IP", value: signals.ip, normalizedValue: signals.ip });
  if (candidates.length === 0) return;

  const existing = await prisma.contactIdentifier.findMany({
    where: { leadId, OR: candidates.map((c) => ({ type: c.type, normalizedValue: c.normalizedValue })) },
    select: { type: true, normalizedValue: true },
  });
  const existingKeys = new Set(existing.map((e) => `${e.type}:${e.normalizedValue}`));
  const toCreate = candidates.filter((c) => !existingKeys.has(`${c.type}:${c.normalizedValue}`));
  if (toCreate.length === 0) return;

  await prisma.contactIdentifier.createMany({
    data: toCreate.map((c) => ({ leadId, ...c })),
  });
}
