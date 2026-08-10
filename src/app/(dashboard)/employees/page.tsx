import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/rbac";
import EmployeeRow from "@/components/EmployeeRow";

export default async function EmployeesPage() {
  const user = await getCurrentUser();
  if (!user || user.role === "SALES") redirect("/dashboard");

  const employees = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { assignedLeads: true } } },
  });

  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900">Employees</h1>
      <p className="mt-1 text-sm text-slate-500">
        Employees sign in with Google Workspace. The first person to ever sign in becomes Admin automatically;
        promote others below.
      </p>

      <div className="card mt-4 overflow-x-auto p-0">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-slate-500">Name</th>
              <th className="px-4 py-3 text-left font-medium text-slate-500">Email</th>
              <th className="px-4 py-3 text-left font-medium text-slate-500">Role</th>
              <th className="px-4 py-3 text-left font-medium text-slate-500">Open Leads</th>
              <th className="px-4 py-3 text-left font-medium text-slate-500">Active</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {employees.map((emp) => (
              <EmployeeRow
                key={emp.id}
                employee={{ id: emp.id, name: emp.name, email: emp.email, role: emp.role, active: emp.active }}
                openLeadsCount={emp._count.assignedLeads}
                canEdit={user.role === "ADMIN"}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
