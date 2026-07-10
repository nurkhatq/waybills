"use client";
import { useState } from "react";
import { Job, api } from "@/lib/api";

const CITY_LABEL: Record<string, string> = {
  almaty: "Алматы",
  astana: "Астана",
  shymkent: "Шымкент",
};

const STATUS: Record<string, { label: string; color: string; border: string }> = {
  pending:   { label: "Ожидание",  color: "text-yellow-700 bg-yellow-100", border: "border-l-yellow-400" },
  parsing:   { label: "Обработка", color: "text-blue-700 bg-blue-100",     border: "border-l-blue-400" },
  pdf_ready: { label: "Готов",     color: "text-gray-700 bg-gray-100",     border: "border-l-gray-300" },
  done:      { label: "Готово",    color: "text-gray-700 bg-gray-100",     border: "border-l-gray-300" },
  error:     { label: "Ошибка",   color: "text-red-700 bg-red-100",       border: "border-l-red-500" },
};

interface Props {
  job: Job;
  onRetry: (job: Job) => void;
  retrying: boolean;
  onMarkPrinted: (job: Job) => void;
}

export default function JobCard({ job, onRetry, retrying, onMarkPrinted }: Props) {
  const [printingFile, setPrintingFile] = useState<string | null>(null);
  const [marking, setMarking] = useState(false);

  async function handleMarkPrinted() {
    if (!confirm("Подтвердите: накладные распечатаны?\n\nЭти заказы не войдут в следующую сборку.")) return;
    setMarking(true);
    try { onMarkPrinted(await api.markPrinted(job.id)); }
    catch (err) { alert(err instanceof Error ? err.message : "Ошибка"); }
    finally { setMarking(false); }
  }

  async function handleUnmarkPrinted() {
    if (!confirm("Отменить отметку «Напечатано»?\n\nЭти заказы снова войдут в следующую сборку.")) return;
    setMarking(true);
    try { onMarkPrinted(await api.unmarkPrinted(job.id)); }
    catch (err) { alert(err instanceof Error ? err.message : "Ошибка"); }
    finally { setMarking(false); }
  }

  async function handlePrint(filename: string) {
    setPrintingFile(filename);
    try { await api.printPdf(job.id, filename); }
    catch (err) { alert(err instanceof Error ? err.message : "Ошибка печати"); }
    finally { setPrintingFile(null); }
  }

  const st = STATUS[job.status] ?? { label: job.status, color: "text-gray-600 bg-gray-100", border: "border-l-gray-300" };
  const isRunning      = ["pending", "parsing"].includes(job.status);
  const canRetry       = ["done", "error", "pdf_ready"].includes(job.status);
  const canMarkPrinted = ["pdf_ready", "done"].includes(job.status) && !job.printed_at;
  const isPrinted      = !!job.printed_at;
  const pct            = job.progress ?? 0;

  // Показываем фактически напечатанных (после дедупликации), иначе найденных
  const displayCount = job.orders_printed ?? (job.orders_found > 0 ? job.orders_found : null);

  const borderClass = isPrinted ? "border-l-green-600" : st.border;

  const date = new Date(job.created_at + "Z").toLocaleString("ru-RU", {
    day: "2-digit", month: "2-digit", year: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });

  return (
    <div className={`bg-white rounded-2xl border-2 border-gray-200 border-l-4 ${borderClass} overflow-hidden animate-slide-up hover:shadow-md transition-shadow`}>

      {/* Progress */}
      {isRunning && (
        <div className="px-5 pt-4">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-gray-500">{job.progress_label || "Обрабатываем..."}</span>
            <span className="text-xs font-semibold text-gray-700 tabular-nums">{pct}%</span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
            <div className="h-full bg-gray-900 rounded-full transition-all duration-700 ease-out" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      <div className="p-5">
        <div className="flex items-start gap-4">

          {/* Count */}
          <div className="shrink-0 w-16 text-center">
            {displayCount != null ? (
              <>
                <div className="text-3xl font-bold text-gray-900 leading-none">{displayCount}</div>
                <div className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mt-1">накл.</div>
              </>
            ) : isRunning ? (
              <div className="w-10 h-8 rounded-lg animate-shimmer mx-auto" />
            ) : (
              <div className="text-2xl font-bold text-gray-300">—</div>
            )}
          </div>

          {/* Info + actions */}
          <div className="flex-1 min-w-0">

            {/* Header row */}
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-mono text-gray-400">#{job.id}</span>
                <span className="font-semibold text-gray-900 text-sm">{CITY_LABEL[job.city] ?? job.city}</span>
                {job.test_mode && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 uppercase tracking-wide">
                    Test ×{job.test_limit}
                  </span>
                )}
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${st.color}`}>{st.label}</span>
              </div>
              <time className="text-xs text-gray-400 tabular-nums shrink-0">{date}</time>
            </div>

            {/* Actions */}
            <div className="mt-3 flex flex-wrap items-center gap-2">

              {/* PDF files */}
              {job.pdf_files.map((f) => (
                <div key={f} className="flex items-center rounded-xl border-2 border-gray-200 overflow-hidden">
                  <button
                    onClick={() => handlePrint(f)}
                    disabled={!!printingFile}
                    className="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-white bg-gray-900 hover:bg-gray-800 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  >
                    {printingFile === f
                      ? <svg className="animate-spin" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4"/></svg>
                      : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6,9 6,2 18,2 18,9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
                    }
                    {printingFile === f ? "Загрузка..." : "Печать"}
                  </button>
                  <a href={api.pdfUrl(job.id, f)} target="_blank" rel="noreferrer" title="Открыть PDF"
                     className="px-3 py-2 text-gray-400 hover:text-gray-700 hover:bg-gray-50 border-l-2 border-gray-200 transition-colors">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15,3 21,3 21,9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                  </a>
                </div>
              ))}

              {/* Retry */}
              {canRetry && (
                <button onClick={() => onRetry(job)} disabled={retrying}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-xl border-2 border-gray-200 text-gray-600 hover:border-gray-400 hover:text-gray-900 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed transition-all">
                  {retrying
                    ? <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M2 12h4"/></svg>
                    : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                  }
                  Повторить
                </button>
              )}

              {/* Mark printed */}
              {canMarkPrinted && (
                <button onClick={handleMarkPrinted} disabled={marking}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl border-2 border-gray-300 text-gray-700 hover:border-gray-900 hover:text-gray-900 active:scale-95 disabled:opacity-40 transition-all">
                  {marking
                    ? <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M2 12h4"/></svg>
                    : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20,6 9,17 4,12"/></svg>
                  }
                  Напечатано
                </button>
              )}
            </div>

            {/* Error */}
            {job.error && (
              <div className="mt-3 border-2 border-red-200 bg-red-50 rounded-xl p-3">
                <p className="text-xs font-semibold text-red-700 mb-1">Ошибка</p>
                <pre className="text-xs text-red-600/80 whitespace-pre-wrap break-all leading-relaxed">{job.error}</pre>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Printed footer */}
      {isPrinted && (
        <div className="flex items-center justify-between px-5 py-2.5 bg-green-700 border-t-2 border-green-700">
          <div className="flex items-center gap-2 text-white text-xs font-semibold">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20,6 9,17 4,12"/></svg>
            Накладные напечатаны
          </div>
          <button
            onClick={handleUnmarkPrinted}
            disabled={marking}
            className="text-green-200 hover:text-white text-xs underline underline-offset-2 disabled:opacity-50 transition-colors"
          >
            {marking ? "..." : "отменить"}
          </button>
        </div>
      )}
    </div>
  );
}
