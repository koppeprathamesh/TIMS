import ToolForm from "@/components/forms/ToolForm";

export default function NewToolPage() {
  return (
    <div className="mx-auto max-w-3xl px-2 py-6">
      <h1 className="page-heading mb-4 text-2xl font-semibold">Add Tool</h1>
      <ToolForm mode="create" />
    </div>
  );
}
