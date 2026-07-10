"use client";
import { useEffect, useRef } from "react";
import { AppSettings, saveSettings } from "@/lib/settings";
import { Config } from "@/lib/api";

const CITY_LABEL: Record<string, string> = {
  almaty: "Алматы",
  astana: "Астана",
  shymkent: "Шымкент",
};

interface Props {
  open: boolean;
  onClose: () => void;
  settings: AppSettings;
  onChange: (s: AppSettings) => void;
  config: Config;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-3.5 border-b border-gray-100 last:border-0">
      <span className="text-sm text-gray-700">{label}</span>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export default function SettingsPanel({ open, onClose, settings, onChange, config }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (open) document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  function update(patch: Partial<AppSettings>) {
    const next = { ...settings, ...patch };
    onChange(next);
    saveSettings(next);
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-30 bg-black/20 backdrop-blur-[2px] transition-opacity duration-200 ${open ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        ref={panelRef}
        className={`fixed top-0 right-0 z-40 h-full w-full max-w-sm bg-white shadow-2xl flex flex-col transition-transform duration-300 ease-out ${open ? "translate-x-0" : "translate-x-full"}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Настройки</h2>
          <button
            onClick={onClose}
            className="flex items-center justify-center w-7 h-7 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-2">

          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mt-4 mb-1">Склад</p>
          <div className="bg-gray-50 rounded-xl overflow-hidden border border-gray-200">
            {config.cities.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => update({ city: c })}
                className={`w-full flex items-center justify-between px-4 py-3 text-sm border-b border-gray-100 last:border-0 transition-colors ${
                  settings.city === c
                    ? "bg-gray-900 text-white"
                    : "text-gray-700 hover:bg-gray-100"
                }`}
              >
                <span className="font-medium">{CITY_LABEL[c] ?? c}</span>
                {settings.city === c && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20,6 9,17 4,12"/></svg>
                )}
              </button>
            ))}
          </div>

          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mt-6 mb-1">Параметры</p>
          <div className="bg-gray-50 rounded-xl border border-gray-200 px-4">
            <Row label="Период (дней назад)">
              <input
                type="number"
                min={1}
                max={14}
                value={settings.days_back}
                onChange={(e) => update({ days_back: Math.min(14, Math.max(1, Number(e.target.value))) })}
                className="w-16 text-center text-sm font-medium px-2 py-1.5 border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-400 transition-all"
              />
            </Row>
          </div>

          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mt-6 mb-1">Этикетка</p>
          <div className="bg-gray-50 rounded-xl border border-gray-200 px-4">
            <Row label="Ширина, мм">
              <input
                type="number"
                min={20}
                max={250}
                value={settings.label_width_mm}
                onChange={(e) => update({ label_width_mm: Number(e.target.value) })}
                className="w-16 text-center text-sm font-medium px-2 py-1.5 border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-400 transition-all"
              />
            </Row>
            <Row label="Высота, мм">
              <input
                type="number"
                min={20}
                max={250}
                value={settings.label_height_mm}
                onChange={(e) => update({ label_height_mm: Number(e.target.value) })}
                className="w-16 text-center text-sm font-medium px-2 py-1.5 border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-400 transition-all"
              />
            </Row>
          </div>
        </div>
      </div>
    </>
  );
}
