import { redirect } from "next/navigation";

export default function LegacySelectProjectRedirect() {
  redirect("/app/projects");
}
