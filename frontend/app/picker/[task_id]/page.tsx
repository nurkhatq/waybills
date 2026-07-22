"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import dynamic from "next/dynamic";
import { picker, PickerTask, PickerOrderItem, loadUser } from "@/lib/api";

// Камера загружается только в браузере
const BarcodeScanner = dynamic(() => import("@/components/BarcodeScanner"), { ssr: false });

type ScanStatus = "matched" | "unknown_barcode" | "no_barcode" | "skipped";

function matchIcon(status: ScanStatus | null | undefined) {
  if (status === "matched") return "✅";
  if (status === "unknown_barcode") return "⚠️";
  if (status === "no_barcode") return "🚫";
  if (status === "skipped") return "⏭";
  return "⬜";
}

function matchLabel(status: ScanStatus | null | undefined) {
  if (status === "matched") return "Совпало";
  if (status === "unknown_barcode") return "Неизвестный ШК";
  if (status === "no_barcode") return "Нет ШК";
  if (status === "skipped") return "Пропущен";
  return "Ожидает";
}

export default function PickerTaskPage() {
  const router = useRouter();
  const params = useParams();
  const taskId = Number(params.task_id);

  const [task, setTask] = useState<PickerTask | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);

  // Текущий заказ, для которого ждём скан
  const [currentOrder, setCurrentOrder] = useState<PickerOrderItem | null>(null);
  const [scannerActive, setScannerActive] = useState(true);

  // Модал "неизвестный ШК"
  const [unknownModal, setUnknownModal] = useState<{ barcode: string } | null>(null);

  // Модал завершения
  const [doneModal, setDoneModal] = useState(false);

  const loadTask = useCallback(async () => {
    try {
      const t = await picker.getTask(taskId);
      setTask(t);
      updateCurrentOrder(t);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  function updateCurrentOrder(t: PickerTask) {
    // Следующий заказ без скана
    const next = t.orders.find(o => !o.scan);
    setCurrentOrder(next ?? null);
  }

  useEffect(() => {
    const u = loadUser();
    if (!u) { router.replace("/login"); return; }
    setUsername(u.username);
    loadTask();
  }, [router, loadTask]);

  async function handleScan(barcode: string) {
    if (!task || !currentOrder || !scannerActive) return;
    setScannerActive(false);

    const expectedBarcode = currentOrder.expected_barcode;
    let status: ScanStatus = "matched";

    // Если нет ожидаемого ШК в системе — записываем как unknown
    if (!expectedBarcode) {
      status = "unknown_barcode";
    } else if (barcode !== expectedBarcode) {
      // Уточним через API
      try {
        const lookup = await picker.lookupBarcode(barcode);
        if (!lookup.found) {
          status = "unknown_barcode";
        } else if (lookup.main_sku !== currentOrder.offer_code) {
          status = "unknown_barcode";
        }
      } catch {
        status = "unknown_barcode";
      }
    }

    if (status === "unknown_barcode") {
      setUnknownModal({ barcode });
      return; // Пользователь решит что делать
    }

    await recordScan(currentOrder.order_code, barcode, status);
  }

  async function recordScan(orderCode: string, barcode: string | null, status: ScanStatus) {
    if (!task) return;
    try {
      const updated = await picker.scan(taskId, {
        order_code: orderCode,
        barcode: barcode,
        match_status: status,
      });
      setTask(updated);
      updateCurrentOrder(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка скана");
    } finally {
      setUnknownModal(null);
      setScannerActive(true);
    }
  }

  async function handleNoBarcode() {
    if (!currentOrder) return;
    setScannerActive(false);
    await recordScan(currentOrder.order_code, null, "no_barcode");
  }

  async function handleComplete() {
    try {
      await picker.complete(taskId);
      setDoneModal(false);
      router.push("/picker");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    }
  }

  async function handleRelease() {
    if (!confirm("Вернуть задание в очередь?")) return;
    try {
      await picker.release(taskId);
      router.push("/picker");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    }
  }

  if (loading || !task) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">Загрузка…</p>
      </div>
    );
  }

  const scannedCount = task.orders.filter(o => o.scan).length;
  const allDone = scannedCount === task.total_orders;
  const isMyTask = task.picker_username === username;
  const progress = task.total_orders > 0 ? (scannedCount / task.total_orders) * 100 : 0;

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* Header */}
      <div className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h1 className="text-base font-bold text-gray-900">
                Задание #{task.id}
                <span className={`ml-2 text-xs rounded px-1.5 py-0.5 font-medium ${
                  task.task_type === "A" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"
                }`}>{task.task_type}</span>
              </h1>
              {task.product_name && (
                <p className="text-xs text-gray-500">{task.product_name}</p>
              )}
            </div>
            <button
              onClick={() => router.push("/picker")}
              className="text-sm text-blue-600 hover:text-blue-800"
            >
              ← Назад
            </button>
          </div>
          {/* Прогресс-бар */}
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-xs text-gray-500 mt-1">
            {scannedCount} / {task.total_orders} заказов
          </p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 pt-4 space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm">
            {error}
          </div>
        )}

        {/* Камера + кнопки действий */}
        {isMyTask && !allDone && currentOrder && (
          <div className="space-y-3">
            <div className="bg-white rounded-2xl border-2 border-gray-100 p-3">
              <p className="text-xs font-semibold text-gray-500 mb-1">СЕЙЧАС ИЩЕМ</p>
              <p className="font-semibold text-gray-900 text-sm leading-tight">{currentOrder.name}</p>
              <p className="text-xs text-gray-400 mt-0.5">Заказ {currentOrder.order_code}</p>
              {currentOrder.expected_barcode && (
                <p className="text-xs text-gray-400">ШК: {currentOrder.expected_barcode}</p>
              )}
              {!currentOrder.expected_barcode && (
                <p className="text-xs text-orange-500">Штрихкод не задан в системе</p>
              )}
            </div>

            <BarcodeScanner
              onScan={handleScan}
              active={scannerActive && !unknownModal}
            />

            <button
              onClick={handleNoBarcode}
              className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-xl py-3 text-sm"
            >
              🚫 Нет штрихкода на товаре
            </button>
          </div>
        )}

        {/* Все заказы собраны */}
        {allDone && (
          <div className="bg-green-50 border-2 border-green-300 rounded-2xl p-5 text-center">
            <p className="text-2xl mb-2">✅</p>
            <p className="font-bold text-green-800 text-lg">Все заказы отсканированы!</p>
            <p className="text-green-600 text-sm mb-4">{scannedCount} из {task.total_orders}</p>
            <button
              onClick={() => setDoneModal(true)}
              className="bg-green-600 text-white rounded-xl px-6 py-3 font-bold hover:bg-green-700"
            >
              Завершить задание
            </button>
          </div>
        )}

        {/* Список заказов */}
        <div>
          <h2 className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">
            Список заказов
          </h2>
          <div className="space-y-1.5">
            {task.orders.map((order) => {
              const scanStatus = order.scan?.match_status as ScanStatus | undefined;
              const isCurrent = order.order_code === currentOrder?.order_code;
              return (
                <div
                  key={order.order_code}
                  className={`bg-white rounded-xl border p-3 flex items-center gap-3 ${
                    isCurrent ? "border-blue-400 border-2" : "border-gray-100"
                  }`}
                >
                  <span className="text-lg shrink-0">{matchIcon(scanStatus)}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{order.name}</p>
                    <p className="text-xs text-gray-400">{order.order_code}</p>
                    {order.scan?.barcode_scanned && (
                      <p className="text-xs text-gray-400">ШК: {order.scan.barcode_scanned}</p>
                    )}
                  </div>
                  <span className={`text-xs font-medium shrink-0 ${
                    scanStatus === "matched" ? "text-green-600" :
                    scanStatus === "unknown_barcode" ? "text-yellow-600" :
                    scanStatus === "no_barcode" ? "text-red-500" :
                    scanStatus === "skipped" ? "text-gray-400" :
                    isCurrent ? "text-blue-600" : "text-gray-300"
                  }`}>
                    {isCurrent && !scanStatus ? "← текущий" : matchLabel(scanStatus)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Нижняя кнопка — отказаться */}
      {isMyTask && task.status === "claimed" && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t p-4 max-w-2xl mx-auto">
          <button
            onClick={handleRelease}
            className="w-full text-sm text-gray-400 hover:text-red-500 py-2"
          >
            Вернуть задание в очередь
          </button>
        </div>
      )}

      {/* Модал: неизвестный ШК */}
      {unknownModal && currentOrder && (
        <div className="fixed inset-0 bg-black/60 flex items-end justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-5 space-y-4">
            <h3 className="font-bold text-gray-900 text-lg">⚠️ Неизвестный штрихкод</h3>
            <p className="text-sm text-gray-600">
              Отсканированный ШК <span className="font-mono font-semibold">{unknownModal.barcode}</span> не совпадает с ожидаемым для этого товара.
            </p>
            <p className="text-sm text-gray-600">
              Товар: <span className="font-semibold">{currentOrder.name}</span>
            </p>
            <div className="space-y-2">
              <button
                onClick={() => recordScan(currentOrder.order_code, unknownModal.barcode, "matched")}
                className="w-full bg-green-600 text-white rounded-xl py-3 font-semibold text-sm"
              >
                Всё верно, записать как совпадение
              </button>
              <button
                onClick={() => recordScan(currentOrder.order_code, unknownModal.barcode, "unknown_barcode")}
                className="w-full bg-yellow-500 text-white rounded-xl py-3 font-semibold text-sm"
              >
                Записать на заметку (разобраться потом)
              </button>
              <button
                onClick={() => { setUnknownModal(null); setScannerActive(true); }}
                className="w-full bg-gray-100 text-gray-700 rounded-xl py-3 font-semibold text-sm"
              >
                Сканировать заново
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Модал: подтверждение завершения */}
      {doneModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-5 space-y-4">
            <h3 className="font-bold text-gray-900 text-lg text-center">Завершить задание?</h3>
            <div className="text-sm text-gray-600 space-y-1">
              {task.orders.filter(o => o.scan?.match_status === "matched").length > 0 && (
                <p>✅ Совпало: {task.orders.filter(o => o.scan?.match_status === "matched").length}</p>
              )}
              {task.orders.filter(o => o.scan?.match_status === "unknown_barcode").length > 0 && (
                <p>⚠️ Неизвестный ШК: {task.orders.filter(o => o.scan?.match_status === "unknown_barcode").length}</p>
              )}
              {task.orders.filter(o => o.scan?.match_status === "no_barcode").length > 0 && (
                <p>🚫 Нет ШК: {task.orders.filter(o => o.scan?.match_status === "no_barcode").length}</p>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setDoneModal(false)}
                className="flex-1 bg-gray-100 text-gray-700 rounded-xl py-3 font-semibold text-sm"
              >
                Отмена
              </button>
              <button
                onClick={handleComplete}
                className="flex-1 bg-green-600 text-white rounded-xl py-3 font-semibold text-sm"
              >
                Завершить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
