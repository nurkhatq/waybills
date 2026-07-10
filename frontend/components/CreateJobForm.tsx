"use client";
import { useState } from "react";
import { Job, api } from "@/lib/api";
import { AppSettings } from "@/lib/settings";

const CITY_LABEL: Record<string, string> = {
  almaty: "Алматы",
  astana: "Астана",
  shymkent: "Шымкент",
};

interface Props {
  settings: AppSettings;
  onCreated: (job: Job) => void;
}

export default function CreateJobForm({ settings, onCreated }: Props) {
  const [testMode, setTestMode] = useState(true);
  const [testLimit, setTestLimit] = useState(5);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const job = await api.createJob({
        city: settings.city,
        days_back: settings.days_back,
        test_mode: testMode,
        test_limit: testLimit,
        label_width_mm: settings.label_width_mm,
        label_height_mm: settings.label_height_mm,
      });
      onCreated(job);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">

      {/* Summary */}
      <div className="flex items-center gap-3 px-4 py-3.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-600">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
        <span><strong className="text-gray-900">{CITY_LABEL[settings.city] ?? settings.city}</strong></span>
        <span className="text-gray-300">·</span>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        <span>За <strong className="text-gray-900">{settings.days_back}</strong> {settings.days_back === 1 ? "день" : settings.days_back < 5 ? "дня" : "дней"}</span>
      </div>

      {/* Test mode */}
      <div className={`rounded-xl border-2 transition-all duration-200 ${testMode ? "border-amber-300 bg-amber-50" : "border-red-300 bg-red-50"}`}>
        <div className="flex items-center justify-between px-4 py-3.5">
          <div>
            <p className={`text-sm font-semibold ${testMode ? "text-amber-900" : "text-red-900"}`}>
              {testMode ? "Тестовый режим" : "Реальный режим"}
            </p>
            <p className={`text-xs mt-0.5 ${testMode ? "text-amber-700" : "text-red-600"}`}>
              {testMode
                ? `Напечатать первые ${testLimit} накладных`
                : "Принтер напечатает все накладные"}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {testMode && (
              <input
                type="number"
                value={testLimit}
                onChange={(e) => setTestLimit(Math.min(50, Math.max(1, Number(e.target.value))))}
                min={1}
                max={50}
                className="w-14 text-center text-sm font-semibold px-2 py-1.5 border-2 border-amber-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-amber-400/30"
              />
            )}
            <button
              type="button"
              onClick={() => setTestMode(!testMode)}
              className={`relative inline-flex h-7 w-12 rounded-full transition-colors duration-200 focus:outline-none ${testMode ? "bg-amber-400" : "bg-red-400"}`}
            >
              <span className={`inline-block h-5 w-5 mt-1 transform rounded-full bg-white shadow transition-transform duration-200 ${testMode ? "translate-x-6" : "translate-x-1"}`} />
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border-2 border-red-200 text-red-700 text-sm rounded-xl px-3 py-2.5">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full py-3.5 bg-gray-900 text-white text-sm font-semibold rounded-xl hover:bg-gray-800 active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-gray-900/30 focus:ring-offset-2 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-150"
      >
        {loading ? (
          <span className="inline-flex items-center gap-2 justify-center">
            <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4"/></svg>
            Создаём...
          </span>
        ) : "Собрать накладные"}
      </button>
    </form>
  );
}
