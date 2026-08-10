import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/rbac";
import StatusBadge from "@/components/StatusBadge";
import LeadStatusControl from "@/components/LeadStatusControl";
import LeadAssignControl from "@/components/LeadAssignControl";
import NoteForm from "@/components/NoteForm";

export default async function LeadDetailPage({ params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const lead = await prisma.lead.findUnique({
    where: { id: params.id },
    include: {
      assignedTo: { select: { id: true, name: true, email: true } },
      activities: { orderBy: { createdAt: "desc" }, include: { user: { select: { name: true, email: true } } } },
      communications: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!lead) notFound();
  if (user.role === "SALES" && lead.assignedToId !== user.id) redirect("/leads");

  const salesReps =
    user.role !== "SALES"
      ? await prisma.user.findMany({ where: { role: "SALES", active: true }, select: { id: true, name: true, email: true } })
      : [];

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">{lead.name || "Unnamed lead"}</h1>
            <p className="text-sm text-slate-500">
              {lead.email} {lead.phone && `· ${lead.phone}`}
            </p>
          </div>
          <StatusBadge status={lead.status} />
        </div>

        <div className="card mt-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Details</h2>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-slate-500">Source</dt>
              <dd className="font-medium text-slate-900">
                {lead.source} {lead.sourceRef && `(${lead.sourceRef})`}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Course / Interest</dt>
              <dd className="font-medium text-slate-900">{lead.course || "—"}</dd>
            </div>
            <div>
              <dt className="text-slate-500">UTM Campaign</dt>
              <dd className="font-medium text-slate-900">{lead.utmCampaign || "—"}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Created</dt>
              <dd className="font-medium text-slate-900">{new Date(lead.createdAt).toLocaleString()}</dd>
            </div>
            {lead.message && (
              <div className="col-span-2">
                <dt className="text-slate-500">Message</dt>
                <dd className="font-medium text-slate-900">{lead.message}</dd>
              </div>
            )}
          </dl>
        </div>

        <div className="card mt-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Activity Timeline</h2>
          <NoteForm leadId={lead.id} />
          <ul className="mt-4 space-y-3">
            {lead.activities.map((a) => (
              <li key={a.id} className="border-l-2 border-slate-200 pl-3 text-sm">
                <p className="text-slate-800">{a.message}</p>
                <p className="text-xs text-slate-400">
                  {a.user?.name ?? a.user?.email ?? "System"} · {new Date(a.createdAt).toLocaleString()}
                </p>
              </li>
            ))}
            {lead.activities.length === 0 && <p className="text-sm text-slate-400">No activity yet.</p>}
          </ul>
        </div>
      </div>

      <div>
        <div className="card">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Pipeline</h2>
          <LeadStatusControl leadId={lead.id} currentStatus={lead.status} />
        </div>

        {user.role !== "SALES" && (
          <div className="card mt-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">Assigned To</h2>
            <LeadAssignControl leadId={lead.id} currentAssigneeId={lead.assignedToId} salesReps={salesReps} />
          </div>
        )}

        <div className="card mt-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Communications</h2>
          <ul className="space-y-2 text-sm">
            {lead.communications.map((c) => (
              <li key={c.id} className="flex items-center justify-between">
                <span className="text-slate-700">
                  {c.channel} · {c.templateKey}
                </span>
                <StatusBadge status={c.status} />
              </li>
            ))}
            {lead.communications.length === 0 && <p className="text-slate-400">No communications sent yet.</p>}
          </ul>
        </div>
      </div>
    </div>
  );
}
