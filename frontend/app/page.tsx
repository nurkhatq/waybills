"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { api, clearSession, loadUser, Job, Config, User } from "@/lib/api";
import { loadSettings, AppSettings } from "@/lib/settings";
import CreateJobForm from "@/components/CreateJobForm";
import JobCard from "@/components/JobCard";
import SettingsPanel from "@/components/SettingsPanel";

function SkeletonCard() {
  return (
    <div className="bg-white rounded-2xl border-2 border-gray-200 border-l-4 border-l-gray-200 p-5">
      <div className="flex items-start gap-4">
        <div className="w-16 h-10 rounded-lg animate-shimmer shrink-0" />
        <div className="flex-1 space-y-2.5">
          <div className="flex items-center gap-2">
            <div className="w-8 h-3 rounded animate-shimmer" />
            <div className="w-20 h-4 rounded animate-shimmer" />
            <div className="w-14 h-5 rounded-full animate-shimmer" />
          </div>
          <div className="w-32 h-8 rounded-xl animate-shimmer" />
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [retryingId, setRetryingId] = useState<number | null>(null);
  const [firstLoad, setFirstLoad] = useState(true);
  const [tab, setTab] = useState<"create" | "history">("create");
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    const u = loadUser();
    if (!u) { router.replace("/login"); return; }
    setUser(u);
    setSettings(loadSettings(u.city));
  }, [router]);

  useEffect(() => {
    if (!user) return;
    api.config().then((cfg) => {
      setConfig(cfg);
      // sync settings city with available cities
      setSettings((prev) => prev ?? loadSettings(cfg.user_city));
    }).catch(() => {});
  }, [user]);

  const refreshJobs = useCallback(async () => {
    try {
      const data = await api.jobs(30);
      setJobs(data);
    } catch { /* retry next tick */ }
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

  function handleMarkPrinted(updated: Job) {
    setJobs((prev) => prev.map((j) => (j.id === updated.id ? updated : j)));
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

  async function handleDeleteAll() {
    if (!confirm("Удалить всю историю сборок?\n\nЭто действие необратимо.")) return;
    try {
      await api.deleteAllJobs();
      setJobs([]);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Ошибка удаления");
    }
  }

  const activeJobs = jobs.filter((j) => ["pending", "parsing"].includes(j.status));
  const doneJobs   = jobs.filter((j) => !["pending", "parsing"].includes(j.status));

  if (!user || !settings) return null;

  return (
    <div className="min-h-screen bg-[#f5f5f7] animate-fade-in">

      {/* Settings Panel */}
      {config && (
        <SettingsPanel
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          settings={settings}
          onChange={setSettings}
          config={config}
        />
      )}

      {/* Header */}
      <header className="sticky top-0 z-20 bg-white/90 backdrop-blur-md border-b-2 border-gray-200">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-7 h-7 bg-gray-900 rounded-lg">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>
            </div>
            <span className="font-bold text-gray-900 tracking-tight">Waybills</span>
          </div>

          <div className="flex items-center gap-2">
            <span className="hidden sm:block text-sm text-gray-500">{user?.full_name}</span>

            <button
              onClick={() => setSettingsOpen(true)}
              className="flex items-center justify-center w-8 h-8 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
              title="Настройки"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            </button>

            <button
              onClick={handleLogout}
              className="flex items-center justify-center w-8 h-8 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
              title="Выйти"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16,17 21,12 16,7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-4">

        {/* Active banner */}
        {activeJobs.length > 0 && (
          <div className="flex items-center gap-3 bg-white border-2 border-blue-200 border-l-4 border-l-blue-500 rounded-2xl px-4 py-3 animate-fade-in">
            <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0 animate-[pulse-dot_1.2s_ease-in-out_infinite]" />
            <div>
              <p className="text-sm font-semibold text-gray-900">
                {activeJobs.length === 1 ? `Сборка #${activeJobs[0].id} обрабатывается` : `${activeJobs.length} сборки в процессе`}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">Обновляется автоматически каждые 4 сек</p>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 bg-gray-200 rounded-xl p-1 w-fit">
          {(["create", "history"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-1.5 text-sm font-semibold rounded-lg transition-all duration-200 ${
                tab === t ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {t === "create" ? "Сборка" : `История${jobs.length ? ` (${jobs.length})` : ""}`}
            </button>
          ))}
        </div>

        {/* Create tab */}
        {tab === "create" && (
          <div className="bg-white rounded-2xl border-2 border-gray-200 p-6 animate-slide-up">
            <CreateJobForm settings={settings} onCreated={handleCreated} />
          </div>
        )}

        {/* History tab */}
        {tab === "history" && (
          <div className="space-y-3">
            {!firstLoad && jobs.length > 0 && config && ["admin", "manager"].includes(config.role) && (
              <div className="flex justify-end">
                <button
                  onClick={handleDeleteAll}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg border-2 border-transparent hover:border-red-200 transition-all"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="3,6 5,6 21,6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                  Очистить историю
                </button>
              </div>
            )}

            {activeJobs.map((j) => (
              <JobCard key={j.id} job={j} onRetry={handleRetry} retrying={retryingId === j.id} onMarkPrinted={handleMarkPrinted} />
            ))}

            {firstLoad && <><SkeletonCard /><SkeletonCard /></>}

            {!firstLoad && jobs.length === 0 && (
              <div className="text-center py-16 animate-fade-in">
                <div className="inline-flex items-center justify-center w-12 h-12 bg-white border-2 border-gray-200 rounded-2xl mb-4">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>
                </div>
                <p className="text-sm font-medium text-gray-500">Сборок ещё не было</p>
                <button onClick={() => setTab("create")} className="mt-3 text-sm font-medium text-gray-900 hover:underline">
                  Создать первую
                </button>
              </div>
            )}

            {doneJobs.map((j) => (
              <JobCard key={j.id} job={j} onRetry={handleRetry} retrying={retryingId === j.id} onMarkPrinted={handleMarkPrinted} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
