import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/rbac";
import LoginButton from "@/components/LoginButton";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="card w-full max-w-sm text-center">
        <h1 className="text-xl font-semibold text-slate-900">JoinDevOps CRM</h1>
        <p className="mt-1 text-sm text-slate-500">
          Sign in with your @joindevops.com Google Workspace account.
        </p>
        <div className="mt-6">
          <LoginButton />
        </div>
      </div>
    </div>
  );
}
