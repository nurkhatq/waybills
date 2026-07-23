"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { picker, PickerTask, MySessionResponse, loadUser } from "@/lib/api";

function taskProgress(t: PickerTask) {
  if (t.total_orders === 0) return 0;
  return Math.round((t.scanned_qty / t.total_orders) * 100);
}

function taskStatusColor(t: PickerTask) {
  if (t.scanned_qty === t.total_orders) return "text-green-600";
  if (t.scanned_qty > 0) return "text-yellow-600";
  return "text-blue-600";
}

function taskStatusLabel(t: PickerTask) {
  if (t.scanned_qty === t.total_orders) return "Готово";
  if (t.scanned_qty > 0) return `${t.scanned_qty}/${t.total_orders}`;
  return "Не начато";
}

export default function PickerPage() {
  const router = useRouter();
  const [data, setData] = useState<MySessionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const resp = await picker.mySession();
      setData(resp);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const u = loadUser();
    if (!u) { router.replace("/login"); return; }
    setUsername(u.username);
    load();
    // Автообновление каждые 30 сек (новые задачи могут появиться)
    const interval = setInterval(load, 30_000);
    return () => clearInterval(interval);
  }, [router, load]);

  async function handleStartSession() {
    setStarting(true);
    setError(null);
    try {
      await picker.startSession();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setStarting(false);
    }
  }

  async function handleEndSession() {
    if (!confirm("Завершить сессию? Незапущенные задания вернутся в очередь.")) return;
    setEnding(true);
    try {
      await picker.endSession();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setEnding(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">Загрузка…</p>
      </div>
    );
  }

  const inSession = data?.in_session ?? false;
  const tasks = data?.tasks ?? [];
  const activeSessions = data?.active_sessions_count ?? 0;
  const TYPE_ORDER: Record<string, number> = { C: 0, A: 1, B: 2 };
  const sortTasks = (arr: PickerTask[]) =>
    [...arr].sort((a, b) => {
      const typeA = TYPE_ORDER[a.task_type] ?? 9;
      const typeB = TYPE_ORDER[b.task_type] ?? 9;
      if (typeA !== typeB) return typeA - typeB;
      return (a.product_name ?? "").localeCompare(b.product_name ?? "", "ru");
    });
  const pendingTasks = sortTasks(tasks.filter(t => t.scanned_qty === 0));
  const inProgressTasks = sortTasks(tasks.filter(t => t.scanned_qty > 0 && t.scanned_qty < t.total_orders));
  const doneTasks = sortTasks(tasks.filter(t => t.scanned_qty === t.total_orders));

  return (
    <div className="min-h-screen bg-gray-50 pb-10">
      {/* Header */}
      <div className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-gray-900">Сборщик</h1>
            <div className="flex items-center gap-2">
              {username && <p className="text-xs text-gray-500">{username}</p>}
              {inSession && (
                <span className="text-xs bg-green-100 text-green-700 rounded-full px-2 py-0.5 font-medium">
                  ● сессия активна
                </span>
              )}
            </div>
          </div>
          <button onClick={() => router.push("/")} className="text-sm text-blue-600">
            ← Назад
          </button>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 pt-4 space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm">
            {error}
            <button className="ml-2 underline" onClick={() => setError(null)}>ОК</button>
          </div>
        )}

        {/* ── Нет сессии ── */}
        {!inSession && (
          <div className="bg-white rounded-2xl border-2 border-dashed border-gray-200 p-8 text-center space-y-4">
            <p className="text-3xl">👋</p>
            <p className="font-semibold text-gray-800 text-lg">Начните рабочую сессию</p>
            <p className="text-sm text-gray-500">
              {activeSessions > 0
                ? `Сейчас в сессии: ${activeSessions} чел. Задания распределятся автоматически.`
                : "Вы будете первым в сессии. Задания назначатся автоматически."}
            </p>
            <button
              onClick={handleStartSession}
              disabled={starting}
              className="bg-blue-600 text-white rounded-xl px-8 py-3 font-bold text-base hover:bg-blue-700 disabled:opacity-50 w-full max-w-xs mx-auto block"
            >
              {starting ? "Запуск…" : "Начать сессию"}
            </button>
          </div>
        )}

        {/* ── Активная сессия ── */}
        {inSession && (
          <>
            {/* Статус сессии */}
            <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-green-800">Сессия активна</p>
                <p className="text-xs text-green-600">
                  {activeSessions} чел. в сессии · {tasks.length} задани{tasks.length === 1 ? "е" : tasks.length < 5 ? "я" : "й"} назначено
                </p>
              </div>
              <button
                onClick={load}
                className="text-xs text-green-700 underline"
              >
                Обновить
              </button>
            </div>

            {tasks.length === 0 && (
              <div className="bg-white rounded-2xl border-2 border-dashed border-gray-200 p-8 text-center">
                <p className="text-gray-400 text-sm">Нет назначенных заданий</p>
                <p className="text-gray-400 text-xs mt-1">Подождите — заказы распределятся при создании накладных</p>
              </div>
            )}

            {/* В процессе */}
            {inProgressTasks.length > 0 && (
              <section className="space-y-2">
                <h2 className="text-xs font-semibold text-yellow-700 uppercase tracking-wide">В работе</h2>
                {inProgressTasks.map(t => <TaskCard key={t.id} task={t} username={username} router={router} />)}
              </section>
            )}

            {/* Не начато */}
            {pendingTasks.length > 0 && (
              <section className="space-y-2">
                <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Ожидают ({pendingTasks.length})</h2>
                {pendingTasks.map(t => <TaskCard key={t.id} task={t} username={username} router={router} />)}
              </section>
            )}

            {/* Выполнено */}
            {doneTasks.length > 0 && (
              <section className="space-y-2">
                <h2 className="text-xs font-semibold text-green-700 uppercase tracking-wide">Выполнено ({doneTasks.length})</h2>
                {doneTasks.map(t => <TaskCard key={t.id} task={t} username={username} router={router} />)}
              </section>
            )}

            {/* Кнопка завершения сессии */}
            <button
              onClick={handleEndSession}
              disabled={ending}
              className="w-full text-sm text-red-500 hover:text-red-700 py-3 disabled:opacity-50"
            >
              {ending ? "Завершение…" : "Завершить сессию"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function TaskCard({ task, username, router }: { task: PickerTask; username: string | null; router: ReturnType<typeof useRouter> }) {
  const isDone = task.scanned_qty === task.total_orders;
  const inProgress = task.scanned_qty > 0 && !isDone;
  const prog = taskProgress(task);

  return (
    <div
      className={`bg-white rounded-2xl border-2 p-4 flex items-center gap-3 cursor-pointer hover:border-blue-300 transition-colors ${
        isDone ? "border-green-200 opacity-70" : inProgress ? "border-yellow-300" : "border-gray-100"
      }`}
      onClick={() => router.push(`/picker/${task.id}`)}
    >
      <div className={`rounded-lg px-2 py-1 text-xs font-bold shrink-0 ${
        task.task_type === "A" ? "bg-purple-100 text-purple-700"
        : task.task_type === "C" ? "bg-orange-100 text-orange-700"
        : "bg-blue-100 text-blue-700"
      }`}>
        {task.task_type}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-xs text-gray-400">#{task.id}</p>
        <p className="text-sm font-semibold text-gray-900 leading-tight">
          {task.product_name ?? "—"}
        </p>
        <p className="text-xs text-gray-500">
          {task.task_type === "C" && task.orders.length > 0
            ? `${task.orders[0].order_code} · ${task.total_orders} поз.`
            : `${task.total_orders} заказ${task.total_orders === 1 ? "" : task.total_orders < 5 ? "а" : "ов"}`
          }
        </p>
        {(inProgress || isDone) && (
          <div className="mt-1.5 h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${isDone ? "bg-green-500" : "bg-yellow-400"}`} style={{ width: `${prog}%` }} />
          </div>
        )}
      </div>

      <div className="text-right shrink-0">
        <span className={`text-xs font-semibold ${taskStatusColor(task)}`}>{taskStatusLabel(task)}</span>
        <p className="text-gray-300 text-lg">›</p>
      </div>
    </div>
  );
}
