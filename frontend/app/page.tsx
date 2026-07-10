"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { api, clearSession, loadUser, Job, Config, User } from "@/lib/api";
import CreateJobForm from "@/components/CreateJobForm";
import JobCard from "@/components/JobCard";

const CITY_LABEL: Record<string, string> = {
  almaty: "Алматы",
  astana: "Астана",
  shymkent: "Шымкент",
};

function SkeletonCard() {
  return (
    <div className="bg-white rounded-2xl border border-gray-200/80 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-6 h-4 rounded animate-shimmer" />
          <div className="w-20 h-4 rounded animate-shimmer" />
          <div className="w-16 h-5 rounded-full animate-shimmer" />
        </div>
        <div className="w-24 h-4 rounded animate-shimmer" />
      </div>
      <div className="grid grid-cols-6 gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-12 rounded-lg animate-shimmer" />
        ))}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [retryingId, setRetryingId] = useState<number | null>(null);
  const [firstLoad, setFirstLoad] = useState(true);
  const [tab, setTab] = useState<"create" | "history">("create");

  useEffect(() => {
    const u = loadUser();
    if (!u) { router.replace("/login"); return; }
    setUser(u);
  }, [router]);

  useEffect(() => {
    if (!user) return;
    api.config().then(setConfig).catch(() => {});
  }, [user]);

  const refreshJobs = useCallback(async () => {
    try {
      const data = await api.jobs(30);
      setJobs(data);
    } catch { /* will retry next tick */ }
    finally { setFirstLoad(false); }
  }, []);

  useEffect(() => {
    if (!user) return;
    refreshJobs();
    const id = setInterval(refreshJobs, 4000);
    return () => clearInterval(id);
  }, [user, refreshJobs]);

  function handleLogout() {
    clearSession();
    router.replace("/login");
  }

  async function handleRetry(job: Job) {
    setRetryingId(job.id);
    try {
      const newJob = await api.retryJob(job.id);
      setJobs((prev) => [newJob, ...prev]);
      setTab("history");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Ошибка повтора");
    } finally {
      setRetryingId(null);
    }
  }

  function handleCreated(job: Job) {
    setJobs((prev) => [job, ...prev]);
    setTab("history");
  }

  const activeJobs = jobs.filter((j) => ["pending", "parsing"].includes(j.status));
  const doneJobs   = jobs.filter((j) => !["pending", "parsing"].includes(j.status));

  if (!user) return null;

  return (
    <div className="min-h-screen bg-[#f5f5f7] animate-fade-in">

      {/* Header */}
      <header className="sticky top-0 z-20 bg-white/80 backdrop-blur-md border-b border-gray-200/80">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-7 h-7 bg-[#0071e3] rounded-lg">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>
            </div>
            <span className="font-semibold text-gray-900 tracking-tight">Waybills</span>
            {user && (
              <span className="hidden sm:inline text-sm text-gray-400">
                · {CITY_LABEL[user.city] ?? user.city}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <span className="hidden sm:block text-sm text-gray-500">{user?.full_name}</span>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-700 px-2.5 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16,17 21,12 16,7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
              Выйти
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-4">

        {/* Active banner */}
        {activeJobs.length > 0 && (
          <div className="flex items-center gap-3 bg-blue-50 border border-blue-200/80 rounded-2xl px-4 py-3 animate-fade-in">
            <span className="w-2 h-2 rounded-full bg-blue-500 animate-[pulse-dot_1.2s_ease-in-out_infinite] shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-blue-900">
                {activeJobs.length === 1
                  ? `Сборка #${activeJobs[0].id} в процессе`
                  : `${activeJobs.length} сборки в процессе`}
              </p>
              <p className="text-xs text-blue-600 mt-0.5">Обновляется автоматически</p>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 bg-gray-200/70 rounded-xl p-1 w-fit">
          {(["create", "history"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-all duration-200 ${
                tab === t
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {t === "create"
                ? "Новая сборка"
                : `История${jobs.length ? ` (${jobs.length})` : ""}`}
            </button>
          ))}
        </div>

        {/* Create tab */}
        {tab === "create" && config && (
          <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm p-6 animate-slide-up">
            <h2 className="text-base font-semibold text-gray-900 mb-5">Параметры сборки</h2>
            <CreateJobForm config={config} onCreated={handleCreated} />
          </div>
        )}

        {/* History tab */}
        {tab === "history" && (
          <div className="space-y-3">
            {activeJobs.map((j) => (
              <JobCard key={j.id} job={j} onRetry={handleRetry} retrying={retryingId === j.id} />
            ))}

            {firstLoad && (
              <>
                <SkeletonCard />
                <SkeletonCard />
              </>
            )}

            {!firstLoad && jobs.length === 0 && (
              <div className="text-center py-16 animate-fade-in">
                <div className="inline-flex items-center justify-center w-12 h-12 bg-white border border-gray-200 rounded-2xl mb-4">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="1.5"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>
                </div>
                <p className="text-sm font-medium text-gray-500">Сборок ещё не было</p>
                <button
                  onClick={() => setTab("create")}
                  className="mt-3 text-sm text-[#0071e3] hover:underline"
                >
                  Создать первую
                </button>
              </div>
            )}

            {doneJobs.map((j) => (
              <JobCard key={j.id} job={j} onRetry={handleRetry} retrying={retryingId === j.id} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
