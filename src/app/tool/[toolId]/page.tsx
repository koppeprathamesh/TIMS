import { redirect } from "next/navigation";

export const instant = false;

export default async function LegacyToolDetailRedirect({
  params,
}: {
  params: Promise<{ toolId: string }>;
}) {
  const { toolId } = await params;
  redirect(`/app/tools/${toolId}`);
}
