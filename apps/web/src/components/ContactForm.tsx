"use client";

import { useState, type FormEvent } from "react";
import { esCL } from "@/i18n/es-CL";

type Status = "idle" | "sending" | "success" | "error";

export default function ContactForm() {
  const [status, setStatus] = useState<Status>("idle");

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("sending");
    const form = e.currentTarget;
    const data = new FormData(form);
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.get("name"),
          email: data.get("email"),
          message: data.get("message"),
        }),
      });
      if (!res.ok) throw new Error("send failed");
      setStatus("success");
      form.reset();
    } catch {
      setStatus("error");
    }
  }

  if (status === "success") {
    return <p className="text-sm text-heading-gray">{esCL.contacto.success}</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold text-muted-gray">{esCL.contacto.nameLabel}</span>
        <input name="name" type="text" className="text-sm px-3 py-2 rounded-lg border border-stone-300 text-heading-gray" />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold text-muted-gray">{esCL.contacto.emailLabel}</span>
        <input name="email" type="email" required className="text-sm px-3 py-2 rounded-lg border border-stone-300 text-heading-gray" />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold text-muted-gray">{esCL.contacto.messageLabel}</span>
        <textarea name="message" required rows={5} className="text-sm px-3 py-2 rounded-lg border border-stone-300 text-heading-gray resize-y" />
      </label>
      <button
        type="submit"
        disabled={status === "sending"}
        className="self-start text-sm px-4 py-2 rounded-lg bg-heading-gray text-white disabled:opacity-60"
      >
        {status === "sending" ? esCL.contacto.sending : esCL.contacto.submit}
      </button>
      {status === "error" && <p className="text-sm text-red-600">{esCL.contacto.error}</p>}
    </form>
  );
}
