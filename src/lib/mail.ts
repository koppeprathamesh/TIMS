import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

// Outbound mail. Transports, in order of preference:
//   1. SMTP_HOST set  -> SMTP, sent from the application's standard mailbox (MAIL_FROM, e.g. noreply@etgroupindia.com)
//   2. MAIL_WEBHOOK_URL set -> POST { from, to, subject, text } to a relay (Logic App, SendGrid/SES proxy, ...)
//   3. neither -> development logs the message; production reports it as undelivered.
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export const DEFAULT_MAIL_FROM = "TIMS <noreply@etgroupindia.com>";

let cachedTransport: { key: string; transporter: Transporter } | null = null;

function smtpTransport(): Transporter | null {
  const host = process.env.SMTP_HOST?.trim();
  if (!host) return null;

  const port = Number(process.env.SMTP_PORT) || 587;
  const secure = process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : port === 465;
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASSWORD;

  const key = [host, port, secure, user, pass].join("|");
  if (cachedTransport?.key !== key) {
    cachedTransport = {
      key,
      transporter: nodemailer.createTransport({
        host,
        port,
        secure,
        auth: user ? { user, pass } : undefined,
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
      }),
    };
  }
  return cachedTransport.transporter;
}

export async function sendMail(message: MailMessage): Promise<boolean> {
  const from = process.env.MAIL_FROM?.trim() || DEFAULT_MAIL_FROM;

  const smtp = smtpTransport();
  if (smtp) {
    try {
      await smtp.sendMail({ from, to: message.to, subject: message.subject, text: message.text });
      return true;
    } catch (error) {
      console.error("SMTP delivery failed", error);
      return false;
    }
  }

  const webhook = process.env.MAIL_WEBHOOK_URL;
  if (webhook) {
    try {
      const response = await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, ...message }),
      });
      if (!response.ok) console.error(`Mail webhook responded with ${response.status}`);
      return response.ok;
    } catch (error) {
      console.error("Mail webhook request failed", error);
      return false;
    }
  }

  if (process.env.NODE_ENV !== "production") {
    console.info(`[mail:dev] From: ${from}\nTo: ${message.to}\n${message.subject}\n${message.text}`);
    return true;
  }
  console.error("No mail transport configured (set SMTP_HOST or MAIL_WEBHOOK_URL); the message was not delivered.");
  return false;
}
