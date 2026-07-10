"use client";
import { useState, useEffect, useMemo } from "react";
import { useRouter, useParams } from "next/navigation";
import { api, Job, JobOrder } from "@/lib/api";

const CITY_LABEL: Record<string, string> = {
  almaty: "Алматы",
  astana: "Астана",
  shymkent: "Шымкент",
};

const GROUP_COLOR: Record<string, string> = {
  A: "text-emerald-700 bg-emerald-50 border-emerald-200",
  B: "text-blue-700 bg-blue-50 border-blue-200",
  C: "text-orange-700 bg-orange-50 border-orange-200",
};

function getEntryMaster(offerCode: string): string {
  if (!offerCode) return "";
  const parts = offerCode.split("_");
  return parts.length > 1 ? parts.slice(0, -1).join("_") : offerCode;
}

function orderMatchesSearch(order: JobOrder, q: string): boolean {
  const lower = q.toLowerCase();
  if (order.order_code.toLowerCase().includes(lower)) return true;
  if (order.waybill_number?.toLowerCase().includes(lower)) return true;
  if (order.primary_sku?.toLowerCase().includes(lower)) return true;
  for (const e of order.entries) {
    if (e.name?.toLowerCase().includes(lower)) return true;
    const code = e.offer?.code ?? "";
    if (code.toLowerCase().includes(lower)) return true;
    if (getEntryMaster(code).toLowerCase().includes(lower)) return true;
    if (e.offer?.merchantSku?.toLowerCase().includes(lower)) return true;
  }
  return false;
}

