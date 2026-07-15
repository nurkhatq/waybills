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

export interface OrderEntry {
  quantity?: number;
  basePrice?: number;
  totalPrice?: number;
  category?: { code?: string; title?: string };
  offer?: { code?: string; name?: string; merchantSku?: string };
}

export interface AssemblyJob {
  id: number;
  city: string;
  status: string; // pending | fetching | ready | transmitting | done | error
  progress: number;
  progress_label: string;
  orders_found: number;
  orders_transmitted: number;
  error: string | null;
  created_at: string;
}

export interface AssemblyOrderItem {
  id: number;
  kaspi_order_id: string;
  code: string;
  name: string | null;
  offer_code: string | null;
  quantity: number;
  base_price: number;
  transmitted: boolean;
  transmitted_ok: boolean | null;
}

export interface AssemblyOrdersPage {
  total: number;
  page: number;
  size: number;
  orders: AssemblyOrderItem[];
}

export interface JobOrder {
  id: number;
  order_code: string;
  waybill_number: string | null;
  num_positions: number;
  total_qty: number;
  group_letter: string;
  max_freq: number;
  primary_sku: string;
  entries: OrderEntry[];
}

export interface SingleGroup {
  sku: string;
  name: string;
  count: number;
  codes: string[];
}

export interface SingleStats {
  groups: SingleGroup[];
  non_single_count: number;
  total_with_pdf: number;
  threshold?: number;
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
  pdf_files: { filename: string; label: string; count: number | null; printed: boolean }[];
  cancel_tasks: { order_code: string; sku: string; name: string }[];
  progress: number;
  progress_label: string;
  printed_at: string | null;
  test_mode: boolean;
  test_limit: number;
  smart_mode: boolean;
  single_stats: SingleStats | null;
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
  smart_batch_threshold: number;
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
    smart_mode?: boolean;
  }) => req<Job>("/jobs", { method: "POST", body: JSON.stringify(payload) }),

  getJobStats: (id: number) => req<SingleStats>(`/jobs/${id}/stats`),

  generateJob: (id: number, selectedBatches: { sku: string; name: string; codes: string[]; available_qty?: number }[]) =>
    req<Job>(`/jobs/${id}/generate`, { method: "POST", body: JSON.stringify({ selected_batches: selectedBatches }) }),

  retryJob: (id: number) => req<Job>(`/jobs/${id}/retry`, { method: "POST" }),

  deleteAllJobs: () => req<{ deleted: number }>("/jobs", { method: "DELETE" }),

  jobOrders: (id: number) => req<JobOrder[]>(`/jobs/${id}/orders`),

  markPrinted: (id: number) => req<Job>(`/jobs/${id}/mark-printed`, { method: "POST" }),
  unmarkPrinted: (id: number) => req<Job>(`/jobs/${id}/unmark-printed`, { method: "POST" }),
  markFilePrinted: (id: number, filename: string, printed: boolean) =>
    req<Job>(`/jobs/${id}/mark-file-printed`, { method: "POST", body: JSON.stringify({ filename, printed }) }),
  deleteJob: (id: number) => req<{ deleted: number }>(`/jobs/${id}`, { method: "DELETE" }),

  startAssemblyFetch: (city: string) =>
    req<AssemblyJob>(`/assembly/fetch?city=${city}`, { method: "POST" }),

  getAssemblyJob: (id: number) =>
    req<AssemblyJob>(`/assembly/job/${id}`),

  getAssemblyJobOrders: (id: number, page = 0, size = 50) =>
    req<AssemblyOrdersPage>(`/assembly/job/${id}/orders?page=${page}&size=${size}`),

  startAssemblyTransmit: (id: number) =>
    req<AssemblyJob>(`/assembly/job/${id}/transmit`, { method: "POST" }),

  getLatestAssemblyJob: (city: string) =>
    req<AssemblyJob | null>(`/assembly/latest?city=${city}`),

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
