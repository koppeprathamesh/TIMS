import { z } from "zod";
import { passwordSchema } from "@/lib/validation/admin";
import { companyEmailSchema } from "@/lib/validation/email";

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(254),
  password: z.string().min(1, "Password is required.").max(256),
});

export const forgotPasswordSchema = z.object({
  email: companyEmailSchema,
});

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});

// Selecting a workspace level resets everything below it; deeper levels are chosen
// automatically when only one option exists.
export const contextSchema = z
  .object({
    facilityId: z.string().min(1).optional(),
    departmentId: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
  })
  .refine((v) => v.facilityId || v.departmentId || v.projectId, "Choose a plant, project or part.");
