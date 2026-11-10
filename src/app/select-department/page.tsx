import { redirect } from "next/navigation";

export default function LegacySelectDepartmentRedirect() {
  redirect("/app/workspace");
}
