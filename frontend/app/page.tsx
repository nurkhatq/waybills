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

export default function Dashboard() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [retryingId, setRetryingId] = useState<number | null>(null);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [tab, setTab] = useState<"create" | "history">("create");

  // Auth check
  useEffect(() => {
    const u = loadUser();
    if (!u) { router.replace("/login"); return; }
    setUser(u);
  }, [router]);

  // Load config
  useEffect(() => {
    if (!user) return;
    api.config().then(setConfig).catch((err) => {
      if (err.message === "Unauthorized") return;
      console.error(err);
    });
  }, [user]);

  const refreshJobs = useCallback(async () => {
    try {
      const data = await api.jobs(30);
      setJobs(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingJobs(false);
    }
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

  // Split jobs
  const activeJobs = jobs.filter((j) => ["pending", "parsing"].includes(j.status));
  const doneJobs = jobs.filter((j) => !["pending", "parsing"].includes(j.status));

  if (!user) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">📦</span>
            <span className="font-semibold text-gray-900">Waybills</span>
            {user && (
              <span className="hidden sm:inline text-sm text-gray-400 ml-1">
                · {CITY_LABEL[user.city] ?? user.city}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600 hidden sm:block">{user?.full_name}</span>
            <button
              onClick={handleLogout}
              className="text-xs text-gray-500 hover:text-gray-800 transition px-2 py-1 rounded-lg hover:bg-gray-100"
            >
              Выйти
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* Active jobs banner */}
        {activeJobs.length > 0 && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-center gap-3">
            <div className="w-4 h-4 rounded-full bg-blue-500 animate-pulse shrink-0" />
            <div>
              <p className="text-sm font-medium text-blue-900">
                {activeJobs.length === 1
                  ? `Сборка #${activeJobs[0].id} в процессе...`
                  : `${activeJobs.length} сборки в процессе`}
              </p>
              <p className="text-xs text-blue-700 mt-0.5">Страница обновляется автоматически</p>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 bg-gray-200 rounded-xl p-1 w-fit">
          {(["create", "history"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition ${
                tab === t
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {t === "create" ? "Новая сборка" : `История${jobs.length ? ` (${jobs.length})` : ""}`}
            </button>
          ))}
        </div>

        {/* Tab: Create */}
        {tab === "create" && config && (
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-5">Параметры сборки</h2>
            <CreateJobForm config={config} onCreated={handleCreated} />
          </div>
        )}

        {/* Tab: History */}
        {tab === "history" && (
          <div className="space-y-3">
            {/* Active jobs first */}
            {activeJobs.map((j) => (
              <JobCard
                key={j.id}
                job={j}
                onRetry={handleRetry}
                retrying={retryingId === j.id}
              />
            ))}

            {loadingJobs && doneJobs.length === 0 && (
              <div className="text-center py-12 text-gray-400 text-sm">Загрузка...</div>
            )}

            {!loadingJobs && jobs.length === 0 && (
              <div className="text-center py-12">
                <div className="text-3xl mb-3">📋</div>
                <p className="text-gray-500 text-sm">Ещё не было ни одной сборки.</p>
                <button
                  onClick={() => setTab("create")}
                  className="mt-4 text-blue-500 text-sm hover:underline"
                >
                  Создать первую
                </button>
              </div>
            )}

            {doneJobs.map((j) => (
              <JobCard
                key={j.id}
                job={j}
                onRetry={handleRetry}
                retrying={retryingId === j.id}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
