import { z } from "zod";
import { ROLES } from "@/lib/authz/permissions";
import { companyEmailSchema } from "@/lib/validation/email";

export const passwordSchema = z
  .string()
  .min(10, "Password must be at least 10 characters.")
  .max(128, "Password must be at most 128 characters.")
  .regex(/[A-Za-z]/, "Password must contain a letter.")
  .regex(/\d/, "Password must contain a digit.");

const idList = z.array(z.string().min(1)).max(200);

// Only these roles can be created through the API; Super Admins are provisioned out of band.
export const creatableRoleSchema = z.enum([ROLES.INVENTORY_ADMIN, ROLES.USER]);

export const createUserSchema = z
  .object({
    email: companyEmailSchema,
    displayName: z.string().trim().min(1, "Display name is required.").max(100),
    password: passwordSchema,
    role: creatableRoleSchema,
    // Inventory Admin: facilities they may manage.
    facilityIds: idList.default([]),
    // User: departments they may view.
    departmentIds: idList.default([]),
  })
  .superRefine((v, ctx) => {
    if (v.role === ROLES.INVENTORY_ADMIN && v.facilityIds.length === 0) {
      ctx.addIssue({ code: "custom", path: ["facilityIds"], message: "Assign at least one plant." });
    }
    if (v.role === ROLES.USER && v.departmentIds.length === 0) {
      ctx.addIssue({ code: "custom", path: ["departmentIds"], message: "Assign at least one project." });
    }
  });

export const updateUserSchema = z
  .object({
    displayName: z.string().trim().min(1).max(100).optional(),
    status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
    password: passwordSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update.");

export const setUserAccessSchema = z
  .object({
    facilityIds: idList.optional(),
    departmentIds: idList.optional(),
  })
  .refine((v) => v.facilityIds !== undefined || v.departmentIds !== undefined, "Nothing to update.");

export const updateOrganizationSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(200),
});

// Images are either an http(s) URL or a small uploaded raster image encoded as a data URL.
const MAX_IMAGE_DATA_URL_LENGTH = 700_000;
export const imageUrlSchema = z
  .string()
  .trim()
  .max(MAX_IMAGE_DATA_URL_LENGTH, "Image is too large.")
  .refine(
    (v) => /^https?:\/\/\S+$/i.test(v) || /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(v),
    "Image must be an http(s) URL or an uploaded PNG, JPEG, WebP or GIF."
  );

const codeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9_-]{1,39}$/, "Code must be 2-40 characters: A-Z, 0-9, hyphens and underscores.");

const nameSchema = z.string().trim().min(1, "Name is required.").max(200);
const descriptionSchema = z.string().trim().max(2000);

const nullableImage = imageUrlSchema.nullable();
const nullableDescription = descriptionSchema.nullable();

export const createFacilitySchema = z.object({
  name: nameSchema,
  code: codeSchema,
  description: nullableDescription.optional(),
  imageUrl: nullableImage.optional(),
});

export const updateFacilitySchema = z
  .object({
    name: nameSchema.optional(),
    description: nullableDescription.optional(),
    imageUrl: nullableImage.optional(),
    status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update.");

export const createDepartmentSchema = z.object({
  facilityId: z.string().min(1, "Plant is required."),
  name: nameSchema,
  code: codeSchema,
  description: nullableDescription.optional(),
  imageUrl: nullableImage.optional(),
});

export const updateDepartmentSchema = z
  .object({
    name: nameSchema.optional(),
    description: nullableDescription.optional(),
    imageUrl: nullableImage.optional(),
    status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update.");

export const createProjectSchema = z.object({
  departmentId: z.string().min(1, "Project is required."),
  name: nameSchema,
  code: codeSchema.optional(),
});

export const updateProjectSchema = z
  .object({
    name: nameSchema.optional(),
    status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update.");
