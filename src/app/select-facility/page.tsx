import { redirect } from "next/navigation";

export default function LegacySelectFacilityRedirect() {
  redirect("/app/workspace");
}
