"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import dynamic from "next/dynamic";
import { picker, PickerTask, PickerOrderItem, loadUser } from "@/lib/api";

const BarcodeScanner = dynamic(() => import("@/components/BarcodeScanner"), { ssr: false });

type ScanStatus = "matched" | "unknown_barcode" | "no_barcode" | "skipped";

function matchIcon(s?: ScanStatus | null) {
  if (s === "matched") return "✅";
  if (s === "unknown_barcode") return "⚠️";
  if (s === "no_barcode") return "🚫";
  if (s === "skipped") return "⏭";
  return "⬜";
}
function matchLabel(s?: ScanStatus | null) {
  if (s === "matched") return "Совпало";
  if (s === "unknown_barcode") return "Неизвестный ШК";
  if (s === "no_barcode") return "Нет ШК";
  if (s === "skipped") return "Пропущен";
  return "Ожидает";
}

/* ── Режим сканирования ─────────────────────────────────────────────────────── */
type ScanMode = "per-order" | "bulk";   // per-order = по одному, bulk = скан + кол-во

export default function PickerTaskPage() {
  const router = useRouter();
  const params = useParams();
  const taskId = Number(params.task_id);

  const [task, setTask] = useState<PickerTask | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);

  // Режим: per-order (по заказу) или bulk (скан + кол-во, только тип A)
  // Тип A по умолчанию — bulk (быстрый режим)
  const [scanMode, setScanMode] = useState<ScanMode>("per-order");
  const [modeInitialized, setModeInitialized] = useState(false);

  // Текущий заказ (per-order)
  const [currentOrder, setCurrentOrder] = useState<PickerOrderItem | null>(null);

  // Состояния UI
  const [scannerActive, setScannerActive] = useState(true);
  const [processing, setProcessing] = useState(false);

  // Модал неизвестного ШК
  const [unknownModal, setUnknownModal] = useState<{ barcode: string; orderCode: string; orderItem: PickerOrderItem | null } | null>(null);

  // Быстрый режим: после скана — ввод кол-ва
  const [bulkBarcode, setBulkBarcode] = useState<string | null>(null);  // lastScanned barcode
  const [bulkQty, setBulkQty] = useState(1);
  const qtyInputRef = useRef<HTMLInputElement>(null);

  // Модал завершения
  const [doneModal, setDoneModal] = useState(false);

  const loadTask = useCallback(async () => {
    try {
      const t = await picker.getTask(taskId);
      setTask(t);
      setCurrentOrder(nextPending(t));
      // Тип A → по умолчанию быстрый режим (bulk)
      if (!modeInitialized) {
        if (t.task_type === "A") setScanMode("bulk");
        setModeInitialized(true);
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setLoading(false);
    }
  }, [taskId, modeInitialized]);

  function nextPending(t: PickerTask): PickerOrderItem | null {
    return t.orders.find(o => !o.scan) ?? null;
  }

  useEffect(() => {
    const u = loadUser();
    if (!u) { router.replace("/login"); return; }
    setUsername(u.username);
    loadTask();
  }, [router, loadTask]);

  // ── PER-ORDER MODE ───────────────────────────────────────────────────────────

  async function handleScanPerOrder(barcode: string) {
    if (!task || !currentOrder || !scannerActive || processing) return;
    setScannerActive(false);
    setProcessing(true);

    // Для типа A штрихкод хранится на уровне task, для B — в order item
    const expected = currentOrder.expected_barcode ?? task.expected_barcode;
    const isKit = (currentOrder as PickerOrderItem & { is_kit?: boolean }).is_kit;

    let status: ScanStatus = "matched";
    if (!expected && !isKit) {
      // Нет штрихкода в системе — записываем, откроем модал
      status = "unknown_barcode";
    } else if (expected && barcode !== expected) {
      // Не совпало — проверим через API
      try {
        const lookup = await picker.lookupBarcode(barcode);
        if (!lookup.found) {
          status = "unknown_barcode";
        } else if (lookup.main_sku !== currentOrder.offer_code && !isKit) {
          status = "unknown_barcode";
        }
      } catch {
        status = "unknown_barcode";
      }
    }

    if (status === "unknown_barcode") {
      setUnknownModal({ barcode, orderCode: currentOrder.order_code, orderItem: currentOrder });
      setProcessing(false);
      return;
    }

    await doScan(currentOrder.order_code, barcode, status);
  }

  async function doScan(orderCode: string, barcode: string | null, status: ScanStatus) {
    if (!task) return;
    try {
      const updated = await picker.scan(taskId, { order_code: orderCode, barcode: barcode ?? undefined, match_status: status });
      setTask(updated);
      setCurrentOrder(nextPending(updated));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setUnknownModal(null);
      setScannerActive(true);
      setProcessing(false);
    }
  }

  async function handleNoBarcode() {
    if (!currentOrder || processing) return;
    setScannerActive(false);
    setProcessing(true);
    await doScan(currentOrder.order_code, null, "no_barcode");
  }

  // ── BULK MODE ────────────────────────────────────────────────────────────────

  async function handleScanBulk(barcode: string) {
    if (!task || !scannerActive || processing) return;
    // Первый скан → показываем ввод кол-ва
    setScannerActive(false);
    setBulkBarcode(barcode);
    const remaining = task.orders.filter(o => !o.scan).length;
    setBulkQty(remaining); // по умолчанию всё что осталось
    setTimeout(() => qtyInputRef.current?.focus(), 100);
  }

  async function handleBulkConfirm() {
    if (!task || bulkQty < 1 || processing) return;
    setProcessing(true);
    try {
      const updated = await picker.bulkScan(taskId, { barcode: bulkBarcode, quantity: bulkQty });
      setTask(updated);
      setCurrentOrder(nextPending(updated));
      setBulkBarcode(null);
      setBulkQty(1);
      setScannerActive(true);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
      setProcessing(false);
    } finally {
      setProcessing(false);
    }
  }

  function handleBulkCancel() {
    setBulkBarcode(null);
    setBulkQty(1);
    setScannerActive(true);
  }

  // ── COMPLETE ────────────────────────────────────────────────────────────────

  async function handleComplete() {
    try {
      const result = await picker.complete(taskId);
      setDoneModal(false);
      if (result.assemble_errors && result.assemble_errors.length > 0) {
        setError(`Выполнено. Ошибки передачи в Kaspi (${result.assemble_errors.length}): ${result.assemble_errors.slice(0, 3).join(", ")}`);
      } else {
        router.push("/picker");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    }
  }

  async function handleRelease() {
    if (!confirm("Вернуть задание в очередь? Прогресс будет сброшен.")) return;
    try {
      await picker.release(taskId);
      router.push("/picker");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    }
  }

  // ── RENDER ──────────────────────────────────────────────────────────────────

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
  const remaining = task.orders.filter(o => !o.scan).length;
  const isTypeA = task.task_type === "A";
  const isBulkEntry = scanMode === "bulk" && bulkBarcode !== null;

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* ── Header ── */}
      <div className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h1 className="text-base font-bold text-gray-900">
                Задание #{task.id}
                <span className={`ml-2 text-xs rounded px-1.5 py-0.5 font-medium ${
                  isTypeA ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"
                }`}>{task.task_type}</span>
              </h1>
              {task.product_name && (
                <p className="text-xs text-gray-500 truncate max-w-xs">{task.product_name}</p>
              )}
            </div>
            <button onClick={() => router.push("/picker")} className="text-sm text-blue-600">
              ← Назад
            </button>
          </div>
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div className="h-full bg-green-500 transition-all" style={{ width: `${progress}%` }} />
          </div>
          <p className="text-xs text-gray-500 mt-1">{scannedCount} / {task.total_orders} заказов</p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 pt-4 space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm">
            {error}
            <button className="ml-2 underline" onClick={() => setError(null)}>ОК</button>
          </div>
        )}

        {/* ── Режим сканирования (только тип A) ── */}
        {isTypeA && isMyTask && !allDone && (
          <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl p-3">
            <span className="text-xs text-gray-500 mr-1">Режим:</span>
            <button
              onClick={() => { setScanMode("per-order"); setBulkBarcode(null); setScannerActive(true); }}
              className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition-all ${
                scanMode === "per-order" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600"
              }`}
            >
              По заказу
            </button>
            <button
              onClick={() => { setScanMode("bulk"); setBulkBarcode(null); setScannerActive(true); }}
              className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition-all ${
                scanMode === "bulk" ? "bg-purple-600 text-white" : "bg-gray-100 text-gray-600"
              }`}
            >
              Скан + кол-во
            </button>
          </div>
        )}

        {/* ── Текущий заказ (per-order) ── */}
        {isMyTask && !allDone && scanMode === "per-order" && currentOrder && (
          <div className="bg-white rounded-2xl border-2 border-blue-200 p-3">
            <p className="text-xs font-semibold text-blue-500 mb-1">СЕЙЧАС ИЩЕМ</p>
            <p className="font-semibold text-gray-900 text-sm leading-tight">{currentOrder.name}</p>
            <p className="text-xs text-gray-400 mt-0.5">{currentOrder.order_code}</p>
            {/* Для типа A штрихкод хранится на уровне task, для B — в каждом order item */}
            {(currentOrder.expected_barcode || task.expected_barcode) && (
              <p className="text-xs text-gray-400">ШК: {currentOrder.expected_barcode ?? task.expected_barcode}</p>
            )}
            {!(currentOrder as PickerOrderItem & { is_kit?: boolean }).is_kit && !currentOrder.expected_barcode && !task.expected_barcode && (
              <p className="text-xs text-orange-500">Штрихкод не задан в системе</p>
            )}
            {(currentOrder as PickerOrderItem & { is_kit?: boolean }).is_kit && (
              <p className="text-xs text-purple-500">Комплект — скан любого компонента</p>
            )}
          </div>
        )}

        {/* ── Быстрый режим: ввод кол-ва после скана ── */}
        {isMyTask && !allDone && scanMode === "bulk" && isBulkEntry && (
          <div className="bg-purple-50 border-2 border-purple-300 rounded-2xl p-4 space-y-3">
            <p className="text-sm font-semibold text-purple-800">
              Отсканировано: <span className="font-mono">{bulkBarcode}</span>
            </p>
            <p className="text-xs text-purple-600">Осталось заказов: {remaining}. Сколько собрали?</p>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setBulkQty(q => Math.max(1, q - 1))}
                className="w-10 h-10 bg-white border-2 border-purple-300 rounded-xl text-xl font-bold text-purple-700"
              >−</button>
              <input
                ref={qtyInputRef}
                type="number"
                min={1}
                max={remaining}
                value={bulkQty}
                onChange={e => setBulkQty(Math.min(remaining, Math.max(1, Number(e.target.value))))}
                className="flex-1 text-center text-2xl font-bold border-2 border-purple-300 rounded-xl py-2 outline-none focus:border-purple-500"
              />
              <button
                onClick={() => setBulkQty(q => Math.min(remaining, q + 1))}
                className="w-10 h-10 bg-white border-2 border-purple-300 rounded-xl text-xl font-bold text-purple-700"
              >+</button>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleBulkCancel}
                className="flex-1 bg-gray-100 text-gray-700 rounded-xl py-3 text-sm font-semibold"
              >
                Пересканировать
              </button>
              <button
                onClick={handleBulkConfirm}
                disabled={processing}
                className="flex-1 bg-purple-600 text-white rounded-xl py-3 text-sm font-bold disabled:opacity-50"
              >
                {processing ? "…" : `Подтвердить ${bulkQty}`}
              </button>
            </div>
          </div>
        )}

        {/* ── Камера ── */}
        {isMyTask && !allDone && !isBulkEntry && (
          <div className="space-y-3">
            <BarcodeScanner
              onScan={scanMode === "per-order" ? handleScanPerOrder : handleScanBulk}
              active={scannerActive && !unknownModal && !processing}
            />
            {scanMode === "per-order" && (
              <button
                onClick={handleNoBarcode}
                disabled={processing || !currentOrder}
                className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-xl py-3 text-sm disabled:opacity-40"
              >
                🚫 Нет штрихкода на товаре
              </button>
            )}
            {scanMode === "bulk" && (
              <p className="text-xs text-center text-gray-400">Отсканируйте штрихкод любого товара из задания</p>
            )}
          </div>
        )}

        {/* ── Все собраны ── */}
        {allDone && (
          <div className="bg-green-50 border-2 border-green-300 rounded-2xl p-5 text-center">
            <p className="text-2xl mb-2">✅</p>
            <p className="font-bold text-green-800 text-lg">Все заказы отсканированы!</p>
            <p className="text-green-600 text-sm mb-4">{scannedCount} из {task.total_orders}</p>
            <button
              onClick={() => setDoneModal(true)}
              className="bg-green-600 text-white rounded-xl px-6 py-3 font-bold hover:bg-green-700"
            >
              Завершить и передать в Kaspi
            </button>
          </div>
        )}

        {/* ── Список заказов ── */}
        <div>
          <h2 className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">
            Список заказов
          </h2>
          <div className="space-y-1.5">
            {task.orders.map((order) => {
              const st = order.scan?.match_status as ScanStatus | undefined;
              const isCurrent = order.order_code === currentOrder?.order_code;
              return (
                <div
                  key={order.order_code}
                  className={`bg-white rounded-xl border p-3 flex items-center gap-3 ${
                    isCurrent && !allDone ? "border-blue-400 border-2" : "border-gray-100"
                  }`}
                >
                  <span className="text-lg shrink-0">{matchIcon(st)}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{order.name}</p>
                    <p className="text-xs text-gray-400">{order.order_code}</p>
                    {order.scan?.barcode_scanned && (
                      <p className="text-xs text-gray-400 font-mono">{order.scan.barcode_scanned}</p>
                    )}
                  </div>
                  <span className={`text-xs font-medium shrink-0 ${
                    st === "matched" ? "text-green-600" :
                    st === "unknown_barcode" ? "text-yellow-600" :
                    st === "no_barcode" ? "text-red-500" :
                    isCurrent && !allDone ? "text-blue-600" : "text-gray-300"
                  }`}>
                    {isCurrent && !st ? "← текущий" : matchLabel(st)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Нижняя кнопка ── */}
      {isMyTask && task.status === "claimed" && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t p-4">
          <button onClick={handleRelease} className="w-full text-sm text-gray-400 hover:text-red-500 py-2 max-w-2xl mx-auto block">
            Вернуть задание в очередь
          </button>
        </div>
      )}

      {/* ── Модал: неизвестный ШК ── */}
      {unknownModal && (
        <div className="fixed inset-0 bg-black/60 flex items-end justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-5 space-y-3">
            <h3 className="font-bold text-gray-900">⚠️ Неизвестный штрихкод</h3>
            <p className="text-sm text-gray-600">
              <span className="font-mono font-semibold text-xs bg-gray-100 px-1 py-0.5 rounded">{unknownModal.barcode}</span>
              {" "}не совпадает с ожидаемым
            </p>
            {unknownModal.orderItem && (
              <p className="text-xs text-gray-500">Товар: {unknownModal.orderItem.name}</p>
            )}
            <div className="space-y-2">
              <button
                onClick={() => doScan(unknownModal.orderCode, unknownModal.barcode, "matched")}
                className="w-full bg-green-600 text-white rounded-xl py-3 font-semibold text-sm"
              >
                ✅ Всё верно, это нужный товар
              </button>
              <button
                onClick={() => doScan(unknownModal.orderCode, unknownModal.barcode, "unknown_barcode")}
                className="w-full bg-yellow-500 text-white rounded-xl py-3 font-semibold text-sm"
              >
                ⚠️ Записать на заметку (разобраться позже)
              </button>
              <button
                onClick={() => { setUnknownModal(null); setScannerActive(true); setProcessing(false); }}
                className="w-full bg-gray-100 text-gray-700 rounded-xl py-3 font-semibold text-sm"
              >
                Пересканировать
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Модал: подтверждение завершения ── */}
      {doneModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-5 space-y-4">
            <h3 className="font-bold text-gray-900 text-lg text-center">Завершить и передать в Kaspi?</h3>
            <div className="text-sm text-gray-600 space-y-1 bg-gray-50 rounded-xl p-3">
              {task.orders.filter(o => o.scan?.match_status === "matched").length > 0 && (
                <p>✅ Собрано: {task.orders.filter(o => o.scan?.match_status === "matched").length}</p>
              )}
              {task.orders.filter(o => o.scan?.match_status === "unknown_barcode").length > 0 && (
                <p>⚠️ Неизвестный ШК: {task.orders.filter(o => o.scan?.match_status === "unknown_barcode").length}</p>
              )}
              {task.orders.filter(o => o.scan?.match_status === "no_barcode").length > 0 && (
                <p>🚫 Нет ШК: {task.orders.filter(o => o.scan?.match_status === "no_barcode").length}</p>
              )}
            </div>
            <p className="text-xs text-gray-400 text-center">
              Все подтверждённые заказы получат статус &quot;Собран&quot; в Kaspi
            </p>
            <div className="flex gap-2">
              <button onClick={() => setDoneModal(false)} className="flex-1 bg-gray-100 text-gray-700 rounded-xl py-3 font-semibold text-sm">
                Отмена
              </button>
              <button onClick={handleComplete} className="flex-1 bg-green-600 text-white rounded-xl py-3 font-bold text-sm">
                Завершить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
