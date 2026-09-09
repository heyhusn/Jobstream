export function ComingSoon({ title, note }: { title: string; note: string }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold">{title}</h1>
      <div className="mt-6 rounded-app border border-dashed border-rule bg-raised px-6 py-10 text-center">
        <p className="text-sm leading-relaxed text-ink-70">{note}</p>
      </div>
    </div>
  );
}
