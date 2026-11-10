export default function NotConfiguredState({ title }: { title: string }) {
  return (
    <div className="card mx-auto max-w-2xl p-8 text-center">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-[var(--color-text-muted)]">
        This module is not yet configured for this deployment. It is permission-gated and will be
        enabled in a future phase — no functionality is being represented as complete here.
      </p>
    </div>
  );
}
