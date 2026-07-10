"use client";
import { useState } from "react";
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

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-gray-50 rounded-lg p-2.5 text-center min-w-0">
      <div className="text-[10px] font-medium text-gray-400 uppercase tracking-wide truncate">{label}</div>
      <div className="text-base font-semibold text-gray-900 mt-0.5">{value}</div>
    </div>
  );
}

export default function JobCard({ job, onRetry, retrying }: Props) {
  const [printingFile, setPrintingFile] = useState<string | null>(null);

  const date = new Date(job.created_at + "Z").toLocaleString("ru-RU", {
    day: "2-digit", month: "2-digit", year: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });

  const isRunning = ["pending", "parsing"].includes(job.status);
  const canRetry  = ["done", "error", "pdf_ready"].includes(job.status);

  async function handlePrint(filename: string) {
    setPrintingFile(filename);
    try {
      await api.printPdf(job.id, filename);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Ошибка печати");
    } finally {
      setPrintingFile(null);
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm overflow-hidden animate-slide-up">
      {/* Running progress bar */}
      {isRunning && (
        <div className="h-0.5 bg-gray-100 relative overflow-hidden">
          <div className="absolute inset-y-0 left-0 w-1/2 bg-blue-400 rounded-full animate-[shimmer_1.8s_ease-in-out_infinite]"
               style={{ backgroundImage: "linear-gradient(90deg, transparent, rgba(255,255,255,0.6), transparent)", backgroundSize: "200% 100%" }} />
        </div>
      )}

      <div className="p-5 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <span className="text-xs font-mono text-gray-400 shrink-0">#{job.id}</span>
            <span className="font-semibold text-gray-900 shrink-0">{CITY_LABEL[job.city] ?? job.city}</span>
            {job.test_mode && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-700 tracking-wide uppercase">
                Test ×{job.test_limit}
              </span>
            )}
            <StatusBadge status={job.status} />
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <time className="text-xs text-gray-400 tabular-nums">{date}</time>
            {canRetry && (
              <button
                onClick={() => onRetry(job)}
                disabled={retrying}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-300 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-150"
              >
                {retrying ? (
                  <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4"/></svg>
                ) : (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                )}
                Повторить
              </button>
            )}
          </div>
        </div>

        {/* Stats */}
        {job.orders_found > 0 && (
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            <Stat label="Найдено"   value={job.orders_found} />
            <Stat label="Группа A"  value={job.group_a_count} />
            <Stat label="Группа B"  value={job.group_b_count} />
            <Stat label="Группа C"  value={job.group_c_count} />
            <Stat label="Чужой ПВЗ" value={job.orders_filtered_pickup} />
            <Stat label="Переданы"  value={job.orders_filtered_transmitted} />
          </div>
        )}

        {/* PDF files */}
        {job.pdf_files.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {job.pdf_files.map((f) => (
              <div key={f} className="flex items-center gap-1 bg-gray-50 border border-gray-200 rounded-xl pl-3 pr-1 py-1 overflow-hidden">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" className="shrink-0"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>
                <span className="text-xs text-gray-500 max-w-[180px] truncate">{f}</span>

                <button
                  onClick={() => handlePrint(f)}
                  disabled={printingFile === f}
                  className="ml-1 inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#0071e3] text-white text-xs font-semibold rounded-lg hover:bg-[#0060c0] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-150"
                >
                  {printingFile === f ? (
                    <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4"/></svg>
                  ) : (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6,9 6,2 18,2 18,9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
                  )}
                  {printingFile === f ? "Загрузка..." : "Печать"}
                </button>

                <a
                  href={api.pdfUrl(job.id, f)}
                  target="_blank"
                  rel="noreferrer"
                  title="Открыть PDF"
                  className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15,3 21,3 21,9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                </a>
              </div>
            ))}
          </div>
        )}

        {/* Error */}
        {job.error && (
          <div className="bg-red-50 border border-red-100 rounded-xl p-3.5">
            <div className="flex items-center gap-1.5 mb-1.5">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              <span className="text-xs font-semibold text-red-700">Ошибка</span>
            </div>
            <pre className="text-xs text-red-600/80 whitespace-pre-wrap break-all leading-relaxed">{job.error}</pre>
          </div>
        )}
      </div>
    </div>
  );
}
