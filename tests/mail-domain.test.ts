import { afterEach, describe, expect, it, vi } from "vitest";
import { forgotPasswordSchema } from "@/lib/validation/auth";
import { sendMail } from "@/lib/mail";

describe("company email domain", () => {
  it("accepts only @etgroupindia.com addresses for password reset", () => {
    expect(forgotPasswordSchema.safeParse({ email: "Someone@EtGroupIndia.com" }).success).toBe(true);
    expect(forgotPasswordSchema.safeParse({ email: "someone@tims.local" }).success).toBe(false);
    expect(forgotPasswordSchema.safeParse({ email: "someone@etgroupindia.com.evil.io" }).success).toBe(false);
  });
});

describe("sendMail", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("sends through the webhook with the standard mailbox as sender", async () => {
    vi.stubEnv("SMTP_HOST", "");
    vi.stubEnv("MAIL_WEBHOOK_URL", "https://relay.example/send");
    vi.stubEnv("MAIL_FROM", "TIMS <noreply@etgroupindia.com>");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    expect(await sendMail({ to: "a@etgroupindia.com", subject: "s", text: "t" })).toBe(true);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      from: "TIMS <noreply@etgroupindia.com>",
      to: "a@etgroupindia.com",
    });
  });
});
