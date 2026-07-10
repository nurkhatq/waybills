"use client";
import { useState } from "react";
import { api, AssemblyOrder } from "@/lib/api";
import { AppSettings } from "@/lib/settings";

function getMasterSku(offerCode: string): string {
  if (!offerCode) return "";
  const parts = offerCode.split("_");
  return parts.length > 1 ? parts.slice(0, -1).join("_") : offerCode;
}

interface Props {
  settings: AppSettings;
}

export default function AssemblyPanel({ settings }: Props) {
  const [orders, setOrders] = useState<AssemblyOrder[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [transmitting, setTransmitting] = useState(false);
  const [done, setDone] = useState<number | null>(null);

  async function handleRefresh() {
    setLoading(true);
    setDone(null);
    try {
      const data = await api.assemblyOrders(settings.city, settings.days_back);
      setOrders(data);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }

  async function handleTransmit() {
    if (!orders || orders.length === 0) return;
    if (!confirm(`Скомплектовать ${orders.length} заказов?\n\nОни перейдут в статус передачи курьеру.`)) return;
    setTransmitting(true);
    try {
      const res = await api.transmitOrders(
        settings.city,
        orders.map((o) => ({ id: o.id, code: o.code }))
      );
      const successCount = res.results.filter((r) => r.ok).length;
      setDone(successCount);
      setOrders(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setTransmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-white rounded-2xl border-2 border-gray-200 p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="font-semibold text-gray-900 text-sm">Упаковка → Передача</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Одиночные заказы без экспресса. Нажмите обновить, затем скомплектуйте.
            </p>
          </div>
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-gray-900 text-white rounded-xl hover:bg-gray-700 active:scale-95 disabled:opacity-50 transition-all"
          >
            {loading
              ? <svg className="animate-spin" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4"/></svg>
              : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
            }
            {loading ? "Загрузка..." : "Обновить"}
          </button>
        </div>
      </div>

      {/* Done state */}
      {done !== null && (
        <div className="bg-white rounded-2xl border-2 border-green-200 border-l-4 border-l-green-500 p-5 animate-fade-in">
          <div className="flex items-center gap-3">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5"><polyline points="20,6 9,17 4,12"/></svg>
            <div>
              <p className="text-sm font-semibold text-gray-900">Отправлено {done} заказов</p>
              <p className="text-xs text-gray-500 mt-0.5">Они появятся в следующей сборке накладных</p>
            </div>
          </div>
          <button onClick={handleRefresh} className="mt-3 text-xs font-medium text-gray-600 hover:text-gray-900 underline underline-offset-2">
            Проверить ещё раз
          </button>
        </div>
      )}

      {/* Empty state — not yet loaded */}
      {orders === null && !loading && done === null && (
        <div className="text-center py-12 text-gray-400">
          <svg className="mx-auto mb-3" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
          <p className="text-sm">Нажмите «Обновить» чтобы загрузить заказы</p>
        </div>
      )}

      {/* Empty state — loaded but nothing */}
      {orders !== null && orders.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          <svg className="mx-auto mb-3" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><polyline points="20,6 9,17 4,12"/></svg>
          <p className="text-sm font-medium text-gray-500">Нет заказов в упаковке</p>
          <p className="text-xs mt-1">Одиночные не-экспресс заказы отсутствуют</p>
        </div>
      )}

      {/* Orders list */}
      {orders !== null && orders.length > 0 && (
        <>
          <div className="space-y-2">
            {orders.map((order, idx) => {
              const master = getMasterSku(order.offer_code);
              return (
                <div key={order.id} className="bg-white rounded-2xl border-2 border-gray-200 px-4 py-3 flex items-center gap-3">
                  <span className="shrink-0 w-6 text-right text-xs text-gray-300 tabular-nums font-mono">{idx + 1}</span>
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
                    <div className="text-xs font-semibold text-gray-900 tabular-nums">
                      {order.base_price > 0 ? order.base_price.toLocaleString("ru-RU") + " ₸" : ""}
                    </div>
                    <div className="text-[10px] text-gray-400 mt-0.5">{order.quantity} шт</div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Transmit button */}
          <button
            onClick={handleTransmit}
            disabled={transmitting}
            className="w-full flex items-center justify-center gap-2 py-3 text-sm font-semibold bg-gray-900 text-white rounded-2xl hover:bg-gray-700 active:scale-[0.98] disabled:opacity-50 transition-all"
          >
            {transmitting
              ? <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4"/></svg>
              : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg>
            }
            {transmitting ? "Отправка..." : `Скомплектовать все (${orders.length})`}
          </button>
        </>
      )}
    </div>
  );
}
