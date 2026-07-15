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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Инициализация только один раз при появлении stats — дальнейшие re-render (poll каждые 4с) не сбрасывают выбор
  const initializedJobRef = useRef<number | null>(null);
  useEffect(() => {
    if (!stats || initializedJobRef.current === job.id) return;
    initializedJobRef.current = job.id;
    const init: Record<string, boolean> = {};
    for (const g of stats.groups) {
      init[g.sku] = g.count >= threshold;
    }
    setSelected(init);
  }, [stats, job.id, threshold]);

  if (!stats) return null;

  const selectedGroups = stats.groups.filter((g) => selected[g.sku]);
  const selectedCount = selectedGroups.reduce((s, g) => s + g.count, 0);
  const commonCount = (stats.total_with_pdf || 0) - selectedCount;

  async function handleGenerate() {
    setError("");
    setLoading(true);
    try {
      const batches = selectedGroups.map((g) => ({ sku: g.sku, name: g.name, codes: g.codes }));
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
          <p className="text-xs text-gray-500 mt-0.5">
            Выберите товары для отдельной пачки со внутренней накладной
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => toggleAll(true)} className="text-xs text-blue-600 hover:underline">Все</button>
          <span className="text-gray-300">|</span>
          <button onClick={() => toggleAll(false)} className="text-xs text-gray-500 hover:underline">Сбросить</button>
        </div>
      </div>

      {/* Stats summary */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-3 py-2.5">
          <p className="text-lg font-bold text-blue-700">{selectedCount}</p>
          <p className="text-xs text-blue-600">Отд. пачки</p>
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5">
          <p className="text-lg font-bold text-gray-700">{commonCount}</p>
          <p className="text-xs text-gray-500">Общая пачка</p>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
          <p className="text-lg font-bold text-amber-700">{stats.non_single_count}</p>
          <p className="text-xs text-amber-600">Неодиночных</p>
        </div>
      </div>

      {/* Product list */}
      <div className="border-2 border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-100 max-h-80 overflow-y-auto">
        {stats.groups.length === 0 && (
          <div className="py-8 text-center text-sm text-gray-400">Нет одиночных заказов</div>
        )}
        {stats.groups.map((g: SingleGroup) => (
          <label
            key={g.sku}
            className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${
              selected[g.sku] ? "bg-blue-50" : "hover:bg-gray-50"
            }`}
          >
            <input
              type="checkbox"
              checked={!!selected[g.sku]}
              onChange={(e) => setSelected((prev) => ({ ...prev, [g.sku]: e.target.checked }))}
              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">{g.name || g.sku}</p>
              <p className="text-xs text-gray-400 font-mono truncate">{g.sku}</p>
            </div>
            <span className={`shrink-0 text-sm font-bold px-2 py-0.5 rounded-full ${
              g.count >= threshold ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600"
            }`}>
              {g.count}
            </span>
          </label>
        ))}
      </div>

      {/* Info */}
      {stats.non_single_count > 0 && (
        <p className="text-xs text-gray-400 text-center">
          {stats.non_single_count} неодиночных заказов всегда идут в общую пачку
        </p>
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
          `Сформировать PDF (${selectedGroups.length > 0 ? `${selectedGroups.length} пачек + ` : ""}общая)`
        )}
      </button>
    </div>
  );
}
