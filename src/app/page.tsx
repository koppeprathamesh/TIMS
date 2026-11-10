import { redirect } from "next/navigation";
import { getRequestContext } from "@/lib/authz/authorize";
import { resolveWorkspace } from "@/lib/auth/workspace";
import { AppError } from "@/lib/errors";
import { workspaceDestination } from "@/lib/navigation";

export const instant = false;

export default async function Home() {
  let ctx;
  try {
    ctx = await getRequestContext();
  } catch (error) {
    if (error instanceof AppError && error.status === 401) redirect("/login");
    throw error;
  }
  const workspace = await resolveWorkspace(ctx);
  redirect(workspaceDestination({
    ...workspace,
    organization: ctx.organizationId ? { id: ctx.organizationId, name: "" } : null,
  }));
}
