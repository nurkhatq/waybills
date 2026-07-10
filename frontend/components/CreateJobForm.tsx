"use client";
import { useState } from "react";
import { Config, Job, api } from "@/lib/api";

const CITY_LABEL: Record<string, string> = {
  almaty: "Алматы",
  astana: "Астана",
  shymkent: "Шымкент",
};

interface Props {
  config: Config;
  onCreated: (job: Job) => void;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}

function NumberInput({ value, onChange, min, max }: { value: number; onChange: (v: number) => void; min: number; max: number }) {
  return (
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      min={min}
      max={max}
      className="w-full px-3 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-all"
    />
  );
}

export default function CreateJobForm({ config, onCreated }: Props) {
  const isAdmin = config.role === "admin" || config.role === "manager";
  const [city, setCity] = useState(config.user_city);
  const [daysBack, setDaysBack] = useState(config.defaults.days_back);
  const [testMode, setTestMode] = useState(true);
  const [testLimit, setTestLimit] = useState(config.defaults.test_limit);
  const [labelW, setLabelW] = useState(config.defaults.label_width_mm);
  const [labelH, setLabelH] = useState(config.defaults.label_height_mm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const job = await api.createJob({ city, days_back: daysBack, test_mode: testMode, test_limit: testLimit, label_width_mm: labelW, label_height_mm: labelH });
      onCreated(job);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">

      {/* City */}
      <Field label="Склад">
        {isAdmin ? (
          <select
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className="w-full px-3 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-all"
          >
            {config.cities.map((c) => (
              <option key={c} value={c}>{CITY_LABEL[c] ?? c}</option>
            ))}
          </select>
        ) : (
          <div className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 text-gray-600 select-none">
            {CITY_LABEL[city] ?? city}
          </div>
        )}
      </Field>

      {/* Days */}
      <Field label="Период" hint={`Заказы за последние ${daysBack} ${daysBack === 1 ? "день" : daysBack < 5 ? "дня" : "дней"}`}>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={1}
            max={14}
            value={daysBack}
            onChange={(e) => setDaysBack(Number(e.target.value))}
            className="flex-1 accent-[#0071e3]"
          />
          <span className="text-sm font-semibold text-gray-900 w-6 text-right tabular-nums">{daysBack}</span>
        </div>
      </Field>

      {/* Test mode */}
      <div className={`rounded-2xl border transition-colors duration-200 ${testMode ? "bg-amber-50 border-amber-200" : "bg-red-50 border-red-200"}`}>
        <div className="flex items-center justify-between px-4 py-3">
          <div>
            <p className={`text-sm font-semibold ${testMode ? "text-amber-900" : "text-red-800"}`}>
              {testMode ? "Тестовый режим" : "Реальный режим"}
            </p>
            <p className={`text-xs mt-0.5 ${testMode ? "text-amber-700" : "text-red-600"}`}>
              {testMode ? `Будут напечатаны первые ${testLimit} накладных` : "Принтер напечатает ВСЕ накладные"}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {testMode && (
              <input
                type="number"
                value={testLimit}
                onChange={(e) => setTestLimit(Number(e.target.value))}
                min={1}
                max={50}
                className="w-14 px-2 py-1 text-sm text-center border border-amber-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-amber-400/30"
              />
            )}
            <button
              type="button"
              onClick={() => setTestMode(!testMode)}
              className={`relative inline-flex h-6 w-11 rounded-full transition-colors duration-200 focus:outline-none ${testMode ? "bg-amber-400" : "bg-red-400"}`}
            >
              <span className={`inline-block h-5 w-5 mt-0.5 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${testMode ? "translate-x-5" : "translate-x-0.5"}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Advanced */}
      <button
        type="button"
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
             className={`transition-transform duration-200 ${showAdvanced ? "rotate-90" : ""}`}>
          <polyline points="9,18 15,12 9,6"/>
        </svg>
        Настройки этикетки
      </button>

      {showAdvanced && (
        <div className="grid grid-cols-2 gap-3 animate-fade-in">
          <Field label="Ширина, мм">
            <NumberInput value={labelW} onChange={setLabelW} min={20} max={250} />
          </Field>
          <Field label="Высота, мм">
            <NumberInput value={labelH} onChange={setLabelH} min={20} max={250} />
          </Field>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-100 text-red-600 text-sm rounded-xl px-3 py-2.5 animate-fade-in">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full py-3 bg-[#0071e3] text-white text-sm font-semibold rounded-2xl hover:bg-[#0060c0] active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:ring-offset-2 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-150 shadow-sm"
      >
        {loading ? (
          <span className="inline-flex items-center gap-2 justify-center">
            <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
            Создаём сборку...
          </span>
        ) : "Собрать накладные"}
      </button>
    </form>
  );
}
