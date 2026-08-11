import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/rbac";
import LoginButton from "@/components/LoginButton";
import Logo from "@/components/Logo";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-900 px-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-6 text-center shadow-lg">
        <div className="flex justify-center">
          <Logo />
        </div>
        <p className="mt-4 text-sm text-slate-500">
          Sign in with your @joindevops.com Google Workspace account.
        </p>
        <div className="mt-6">
          <LoginButton />
        </div>
      </div>
    </div>
  );
}
