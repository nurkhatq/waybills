"use client";
import StatusBadge from "./StatusBadge";
import { Job, api } from "@/lib/api";

const CITY_LABEL: Record<string, string> = {
  almaty: "Алматы",
  astana: "Астана",
  shymkent: "Шымкент",
};

interface Props {
  job: Job;
  onRetry: (job: Job) => void;
  retrying: boolean;
}

export default function JobCard({ job, onRetry, retrying }: Props) {
  const date = new Date(job.created_at + "Z").toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  const canRetry = ["done", "error", "pdf_ready"].includes(job.status);
  const isRunning = ["pending", "parsing"].includes(job.status);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-gray-900">#{job.id}</span>
          <span className="text-gray-500">·</span>
          <span className="font-medium text-gray-700">{CITY_LABEL[job.city] ?? job.city}</span>
          {job.test_mode && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
              TEST ×{job.test_limit}
            </span>
          )}
          <StatusBadge status={job.status} />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-gray-400">{date}</span>
          {canRetry && (
            <button
              onClick={() => onRetry(job)}
              disabled={retrying}
              className="text-xs px-3 py-1.5 rounded-lg border border-blue-200 text-blue-600 hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {retrying ? "..." : "Повторить"}
            </button>
          )}
        </div>
      </div>

      {/* Stats */}
      {job.orders_found > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {[
            { label: "Найдено", value: job.orders_found },
            { label: "Группа A", value: job.group_a_count },
            { label: "Группа B", value: job.group_b_count },
            { label: "Группа C", value: job.group_c_count },
            { label: "Чужой ПВЗ", value: job.orders_filtered_pickup },
            { label: "Переданы", value: job.orders_filtered_transmitted },
          ].map((s) => (
            <div key={s.label} className="bg-gray-50 rounded-lg p-2.5 text-center">
              <div className="text-xs text-gray-400 mb-0.5">{s.label}</div>
              <div className="text-lg font-semibold text-gray-900">{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Progress bar for running jobs */}
      {isRunning && (
        <div className="w-full bg-gray-100 rounded-full h-1">
          <div className="bg-blue-500 h-1 rounded-full animate-pulse w-1/2" />
        </div>
      )}

      {/* PDF files */}
      {job.pdf_files.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {job.pdf_files.map((f) => (
            <a
              key={f}
              href={api.pdfUrl(job.id, f)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-sm hover:bg-blue-100 transition"
            >
              <span>📄</span>
              <span>{f}</span>
            </a>
          ))}
        </div>
      )}

      {/* Error */}
      {job.error && (
        <div className="bg-red-50 border border-red-100 rounded-lg p-3">
          <p className="text-xs font-medium text-red-700 mb-1">Ошибка</p>
          <pre className="text-xs text-red-600 whitespace-pre-wrap break-all">{job.error}</pre>
        </div>
      )}
    </div>
  );
}
