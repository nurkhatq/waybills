"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { picker, PickerTask, loadUser } from "@/lib/api";

function taskTypeLabel(type: string) {
  return type === "A" ? "Массовый" : "Пачка";
}

function statusColor(status: string) {
  if (status === "pending") return "bg-blue-100 text-blue-800";
  if (status === "claimed") return "bg-yellow-100 text-yellow-800";
  return "bg-green-100 text-green-800";
}

function statusLabel(status: string) {
  if (status === "pending") return "Свободно";
  if (status === "claimed") return "Взято";
  return "Выполнено";
}

export default function PickerPage() {
  const router = useRouter();
  const [tasks, setTasks] = useState<PickerTask[]>([]);
  const [myTask, setMyTask] = useState<PickerTask | null>(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState<number | null>(null);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await picker.tasks();
      setTasks(data.tasks);
      setMyTask(data.my_task);
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
  }, [router, load]);

  async function handleClaim(taskId: number) {
    setClaiming(taskId);
    try {
      const task = await picker.claim(taskId);
      router.push(`/picker/${task.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
      setClaiming(null);
      await load();
    }
  }

  async function handleBuild() {
    setBuilding(true);
    try {
      await picker.build();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBuilding(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">Загрузка…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-10">
      {/* Header */}
      <div className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-gray-900">Сборщик</h1>
            {username && <p className="text-xs text-gray-500">{username}</p>}
          </div>
          <button
            onClick={() => router.push("/")}
            className="text-sm text-blue-600 hover:text-blue-800"
          >
            ← Назад
          </button>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 pt-4 space-y-3">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm">
            {error}
          </div>
        )}

        {/* Моё активное задание */}
        {myTask && (
          <div className="bg-yellow-50 border-2 border-yellow-300 rounded-2xl p-4">
            <p className="text-xs font-semibold text-yellow-700 mb-2">МОЁ АКТИВНОЕ ЗАДАНИЕ</p>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-bold text-gray-900">
                  #{myTask.id} · {taskTypeLabel(myTask.task_type)}
                  {myTask.product_name && <span className="font-normal text-gray-600"> — {myTask.product_name}</span>}
                </p>
                <p className="text-sm text-gray-600">
                  {myTask.scanned_qty} / {myTask.total_orders} заказов
                </p>
              </div>
              <button
                onClick={() => router.push(`/picker/${myTask.id}`)}
                className="bg-yellow-500 text-white rounded-xl px-4 py-2 text-sm font-semibold hover:bg-yellow-600"
              >
                Продолжить →
              </button>
            </div>
          </div>
        )}

        {/* Список задач */}
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">
            Доступные задания ({tasks.filter(t => t.status === "pending").length})
          </h2>
          <button
            onClick={handleBuild}
            disabled={building}
            className="text-xs text-blue-600 hover:text-blue-800 disabled:opacity-50"
          >
            {building ? "Загрузка…" : "Обновить очередь"}
          </button>
        </div>

        {tasks.length === 0 && (
          <div className="bg-white rounded-2xl border-2 border-dashed border-gray-200 p-8 text-center">
            <p className="text-gray-400 text-sm">Нет доступных заданий</p>
            <p className="text-gray-400 text-xs mt-1">Нажмите «Обновить очередь» чтобы создать задания из последнего сборочного задания</p>
          </div>
        )}

        {tasks.map((task) => {
          const isMine = task.picker_username === username;
          const isPending = task.status === "pending";

          return (
            <div
              key={task.id}
              className="bg-white rounded-2xl border-2 border-gray-100 p-4 flex items-start gap-3"
            >
              {/* Тип */}
              <div className={`rounded-lg px-2 py-1 text-xs font-bold shrink-0 ${
                task.task_type === "A" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"
              }`}>
                {task.task_type}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-semibold text-gray-900">#{task.id}</span>
                  {task.product_name && (
                    <span className="text-sm text-gray-600 truncate">{task.product_name}</span>
                  )}
                  <span className={`ml-auto text-xs rounded-full px-2 py-0.5 font-medium shrink-0 ${statusColor(task.status)}`}>
                    {statusLabel(task.status)}
                  </span>
                </div>
                <p className="text-xs text-gray-500">
                  {task.total_orders} заказ{task.total_orders === 1 ? "" : task.total_orders < 5 ? "а" : "ов"}
                  {task.status === "claimed" && task.picker_username && !isMine && (
                    <span className="ml-2 text-yellow-600">· {task.picker_username}</span>
                  )}
                  {task.status === "claimed" && isMine && (
                    <span className="ml-2 text-yellow-600">· {task.scanned_qty}/{task.total_orders} отсканировано</span>
                  )}
                </p>
              </div>

              {isPending && !myTask && (
                <button
                  onClick={() => handleClaim(task.id)}
                  disabled={claiming === task.id}
                  className="bg-blue-600 text-white rounded-xl px-4 py-2 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 shrink-0"
                >
                  {claiming === task.id ? "…" : "Взять"}
                </button>
              )}
              {isMine && task.status === "claimed" && (
                <button
                  onClick={() => router.push(`/picker/${task.id}`)}
                  className="bg-yellow-500 text-white rounded-xl px-3 py-2 text-sm font-semibold hover:bg-yellow-600 shrink-0"
                >
                  →
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
