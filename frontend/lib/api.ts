// В браузере запросы идут через /api → Vercel proxy → VPS (избегаем mixed content)
const BASE = "/api";

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("wb_token");
}

function authHeaders(): Record<string, string> {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...authHeaders(), ...(opts.headers ?? {}) },
  });
  if (res.status === 401) {
    localStorage.removeItem("wb_token");
    localStorage.removeItem("wb_user");
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export interface User {
  id: number;
  username: string;
  full_name: string;
  city: string;
  role: string;
}

export interface Job {
  id: number;
  city: string;
  status: string;
  error: string | null;
  orders_found: number;
  orders_printed: number | null;
  orders_filtered_pickup: number;
  orders_filtered_status: number;
  orders_filtered_transmitted: number;
  group_a_count: number;
  group_b_count: number;
  group_c_count: number;
  pdf_files: string[];
  progress: number;
  progress_label: string;
  printed_at: string | null;
  test_mode: boolean;
  test_limit: number;
  days_back: number;
  label_width_mm: number;
  label_height_mm: number;
  created_at: string;
  updated_at: string;
}

export interface Config {
  cities: string[];
  user_city: string;
  role: string;
  defaults: {
    days_back: number;
    label_width_mm: number;
    label_height_mm: number;
    test_limit: number;
  };
}

export const api = {
  login: (username: string, password: string) =>
    req<{ access_token: string; token_type: string; user: User }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),

  me: () => req<User>("/auth/me"),

  config: () => req<Config>("/config"),

  jobs: (limit = 30) => req<Job[]>(`/jobs?limit=${limit}`),

  createJob: (payload: {
    city: string;
    days_back: number;
    test_mode: boolean;
    test_limit: number;
    label_width_mm: number;
    label_height_mm: number;
  }) => req<Job>("/jobs", { method: "POST", body: JSON.stringify(payload) }),

  retryJob: (id: number) => req<Job>(`/jobs/${id}/retry`, { method: "POST" }),

  markPrinted: (id: number) => req<Job>(`/jobs/${id}/mark-printed`, { method: "POST" }),
  unmarkPrinted: (id: number) => req<Job>(`/jobs/${id}/unmark-printed`, { method: "POST" }),

  pdfUrl: (jobId: number, filename: string) =>
    `${BASE}/jobs/${jobId}/pdf/${filename}?token=${getToken()}`,

  printPdf: async (jobId: number, filename: string): Promise<void> => {
    const url = `${BASE}/jobs/${jobId}/pdf/${filename}?token=${getToken()}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);

    const iframe = document.createElement("iframe");
    iframe.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;";
    iframe.src = blobUrl;
    document.body.appendChild(iframe);

    await new Promise<void>((resolve, reject) => {
      iframe.onload = () => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
          resolve();
        } catch (e) {
          reject(e);
        }
      };
      iframe.onerror = () => reject(new Error("Не удалось загрузить PDF"));
    });

    setTimeout(() => {
      document.body.removeChild(iframe);
      URL.revokeObjectURL(blobUrl);
    }, 60_000);
  },
};

export function saveSession(token: string, user: User) {
  localStorage.setItem("wb_token", token);
  localStorage.setItem("wb_user", JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem("wb_token");
  localStorage.removeItem("wb_user");
}

export function loadUser(): User | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem("wb_user");
  return raw ? (JSON.parse(raw) as User) : null;
}
