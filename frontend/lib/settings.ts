export interface AppSettings {
  city: string;
  days_back: number;
  label_width_mm: number;
  label_height_mm: number;
}

const KEY = "wb_settings";

export function loadSettings(defaultCity: string): AppSettings {
  if (typeof window === "undefined") return defaults(defaultCity);
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...defaults(defaultCity), ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return defaults(defaultCity);
}

export function saveSettings(s: AppSettings): void {
  localStorage.setItem(KEY, JSON.stringify(s));
}

function defaults(city: string): AppSettings {
  return { city, days_back: 7, label_width_mm: 75, label_height_mm: 120 };
}
