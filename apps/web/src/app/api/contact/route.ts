import { NextResponse } from "next/server";
import { Resend } from "resend";

const CONTACT_RECIPIENT = "daniel@probablespa.cl";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface ContactPayload {
  name?: string;
  email?: string;
  message?: string;
}

// Deliberately minimal: a single outbound-only relay ("visitor writes a
// message -> an email lands in my inbox"), not the full Flow 2 submission
// mailbox (token-correlated replies, inbound webhook parsing) that's still
// correctly deferred to Phase 1b — see docs/roadmap.md. Nothing is stored.
export async function POST(request: Request) {
  let payload: ContactPayload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const name = payload.name?.trim() || "Anónimo";
  const email = payload.email?.trim() ?? "";
  const message = payload.message?.trim() ?? "";

  if (!EMAIL_PATTERN.test(email) || message.length === 0) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    // Fails loudly rather than silently swallowing the message — a missing
    // key means the deploy's env vars aren't set yet (see the launch plan's
    // "what only you can do" list), not a normal runtime condition.
    console.error("[contact] RESEND_API_KEY is not set");
    return NextResponse.json({ error: "not_configured" }, { status: 500 });
  }

  // Resend's shared test domain until caldearte.com is verified in Resend
  // (DNS TXT/DKIM records, see the launch plan) — switch this to
  // "Caldearte <contacto@caldearte.com>" once that's done, for real
  // deliverability instead of the shared-domain fallback.
  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from: "Caldearte <onboarding@resend.dev>",
    to: CONTACT_RECIPIENT,
    replyTo: email,
    subject: `Caldearte — mensaje de ${name}`,
    text: `De: ${name} <${email}>\n\n${message}`,
  });

  if (error) {
    console.error("[contact] Resend send failed", error);
    return NextResponse.json({ error: "send_failed" }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
