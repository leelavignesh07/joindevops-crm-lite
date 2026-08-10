import { prisma } from "@/lib/prisma";

/**
 * Least-loaded round robin: assigns the new lead to the active SALES employee
 * with the fewest currently-open leads (status not WON/LOST). Ties broken by
 * whoever was assigned longest ago.
 */
export async function pickNextAssignee(): Promise<string | null> {
  const salesReps = await prisma.user.findMany({
    where: { role: "SALES", active: true },
    select: {
      id: true,
      assignedLeads: {
        where: { status: { notIn: ["WON", "LOST"] } },
        select: { id: true, createdAt: true },
      },
    },
  });

  if (salesReps.length === 0) return null;

  const ranked = salesReps
    .map((rep) => ({
      id: rep.id,
      openCount: rep.assignedLeads.length,
      lastAssignedAt: rep.assignedLeads.reduce<Date | null>((latest, l) => {
        return !latest || l.createdAt > latest ? l.createdAt : latest;
      }, null),
    }))
    .sort((a, b) => {
      if (a.openCount !== b.openCount) return a.openCount - b.openCount;
      const aTime = a.lastAssignedAt?.getTime() ?? 0;
      const bTime = b.lastAssignedAt?.getTime() ?? 0;
      return aTime - bTime;
    });

  return ranked[0]?.id ?? null;
}
