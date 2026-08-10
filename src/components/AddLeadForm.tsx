"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";

export default function AddLeadForm() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const payload = Object.fromEntries(form.entries());

    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to add lead");
      toast.success("Lead added");
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add lead");
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <button className="btn-primary" onClick={() => setOpen(true)}>
        + Add Lead
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="card grid w-full max-w-xl grid-cols-2 gap-3 shadow-lg">
      <input name="name" placeholder="Name" className="input col-span-2" />
      <input name="email" type="email" placeholder="Email" className="input" />
      <input name="phone" placeholder="Phone (with country code)" className="input" />
      <input name="course" placeholder="Course / Program" className="input col-span-2" />
      <textarea name="message" placeholder="Message" className="input col-span-2" rows={2} />
      <div className="col-span-2 flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? "Saving..." : "Save lead"}
        </button>
      </div>
    </form>
  );
}
