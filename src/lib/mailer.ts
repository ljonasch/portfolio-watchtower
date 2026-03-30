import nodemailer from "nodemailer";

function createTransport() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT ?? 587),
    secure: false,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

export const smtp = {
  isConfigured: () => !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS),
  from: () => process.env.SMTP_FROM ?? "Portfolio Watchtower <noreply@localhost>",
};

export async function sendMail(opts: {
  to: string | string[];
  subject: string;
  html: string;
}): Promise<{ ok: boolean; error?: string }> {
  const transport = createTransport();
  if (!transport) {
    console.warn("[mailer] SMTP not configured — notification stored in-app only.");
    return { ok: false, error: "SMTP not configured" };
  }
  try {
    await transport.sendMail({
      from: smtp.from(),
      to: Array.isArray(opts.to) ? opts.to.join(", ") : opts.to,
      subject: opts.subject,
      html: opts.html,
    });
    return { ok: true };
  } catch (err: any) {
    console.error("[mailer] Send failed:", err?.message);
    return { ok: false, error: err?.message ?? "Unknown error" };
  }
}