export default function JobDetailPage() {
  const router = useRouter();
  const params = useParams();
  const jobId = Number(params.id);

  const [job, setJob] = useState<Job | null>(null);
  const [orders, setOrders] = useState<JobOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState<"ALL" | "A" | "B" | "C">("ALL");

  useEffect(() => {
    async function load() {
      try {
        const [j, o] = await Promise.all([api.jobs(100), api.jobOrders(jobId)]);
        setJob(j.find((x) => x.id === jobId) ?? null);
        setOrders(o);
      } catch {
        router.replace("/?tab=history");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [jobId, router]);

  const filtered = useMemo(() => {
    let list = orders;
    if (groupFilter !== "ALL") list = list.filter((o) => o.group_letter === groupFilter);
    if (search.trim()) list = list.filter((o) => orderMatchesSearch(o, search.trim()));
    return list;
  }, [orders, groupFilter, search]);

  const groupCounts = useMemo(() => {
    const c: Record<string, number> = { A: 0, B: 0, C: 0 };
    for (const o of orders) c[o.group_letter] = (c[o.group_letter] ?? 0) + 1;
    return c;
  }, [orders]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f5f5f7] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-gray-300 border-t-gray-900 rounded-full animate-spin" />
      </div>
    );
  }

  if (!job) {
    return (
      <div className="min-h-screen bg-[#f5f5f7] flex flex-col items-center justify-center gap-4">
        <p className="text-gray-500 text-sm">Сборка не найдена</p>
        <button onClick={() => router.push("/?tab=history")} className="text-sm font-medium text-gray-900 underline">
          Вернуться
        </button>
      </div>
    );
  }

  const date = new Date(job.created_at + "Z").toLocaleString("ru-RU", {
    day: "2-digit", month: "2-digit", year: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });

  return (
    <div className="min-h-screen bg-[#f5f5f7] animate-fade-in">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-white/90 backdrop-blur-md border-b-2 border-gray-200">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => router.push("/?tab=history")}
            className="flex items-center justify-center w-8 h-8 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15,18 9,12 15,6"/></svg>
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-gray-900">Сборка #{job.id}</span>
              <span className="text-sm text-gray-500">{CITY_LABEL[job.city] ?? job.city}</span>
              <time className="text-xs text-gray-400 tabular-nums">{date}</time>
            </div>
          </div>
          {orders.length > 0 && (
            <span className="shrink-0 text-sm font-semibold text-gray-900 tabular-nums">
              {orders.length} накл.
            </span>
          )}
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-5 space-y-4">

        {orders.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-sm text-gray-500">
              Заказы не сохранены — детали доступны только для новых сборок.
            </p>
          </div>
        ) : (
          <>
            {/* Group summary */}
            <div className="flex items-center gap-2 flex-wrap">
              {(["ALL", "A", "B", "C"] as const).map((g) => {
                const count = g === "ALL" ? orders.length : (groupCounts[g] ?? 0);
                const active = groupFilter === g;
                return (
                  <button
                    key={g}
                    onClick={() => setGroupFilter(g)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border-2 text-xs font-semibold transition-all ${
                      active
                        ? "bg-gray-900 border-gray-900 text-white"
                        : "bg-white border-gray-200 text-gray-600 hover:border-gray-400"
                    }`}
                  >
                    {g === "ALL" ? "Все" : `Группа ${g}`}
                    <span className={`tabular-nums ${active ? "text-gray-300" : "text-gray-400"}`}>{count}</span>
                  </button>
                );
              })}
            </div>

            {/* Search */}
            <div className="relative">
              <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Поиск по заказу, накладной, SKU, товару..."
                className="w-full pl-9 pr-4 py-2.5 bg-white border-2 border-gray-200 rounded-xl text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-gray-400 transition-colors"
              />
              {search && (
                <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              )}
            </div>

            {/* Results count */}
            {(search || groupFilter !== "ALL") && (
              <p className="text-xs text-gray-500">
                Показано {filtered.length} из {orders.length}
              </p>
            )}

            {/* Orders list */}
            <div className="space-y-2">
              {filtered.length === 0 && (
                <div className="text-center py-12 text-sm text-gray-400">Ничего не найдено</div>
              )}
              {filtered.map((order, idx) => (
                <OrderRow key={order.id} order={order} index={idx + 1} />
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function OrderRow({ order, index }: { order: JobOrder; index: number }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="bg-white rounded-2xl border-2 border-gray-200 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
      >
        <span className="shrink-0 w-6 text-right text-xs text-gray-300 tabular-nums font-mono">{index}</span>

        <span className={`shrink-0 px-2 py-0.5 rounded border text-[11px] font-bold ${GROUP_COLOR[order.group_letter] ?? "text-gray-600 bg-gray-100 border-gray-200"}`}>
          {order.group_letter}
        </span>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-xs text-gray-500">{order.order_code}</span>
            {order.waybill_number && (
              <span className="text-xs text-gray-400">накл. {order.waybill_number}</span>
            )}
          </div>
          {order.entries.length > 0 && (
            <p className="text-xs text-gray-700 mt-0.5 truncate">
              {order.entries.map((e) => e.name).filter(Boolean).join(", ")}
            </p>
          )}
        </div>

        <div className="shrink-0 flex items-center gap-2">
          <span className="text-xs text-gray-400 tabular-nums">{order.total_qty} шт</span>
          <svg
            width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2.5"
            className={`transition-transform duration-200 ${open ? "rotate-90" : ""}`}
          >
            <polyline points="9,18 15,12 9,6"/>
          </svg>
        </div>
      </button>

      {open && (
        <div className="border-t-2 border-gray-100 px-4 py-3 space-y-2 bg-gray-50/50">
          {order.entries.map((e, i) => {
            const offerCode = e.offer?.code ?? "";
            const masterSku = getEntryMaster(offerCode);
            return (
              <div key={i} className="flex items-start gap-3">
                <span className="shrink-0 w-5 h-5 flex items-center justify-center rounded-full bg-gray-200 text-[10px] font-bold text-gray-600 mt-0.5">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-900">{e.name ?? "—"}</p>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {masterSku && (
                      <span className="text-[10px] font-mono text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">{masterSku}</span>
                    )}
                    {e.offer?.merchantSku && e.offer.merchantSku !== masterSku && (
                      <span className="text-[10px] font-mono text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{e.offer.merchantSku}</span>
                    )}
                    <span className="text-[10px] text-gray-500">{e.quantity} шт</span>
                    {e.unitPrice != null && (
                      <span className="text-[10px] text-gray-400">{e.unitPrice.toLocaleString("ru-RU")} ₸</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
