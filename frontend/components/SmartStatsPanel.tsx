"use client";
import { useState, useEffect, useRef } from "react";
import { api, Job, SingleGroup } from "@/lib/api";

interface Props {
  job: Job;
  threshold: number;
  onGenerated: (updated: Job) => void;
}

export default function SmartStatsPanel({ job, threshold, onGenerated }: Props) {
  const stats = job.single_stats;
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [available, setAvailable] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Инициализация один раз на job
  const initializedJobRef = useRef<number | null>(null);
  useEffect(() => {
    if (!stats || initializedJobRef.current === job.id) return;
    initializedJobRef.current = job.id;
    const initSel: Record<string, boolean> = {};
    const initAvail: Record<string, number> = {};
    for (const g of stats.groups) {
      initSel[g.sku] = g.count >= threshold;
      initAvail[g.sku] = g.count;
    }
    setSelected(initSel);
    setAvailable(initAvail);
  }, [stats, job.id, threshold]);

  if (!stats) return null;

  const selectedGroups = stats.groups.filter((g) => selected[g.sku]);
  const totalCancel = selectedGroups.reduce((s, g) => {
    const avail = available[g.sku] ?? g.count;
    return s + Math.max(0, g.count - avail);
  }, 0);
  const selectedPdfCount = selectedGroups.reduce((s, g) => {
    const avail = available[g.sku] ?? g.count;
    return s + Math.min(avail, g.count);
  }, 0);
  const commonCount = (stats.total_with_pdf || 0) - selectedPdfCount - totalCancel;

  async function handleGenerate() {
    setError("");
    setLoading(true);
    try {
      const batches = selectedGroups.map((g) => {
        const avail = available[g.sku] ?? g.count;
        return {
          sku: g.sku,
          name: g.name,
          codes: g.codes,
          available_qty: avail < g.count ? avail : undefined,
        };
      });
      const updated = await api.generateJob(job.id, batches);
      onGenerated(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setLoading(false);
    }
  }

  function toggleAll(val: boolean) {
    const next: Record<string, boolean> = {};
    for (const g of stats!.groups) next[g.sku] = val;
    setSelected(next);
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-900">Распределение по товарам</p>
          <p className="text-xs text-gray-500 mt-0.5">Выберите пачки и укажите наличие на складе</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => toggleAll(true)} className="text-xs text-blue-600 hover:underline">Все</button>
          <span className="text-gray-300">|</span>
          <button onClick={() => toggleAll(false)} className="text-xs text-gray-500 hover:underline">Сбросить</button>
        </div>
      </div>

      {/* Stats summary */}
      <div className="grid grid-cols-4 gap-1.5 text-center">
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-2 py-2">
          <p className="text-base font-bold text-blue-700">{selectedPdfCount}</p>
          <p className="text-[10px] text-blue-600 leading-tight">Пачки</p>
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded-xl px-2 py-2">
          <p className="text-base font-bold text-gray-700">{commonCount}</p>
          <p className="text-[10px] text-gray-500 leading-tight">Общая</p>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-2 py-2">
          <p className="text-base font-bold text-amber-700">{stats.non_single_count}</p>
          <p className="text-[10px] text-amber-600 leading-tight">Неодинок.</p>
        </div>
        <div className={`border rounded-xl px-2 py-2 ${totalCancel > 0 ? "bg-red-50 border-red-200" : "bg-gray-50 border-gray-200"}`}>
          <p className={`text-base font-bold ${totalCancel > 0 ? "text-red-600" : "text-gray-300"}`}>{totalCancel}</p>
          <p className={`text-[10px] leading-tight ${totalCancel > 0 ? "text-red-500" : "text-gray-400"}`}>Отмена</p>
        </div>
      </div>

      {/* Product list */}
      <div className="border-2 border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-100 max-h-96 overflow-y-auto">
        {stats.groups.length === 0 && (
          <div className="py-8 text-center text-sm text-gray-400">Нет одиночных заказов</div>
        )}
        {stats.groups.map((g: SingleGroup) => {
          const isSelected = !!selected[g.sku];
          const avail = available[g.sku] ?? g.count;
          const cancelCount = isSelected ? Math.max(0, g.count - avail) : 0;
          return (
            <div
              key={g.sku}
              className={`px-4 py-2.5 transition-colors ${isSelected ? "bg-blue-50" : "hover:bg-gray-50"}`}
            >
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={(e) => setSelected((prev) => ({ ...prev, [g.sku]: e.target.checked }))}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{g.name || g.sku}</p>
                  <p className="text-xs text-gray-400 font-mono truncate">{g.sku}</p>
                </div>

                {/* В наличии input (только для выбранных) */}
                {isSelected ? (
                  <div className="shrink-0 flex items-center gap-1.5">
                    <input
                      type="number"
                      min={0}
                      max={g.count}
                      value={avail}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setAvailable((prev) => ({
                        ...prev,
                        [g.sku]: Math.max(0, Math.min(g.count, Number(e.target.value)))
                      }))}
                      className="w-12 text-center text-xs font-semibold px-1.5 py-1 border-2 border-blue-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-400/30"
                    />
                    <span className="text-xs text-gray-400">/ {g.count}</span>
                    {cancelCount > 0 && (
                      <span className="text-xs font-semibold text-red-500 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded-full">
                        -{cancelCount}
                      </span>
                    )}
                  </div>
                ) : (
                  <span className={`shrink-0 text-sm font-bold px-2 py-0.5 rounded-full ${
                    g.count >= threshold ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600"
                  }`}>
                    {g.count}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {stats.non_single_count > 0 && (
        <p className="text-xs text-gray-400 text-center">
          {stats.non_single_count} неодиночных заказов всегда идут в общую пачку
        </p>
      )}

      {totalCancel > 0 && (
        <div className="flex items-start gap-2 bg-orange-50 border-2 border-orange-200 rounded-xl px-3 py-2.5">
          <svg className="shrink-0 mt-0.5" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f97316" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <p className="text-xs text-orange-700">
            <span className="font-semibold">{totalCancel} заказ(а)</span> будут помечены как задачи на отмену — нехватка товара на складе. Можно отменить позже вручную.
          </p>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border-2 border-red-200 text-red-700 text-sm rounded-xl px-3 py-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          {error}
        </div>
      )}

      <button
        onClick={handleGenerate}
        disabled={loading}
        className="w-full py-3 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all"
      >
        {loading ? (
          <span className="inline-flex items-center gap-2 justify-center">
            <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4"/></svg>
            Запускаем...
          </span>
        ) : (
          `Сформировать PDF (${selectedGroups.length > 0 ? `${selectedGroups.length} пачек + ` : ""}общая${totalCancel > 0 ? `, отмена ${totalCancel}` : ""})`
        )}
      </button>
    </div>
  );
}
