import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/rbac";
import SignOutButton from "@/components/SignOutButton";
import Logo from "@/components/Logo";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const navItems = [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/leads", label: "Leads" },
    ...(user.role !== "SALES" ? [{ href: "/employees", label: "Employees" }] : []),
    ...(user.role === "ADMIN" ? [{ href: "/settings", label: "Settings" }] : []),
  ];

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-64 flex-col justify-between border-r border-slate-200 bg-white p-4">
        <div>
          <div className="mb-6 px-2">
            <Logo />
            <p className="mt-2 text-xs text-slate-500">{user.name ?? user.email}</p>
            <span className="badge mt-1 bg-brand-50 text-brand-700">{user.role}</span>
          </div>
          <nav className="space-y-1">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="block rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <SignOutButton />
      </aside>
      <main className="flex-1 overflow-y-auto p-6">{children}</main>
    </div>
  );
}
