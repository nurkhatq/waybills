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

// ── Picker types ──────────────────────────────────────────────────────────────

export interface PickerOrderItem {
  order_code: string;
  kaspi_order_id: string;
  offer_code: string;
  name: string;
  quantity: number;
  expected_barcode?: string | null;
  scan?: {
    barcode_scanned: string | null;
    match_status: string;
    scanned_at: string;
  } | null;
}

export interface PickerTask {
  id: number;
  city: string;
  task_type: "A" | "B";
  offer_code: string | null;
  product_name: string | null;
  expected_barcode: string | null;
  orders: PickerOrderItem[];
  total_orders: number;
  total_qty: number;
  scanned_qty: number;
  picker_username: string | null;
  status: "pending" | "claimed" | "done";
  created_at: string | null;
  claimed_at: string | null;
  completed_at: string | null;
  waybill_job_id: number | null;
}

export interface PrintJob {
  id: number;
  waybill_job_id: number;
  filename: string;
  picker_task_id: number | null;
  status: string;
  created_at: string;
}

export interface PickerSessionInfo {
  id: number;
  started_at: string;
}

export interface MySessionResponse {
  in_session: boolean;
  session: PickerSessionInfo | null;
  tasks: PickerTask[];
  active_sessions_count: number;
}

export interface PickerTasksResponse {
  tasks: PickerTask[];
  my_task: PickerTask | null;
}

export interface BarcodeLookup {
  found: boolean;
  barcode: string;
  main_sku?: string;
  name?: string;
  barcode_from_db?: string;
  brand?: string;
}

// ── Picker API calls ───────────────────────────────────────────────────────────

export const picker = {
  tasks: () => req<PickerTasksResponse>("/picker/tasks"),

  build: (city?: string) =>
    req<{ created: number; pending_tasks: number }>(
      `/picker/build${city ? `?city=${city}` : ""}`,
      { method: "POST" }
    ),

  claim: (taskId: number) =>
    req<PickerTask>(`/picker/tasks/${taskId}/claim`, { method: "POST" }),

  getTask: (taskId: number) =>
    req<PickerTask>(`/picker/tasks/${taskId}`),

  scan: (taskId: number, body: { order_code: string; barcode?: string | null; match_status?: string }) =>
    req<PickerTask>(`/picker/tasks/${taskId}/scan`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  bulkScan: (taskId: number, body: { barcode?: string | null; quantity: number }) =>
    req<PickerTask>(`/picker/tasks/${taskId}/bulk-scan`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  complete: (taskId: number) =>
    req<{ task_id: number; status: string; total_orders: number; scanned: number; no_barcode: number; skipped: number; assembled_in_kaspi?: number; assemble_errors?: string[]; waybill_job_id?: number | null; pdf_filenames?: string[] }>(
      `/picker/tasks/${taskId}/complete`,
      { method: "POST" }
    ),

  release: (taskId: number) =>
    req<{ released: boolean }>(`/picker/tasks/${taskId}/release`, { method: "POST" }),

  lookupBarcode: (barcode: string) =>
    req<BarcodeLookup>(`/picker/lookup/barcode/${encodeURIComponent(barcode)}`),

  printQueue: (city: string) => req<PrintJob[]>(`/picker/print-queue?city=${city}`),

  printJobDone: (jobId: number) =>
    req<{ done: boolean }>(`/picker/print-jobs/${jobId}/done`, { method: "POST" }),

  mySession: () => req<MySessionResponse>("/picker/sessions/me"),

  startSession: () =>
    req<{ session_id: number; assigned: number; already_active?: boolean }>(
      "/picker/sessions/start",
      { method: "POST" }
    ),

  endSession: () =>
    req<{ ended: boolean; released_tasks: number }>(
      "/picker/sessions/end",
      { method: "POST" }
    ),
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
