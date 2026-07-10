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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const job = await api.createJob({
        city,
        days_back: daysBack,
        test_mode: testMode,
        test_limit: testLimit,
        label_width_mm: labelW,
        label_height_mm: labelH,
      });
      onCreated(job);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Ошибка создания");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* City + Days */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Город</label>
          {isAdmin ? (
            <select
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="w-full px-3 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition bg-white"
            >
              {config.cities.map((c) => (
                <option key={c} value={c}>{CITY_LABEL[c] ?? c}</option>
              ))}
            </select>
          ) : (
            <div className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg bg-gray-50 text-gray-700">
              {CITY_LABEL[city] ?? city}
            </div>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Дней назад</label>
          <input
            type="number"
            value={daysBack}
            onChange={(e) => setDaysBack(Number(e.target.value))}
            min={1}
            max={14}
            className="w-full px-3 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
          />
        </div>
      </div>

      {/* Label size */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Ширина этикетки, мм</label>
          <input
            type="number"
            value={labelW}
            onChange={(e) => setLabelW(Number(e.target.value))}
            min={20}
            max={250}
            className="w-full px-3 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Высота этикетки, мм</label>
          <input
            type="number"
            value={labelH}
            onChange={(e) => setLabelH(Number(e.target.value))}
            min={20}
            max={250}
            className="w-full px-3 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
          />
        </div>
      </div>

      {/* Test mode */}
      <div className="flex items-center justify-between p-4 bg-amber-50 border border-amber-200 rounded-xl">
        <div>
          <label htmlFor="test-mode" className="text-sm font-medium text-amber-900 cursor-pointer">
            Тестовый режим
          </label>
          <p className="text-xs text-amber-700 mt-0.5">
            {testMode
              ? `Напечатать только первые ${testLimit} накладных`
              : "⚠ Реальный режим — будут напечатаны ВСЕ накладные"}
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
              className="w-16 px-2 py-1.5 text-sm border border-amber-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 text-center"
            />
          )}
          <button
            type="button"
            onClick={() => setTestMode(!testMode)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              testMode ? "bg-amber-500" : "bg-gray-300"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                testMode ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2.5">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full py-3 px-4 bg-blue-500 text-white text-sm font-semibold rounded-xl hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition"
      >
        {loading ? "Создаём сборку..." : "Собрать накладные"}
      </button>
    </form>
  );
}
