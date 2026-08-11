import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/rbac";
import StatusBadge from "@/components/StatusBadge";
import ProbabilityBadge from "@/components/ProbabilityBadge";
import LeadStatusControl from "@/components/LeadStatusControl";
import LeadProbabilityControl from "@/components/LeadProbabilityControl";
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
      enrollments: { orderBy: { enrolledAt: "desc" } },
      registrations: { orderBy: { sequence: "desc" } },
      identifiers: true,
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
          <div className="flex items-center gap-2">
            {lead.convertedAt && <span className="badge bg-emerald-50 text-emerald-700">Customer since {new Date(lead.convertedAt).toLocaleDateString()}</span>}
            {lead.upsellFlaggedAt && <span className="badge bg-aqua/20 text-ink-900">Upsell opportunity</span>}
            <ProbabilityBadge probability={lead.probability} />
            <StatusBadge status={lead.status} />
          </div>
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
              <dd className="font-medium text-slate-900">{lead.interestedCourse || "—"}</dd>
            </div>
            <div>
              <dt className="text-slate-500">UTM Campaign</dt>
              <dd className="font-medium text-slate-900">{lead.utmCampaign || "—"}</dd>
            </div>
            <div>
              <dt className="text-slate-500">First registered</dt>
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

        {lead.enrollments.length > 0 && (
          <div className="card mt-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">Enrollments (Learnyst)</h2>
            <ul className="space-y-2 text-sm">
              {lead.enrollments.map((e) => (
                <li key={e.id} className="flex items-center justify-between">
                  <span className="text-slate-800">{e.courseName}</span>
                  <span className="text-slate-500">
                    {e.amount ? `₹${e.amount} · ` : ""}
                    {new Date(e.enrolledAt).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

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

        <div className="card mt-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Registration History</h2>
          <p className="mb-3 text-xs text-slate-500">
            Every touchpoint this lead registered from, in order — including repeat sign-ups with a different
            email/phone/source that were matched back to this same person.
          </p>
          <ol className="space-y-2 text-sm">
            {lead.registrations.map((r) => (
              <li key={r.id} className="flex items-center justify-between">
                <span className="text-slate-800">
                  #{r.sequence} · {r.source}
                  {r.course ? ` — ${r.course}` : ""}
                </span>
                <span className="text-slate-500">{new Date(r.createdAt).toLocaleString()}</span>
              </li>
            ))}
            {lead.registrations.length === 0 && <p className="text-sm text-slate-400">No registrations recorded.</p>}
          </ol>
        </div>
      </div>

      <div>
        <div className="card">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Pipeline</h2>
          <LeadStatusControl leadId={lead.id} currentStatus={lead.status} />
        </div>

        <div className="card mt-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Probability</h2>
          <LeadProbabilityControl leadId={lead.id} currentProbability={lead.probability} />
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

        {lead.identifiers.length > 0 && (
          <div className="card mt-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">Known Identifiers</h2>
            <p className="mb-2 text-xs text-slate-500">Every email/phone/IP this lead has ever registered with.</p>
            <ul className="space-y-1 text-sm">
              {lead.identifiers.map((id) => (
                <li key={id.id} className="flex items-center justify-between">
                  <span className="text-slate-500">{id.type}</span>
                  <span className="text-slate-800">{id.value}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
