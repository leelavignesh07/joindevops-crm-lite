"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import type { Role } from "@prisma/client";

type Employee = { id: string; name: string | null; email: string; role: Role; active: boolean };

export default function EmployeeRow({
  employee,
  openLeadsCount,
  canEdit,
}: {
  employee: Employee;
  openLeadsCount: number;
  canEdit: boolean;
}) {
  const [role, setRole] = useState(employee.role);
  const [active, setActive] = useState(employee.active);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function patch(body: Record<string, unknown>) {
    setLoading(true);
    try {
      const res = await fetch(`/api/employees/${employee.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Update failed");
      toast.success("Employee updated");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <tr className="hover:bg-slate-50">
      <td className="px-4 py-3 font-medium text-slate-900">{employee.name ?? "—"}</td>
      <td className="px-4 py-3 text-slate-600">{employee.email}</td>
      <td className="px-4 py-3">
        {canEdit ? (
          <select
            className="input"
            value={role}
            disabled={loading}
            onChange={(e) => {
              const next = e.target.value as Role;
              setRole(next);
              patch({ role: next });
            }}
          >
            <option value="ADMIN">ADMIN</option>
            <option value="MANAGER">MANAGER</option>
            <option value="SALES">SALES</option>
          </select>
        ) : (
          employee.role
        )}
      </td>
      <td className="px-4 py-3 text-slate-600">{openLeadsCount}</td>
      <td className="px-4 py-3">
        {canEdit ? (
          <input
            type="checkbox"
            checked={active}
            disabled={loading}
            onChange={(e) => {
              setActive(e.target.checked);
              patch({ active: e.target.checked });
            }}
          />
        ) : (
          <span>{employee.active ? "Yes" : "No"}</span>
        )}
      </td>
    </tr>
  );
}
