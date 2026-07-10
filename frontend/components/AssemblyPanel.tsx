"use client";
import { useState, useEffect, useCallback } from "react";
import { api, AssemblyJob, AssemblyOrderItem } from "@/lib/api";
import { AppSettings } from "@/lib/settings";

const PAGE_SIZE = 50;

function getMasterSku(offerCode: string): string {
  if (!offerCode) return "";
  const parts = offerCode.split("_");
  return parts.length > 1 ? parts.slice(0, -1).join("_") : offerCode;
}

const STATUS_RUNNING = ["pending", "fetching", "transmitting"];

interface Props {
  settings: AppSettings;
}

export default function AssemblyPanel({ settings }: Props) {
  const [job, setJob] = useState<AssemblyJob | null>(null);
  const [orders, setOrders] = useState<AssemblyOrderItem[]>([]);
  const [totalOrders, setTotalOrders] = useState(0);
  const [page, setPage] = useState(0);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [starting, setStarting] = useState(false);

  // Poll job status while running
  useEffect(() => {
    if (!job || !STATUS_RUNNING.includes(job.status)) return;
    const timer = setInterval(async () => {
      try {
        const updated = await api.getAssemblyJob(job.id);
        setJob(updated);
      } catch { /* ignore */ }
    }, 3000);
    return () => clearInterval(timer);
  }, [job]);

  // Load orders when job is ready/done and page changes
  useEffect(() => {
    if (!job || !["ready", "done"].includes(job.status)) return;
    setLoadingOrders(true);
    api.getAssemblyJobOrders(job.id, page, PAGE_SIZE)
      .then((res) => {
        setOrders(res.orders);
        setTotalOrders(res.total);
      })
      .catch(() => {})
      .finally(() => setLoadingOrders(false));
  }, [job?.id, job?.status, page]);

  // Load latest job on mount
  useEffect(() => {
    api.getLatestAssemblyJob(settings.city)
      .then((j) => { if (j) setJob(j); })
      .catch(() => {});
  }, [settings.city]);

  async function handleFetch() {
    setStarting(true);
    setOrders([]);
    setTotalOrders(0);
    setPage(0);
    try {
      const j = await api.startAssemblyFetch(settings.city);
      setJob(j);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setStarting(false);
    }
  }

  async function handleTransmit() {
    if (!job || job.orders_found === 0) return;
    if (!confirm(`Скомплектовать ${job.orders_found} заказов?\n\nОни перейдут в статус передачи курьеру.`)) return;
    try {
      const updated = await api.startAssemblyTransmit(job.id);
      setJob(updated);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Ошибка");
    }
  }

  const isRunning = job && STATUS_RUNNING.includes(job.status);
  const isReady = job?.status === "ready";
  const isDone = job?.status === "done";
  const isError = job?.status === "error";
  const totalPages = Math.ceil(totalOrders / PAGE_SIZE);

  return (
    <div className="space-y-3">

      {/* Top action bar */}
      <div className="bg-white rounded-2xl border-2 border-gray-200 p-4">
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-900">Упаковка → Передача</p>
            <p className="text-xs text-gray-400 mt-0.5">Одиночные заказы без экспресса</p>
          </div>

          {/* Transmit button — shown when ready */}
          {isReady && job.orders_found > 0 && (
            <button
              onClick={handleTransmit}
              className="flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-gray-900 text-white rounded-xl hover:bg-gray-700 active:scale-95 transition-all"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg>
              Скомплектовать все ({job.orders_found})
            </button>
          )}

          {/* Refresh button */}
          <button
            onClick={handleFetch}
            disabled={!!isRunning || starting}
            className="flex items-center gap-2 px-4 py-2 text-xs font-semibold border-2 border-gray-200 text-gray-700 rounded-xl hover:border-gray-400 hover:text-gray-900 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            {starting || (job?.status === "fetching") || (job?.status === "pending")
              ? <svg className="animate-spin" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4"/></svg>
              : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
            }
            Обновить
          </button>
        </div>

        {/* Progress bar */}
        {isRunning && (
          <div className="mt-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-gray-500">{job.progress_label || "Обрабатываем..."}</span>
              <span className="text-xs font-semibold text-gray-700 tabular-nums">{job.progress}%</span>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
              <div
                className="h-full bg-gray-900 rounded-full transition-all duration-700 ease-out"
                style={{ width: `${job.progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Done state */}
        {isDone && (
          <div className="mt-3 flex items-center gap-2 text-xs text-green-700">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20,6 9,17 4,12"/></svg>
            Скомплектовано {job.orders_transmitted} из {job.orders_found} заказов. Они появятся в следующей сборке накладных.
          </div>
        )}

        {/* Error state */}
        {isError && (
          <div className="mt-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
            {job?.error || "Неизвестная ошибка"}
          </div>
        )}
      </div>

      {/* No job yet */}
      {!job && !starting && (
        <div className="text-center py-12 text-gray-400">
          <svg className="mx-auto mb-3" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
          <p className="text-sm">Нажмите «Обновить» чтобы загрузить заказы</p>
        </div>
      )}

      {/* Empty result */}
      {(isReady || isDone) && job.orders_found === 0 && (
        <div className="text-center py-12 text-gray-400">
          <svg className="mx-auto mb-3" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><polyline points="20,6 9,17 4,12"/></svg>
          <p className="text-sm font-medium text-gray-500">Нет заказов в упаковке</p>
        </div>
      )}

      {/* Orders list with pagination */}
      {(isReady || isDone || job?.status === "transmitting") && totalOrders > 0 && (
        <div className="space-y-2">
          {loadingOrders && (
            <div className="flex justify-center py-6">
              <div className="w-6 h-6 border-2 border-gray-200 border-t-gray-900 rounded-full animate-spin" />
            </div>
          )}

          {!loadingOrders && orders.map((order, idx) => {
            const master = getMasterSku(order.offer_code || "");
            const globalIdx = page * PAGE_SIZE + idx + 1;
            return (
              <div
                key={order.id}
                className={`bg-white rounded-2xl border-2 px-4 py-3 flex items-center gap-3 transition-colors ${
                  order.transmitted
                    ? order.transmitted_ok
                      ? "border-green-200 bg-green-50/30"
                      : "border-red-200 bg-red-50/30"
                    : "border-gray-200"
                }`}
              >
                <span className="shrink-0 w-7 text-right text-xs text-gray-300 tabular-nums font-mono">{globalIdx}</span>

                {order.transmitted && (
                  <span className="shrink-0">
                    {order.transmitted_ok
                      ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5"><polyline points="20,6 9,17 4,12"/></svg>
                      : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    }
                  </span>
                )}

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs text-gray-500">{order.code}</span>
                    {master && (
                      <span className="text-[10px] font-mono bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">{master}</span>
                    )}
                  </div>
                  <p className="text-sm font-medium text-gray-900 mt-0.5 truncate">{order.name || "—"}</p>
                </div>

                <div className="shrink-0 text-right">
                  {order.base_price > 0 && (
                    <div className="text-xs font-semibold text-gray-900 tabular-nums">
                      {order.base_price.toLocaleString("ru-RU")} ₸
                    </div>
                  )}
                  <div className="text-[10px] text-gray-400 mt-0.5">{order.quantity} шт</div>
                </div>
              </div>
            );
          })}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border-2 border-gray-200 rounded-xl text-gray-600 hover:border-gray-400 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15,18 9,12 15,6"/></svg>
                Назад
              </button>
              <span className="text-xs text-gray-400 tabular-nums">
                {page + 1} / {totalPages} · {totalOrders} заказов
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border-2 border-gray-200 rounded-xl text-gray-600 hover:border-gray-400 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              >
                Вперёд
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9,18 15,12 9,6"/></svg>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
