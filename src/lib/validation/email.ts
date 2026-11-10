import { z } from "zod";

// Accounts must use the company mail domain so reset links only go to company mailboxes.
export const COMPANY_EMAIL_DOMAIN = (process.env.COMPANY_EMAIL_DOMAIN?.trim().toLowerCase().replace(/^@/, "")) || "etgroupindia.com";

export const isCompanyEmail = (email: string) => email.toLowerCase().endsWith(`@${COMPANY_EMAIL_DOMAIN}`);

export const companyEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Enter a valid email address.")
  .max(254)
  .refine(isCompanyEmail, `Use your @${COMPANY_EMAIL_DOMAIN} email address.`);
