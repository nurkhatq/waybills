"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { api, picker, PrintJob, loadUser } from "@/lib/api";

/*
 * Принт-станция — страница для ноутбука с USB-принтером.
 * Опрашивает очередь каждые 5 сек, печатает автоматически.
 *
 * Для печати без диалога запустить Chrome с флагом:
 *   chrome.exe --kiosk-printing http://<SITE>/print-station
 */

const POLL_INTERVAL_MS = 5_000;
const PRINT_COOLDOWN_MS = 20_000; // ждём после window.print() перед следующим

export default function PrintStationPage() {
  const router = useRouter();
  const [city, setCity] = useState<string>("");
  const [queue, setQueue] = useState<PrintJob[]>([]);
  const [printing, setPrinting] = useState<PrintJob | null>(null);
  const [history, setHistory] = useState<{ job: PrintJob; at: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  const busyRef = useRef(false);
  const cityRef = useRef("");

  useEffect(() => {
    const u = loadUser();
    if (!u) { router.replace("/login"); return; }
    setCity(u.city);
    cityRef.current = u.city;
  }, [router]);

  const poll = useCallback(async () => {
    const c = cityRef.current;
    if (!c) return;
    try {
      const jobs = await picker.printQueue(c);
      setQueue(jobs);
      setConnected(true);
      setError(null);
    } catch (e) {
      setConnected(false);
      setError(e instanceof Error ? e.message : "Ошибка связи с сервером");
    }
  }, []);

  // Polling
  useEffect(() => {
    if (!city) return;
    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [city, poll]);

  // Print processor — берём по одному из очереди
  useEffect(() => {
    if (busyRef.current || queue.length === 0) return;
    const job = queue[0];
    processPrint(job);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue]);

  async function processPrint(job: PrintJob) {
    if (busyRef.current) return;
    busyRef.current = true;
    setPrinting(job);

    try {
      await api.printPdf(job.waybill_job_id, job.filename);
    } catch (e) {
      setError(`Ошибка печати ${job.filename}: ${e instanceof Error ? e.message : e}`);
    }

    // Небольшая пауза чтобы принтер успел принять задание
    await new Promise(r => setTimeout(r, PRINT_COOLDOWN_MS));

    try {
      await picker.printJobDone(job.id);
    } catch {}

    setHistory(prev => [
      { job, at: new Date().toLocaleTimeString("ru-RU") },
      ...prev.slice(0, 19),
    ]);
    setQueue(prev => prev.filter(j => j.id !== job.id));
    setPrinting(null);
    busyRef.current = false;
  }

  const pendingCount = queue.length - (printing ? 1 : 0);

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      {/* Header */}
      <div className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🖨</span>
          <div>
            <h1 className="text-lg font-bold">Принт-станция</h1>
            <p className="text-xs text-gray-400">{city}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${connected ? "bg-green-400" : "bg-red-500"}`} />
          <span className="text-xs text-gray-400">{connected ? "Подключено" : "Нет связи"}</span>
        </div>
      </div>

      <div className="flex-1 p-6 space-y-6 max-w-xl mx-auto w-full">
        {error && (
          <div className="bg-red-900/50 border border-red-700 rounded-xl p-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* Печать в процессе */}
        {printing ? (
          <div className="bg-blue-900/40 border-2 border-blue-500 rounded-2xl p-6 text-center space-y-3">
            <div className="text-4xl animate-pulse">🖨</div>
            <p className="font-semibold text-blue-200 text-lg">Печать…</p>
            <p className="text-blue-300 font-mono text-sm break-all">{printing.filename}</p>
            <p className="text-xs text-blue-400">Задание #{printing.id}</p>
          </div>
        ) : (
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 text-center space-y-2">
            <div className="text-3xl">✅</div>
            <p className="text-gray-400 text-sm">Готова к печати</p>
          </div>
        )}

        {/* Очередь */}
        {pendingCount > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-gray-500 uppercase tracking-wide">В очереди ({pendingCount})</p>
            {queue.slice(printing ? 1 : 0).map(j => (
              <div key={j.id} className="bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 flex items-center gap-3">
                <span className="text-gray-500 text-sm">#{j.id}</span>
                <span className="text-gray-300 font-mono text-sm flex-1 truncate">{j.filename}</span>
              </div>
            ))}
          </div>
        )}

        {/* История */}
        {history.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs text-gray-600 uppercase tracking-wide">Напечатано сегодня</p>
            {history.map((h, i) => (
              <div key={i} className="flex items-center gap-3 text-xs text-gray-600">
                <span className="text-green-600">✓</span>
                <span className="font-mono flex-1 truncate">{h.job.filename}</span>
                <span>{h.at}</span>
              </div>
            ))}
          </div>
        )}

        {/* Подсказка */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-xs text-gray-500 space-y-1">
          <p className="font-semibold text-gray-400">Для авто-печати без диалога:</p>
          <p className="font-mono break-all">chrome.exe --kiosk-printing --app=https://&lt;SITE&gt;/print-station</p>
          <p className="mt-2">Принтер должен быть установлен как принтер по умолчанию в Windows.</p>
        </div>
      </div>
    </div>
  );
}
