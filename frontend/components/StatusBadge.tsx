const STATUS_MAP: Record<string, { label: string; className: string }> = {
  pending:   { label: "Ожидание",   className: "bg-yellow-100 text-yellow-800" },
  parsing:   { label: "Парсинг",    className: "bg-orange-100 text-orange-800" },
  pdf_ready: { label: "PDF готов",  className: "bg-green-100 text-green-800" },
  printing:  { label: "Печать",     className: "bg-blue-100 text-blue-800" },
  done:      { label: "Готово",     className: "bg-emerald-100 text-emerald-800" },
  error:     { label: "Ошибка",     className: "bg-red-100 text-red-800" },
  queued:    { label: "В очереди",  className: "bg-gray-100 text-gray-700" },
  claimed:   { label: "Занято",     className: "bg-indigo-100 text-indigo-800" },
};

export default function StatusBadge({ status }: { status: string }) {
  const s = STATUS_MAP[status] ?? { label: status, className: "bg-gray-100 text-gray-700" };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${s.className}`}>
      {s.label}
    </span>
  );
}
