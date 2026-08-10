import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/rbac";
import type { LeadSourceType, LeadStatus, Prisma } from "@prisma/client";
import AddLeadForm from "@/components/AddLeadForm";
import StatusBadge from "@/components/StatusBadge";

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: { status?: LeadStatus; source?: LeadSourceType; q?: string };
}) {
  const user = await getCurrentUser();
  if (!user) return null;

  const where: Prisma.LeadWhereInput = {
    ...(searchParams.status ? { status: searchParams.status } : {}),
    ...(searchParams.source ? { source: searchParams.source } : {}),
    ...(user.role === "SALES" ? { assignedToId: user.id } : {}),
    ...(searchParams.q
      ? {
          OR: [
            { name: { contains: searchParams.q, mode: "insensitive" } },
            { email: { contains: searchParams.q, mode: "insensitive" } },
            { phone: { contains: searchParams.q } },
          ],
        }
      : {}),
  };

  const leads = await prisma.lead.findMany({
    where,
    include: { assignedTo: { select: { name: true, email: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const statuses: LeadStatus[] = ["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL", "WON", "LOST"];
  const sources: LeadSourceType[] = ["TALLY", "WEBFLOW", "PABBLY", "ZAPIER", "MANUAL", "OTHER"];

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Leads</h1>
        <AddLeadForm />
      </div>

      <form className="mt-4 flex flex-wrap gap-2" method="get">
        <input
          type="text"
          name="q"
          defaultValue={searchParams.q}
          placeholder="Search name, email, phone..."
          className="input max-w-xs"
        />
        <select name="status" defaultValue={searchParams.status ?? ""} className="input max-w-[10rem]">
          <option value="">All statuses</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select name="source" defaultValue={searchParams.source ?? ""} className="input max-w-[10rem]">
          <option value="">All sources</option>
          {sources.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button className="btn-secondary" type="submit">
          Filter
        </button>
      </form>

      <div className="card mt-4 overflow-x-auto p-0">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-slate-500">Name</th>
              <th className="px-4 py-3 text-left font-medium text-slate-500">Contact</th>
              <th className="px-4 py-3 text-left font-medium text-slate-500">Source</th>
              <th className="px-4 py-3 text-left font-medium text-slate-500">Status</th>
              <th className="px-4 py-3 text-left font-medium text-slate-500">Assigned To</th>
              <th className="px-4 py-3 text-left font-medium text-slate-500">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {leads.map((lead) => (
              <tr key={lead.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <Link href={`/leads/${lead.id}`} className="font-medium text-brand-700 hover:underline">
                    {lead.name || "Unnamed lead"}
                  </Link>
                </td>
                <td className="px-4 py-3 text-slate-600">
                  <div>{lead.email}</div>
                  <div>{lead.phone}</div>
                </td>
                <td className="px-4 py-3 text-slate-600">{lead.source}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={lead.status} />
                </td>
                <td className="px-4 py-3 text-slate-600">{lead.assignedTo?.name ?? lead.assignedTo?.email ?? "Unassigned"}</td>
                <td className="px-4 py-3 text-slate-500">{new Date(lead.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
            {leads.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                  No leads found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
