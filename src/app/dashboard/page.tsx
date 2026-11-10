import { redirect } from "next/navigation";

export default function LegacyDashboardRedirect() {
  redirect("/app/dashboard");
}
