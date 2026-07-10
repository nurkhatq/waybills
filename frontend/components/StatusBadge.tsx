const STATUS: Record<string, { label: string; dot: string; bg: string; text: string; pulse?: boolean }> = {
  pending:   { label: "Ожидание",  dot: "bg-yellow-400",  bg: "bg-yellow-50",  text: "text-yellow-700", pulse: true },
  parsing:   { label: "Обработка", dot: "bg-blue-400",    bg: "bg-blue-50",    text: "text-blue-700",   pulse: true },
  pdf_ready: { label: "PDF готов", dot: "bg-green-400",   bg: "bg-green-50",   text: "text-green-700" },
  done:      { label: "Готово",    dot: "bg-emerald-400", bg: "bg-emerald-50", text: "text-emerald-700" },
  error:     { label: "Ошибка",   dot: "bg-red-400",     bg: "bg-red-50",     text: "text-red-700" },
  queued:    { label: "В очереди", dot: "bg-gray-300",    bg: "bg-gray-100",   text: "text-gray-600" },
  claimed:   { label: "Занято",   dot: "bg-indigo-400",  bg: "bg-indigo-50",  text: "text-indigo-700" },
};

export default function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, dot: "bg-gray-300", bg: "bg-gray-100", text: "text-gray-600" };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${s.bg} ${s.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot} ${s.pulse ? "animate-[pulse-dot_1.5s_ease-in-out_infinite]" : ""}`} />
      {s.label}
    </span>
  );
}
