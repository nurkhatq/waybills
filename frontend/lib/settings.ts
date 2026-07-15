export interface AppSettings {
  city: string;
  days_back: number;
  label_width_mm: number;
  label_height_mm: number;
  smart_batch_threshold: number;
}

const KEY = "wb_settings";

export function loadSettings(defaultCity: string): AppSettings {
  if (typeof window === "undefined") return defaults(defaultCity);
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      // city always comes from user account, never from localStorage
      return { ...defaults(defaultCity), ...saved, city: defaultCity };
    }
  } catch { /* ignore */ }
  return defaults(defaultCity);
}

export function saveSettings(s: AppSettings): void {
  // don't persist city — it's always driven by the user account
  const { city: _city, ...rest } = s;
  localStorage.setItem(KEY, JSON.stringify(rest));
}

function defaults(city: string): AppSettings {
  return { city, days_back: 7, label_width_mm: 75, label_height_mm: 120, smart_batch_threshold: 5 };
}
