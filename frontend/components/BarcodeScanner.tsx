"use client";
/**
 * BarcodeScanner — камера + ZXing для скана штрихкода.
 * Работает только в браузере (динамический импорт без SSR).
 * onScan вызывается один раз на успешный скан, потом пауза pauseMs мс.
 */
import { useEffect, useRef, useState } from "react";

interface Props {
  onScan: (barcode: string) => void;
  active?: boolean;          // пауза скана (например, пока модал открыт)
  pauseMs?: number;          // пауза после скана перед следующим (default 1500)
}

export default function BarcodeScanner({ onScan, active = true, pauseMs = 1500 }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const readerRef = useRef<unknown>(null);
  const pausedUntil = useRef<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let stopped = false;

    async function start() {
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        const reader = new BrowserMultiFormatReader();
        readerRef.current = reader;

        if (stopped || !videoRef.current) return;

        // Непрерывное декодирование с камеры
        await reader.decodeFromConstraints(
          {
            video: {
              facingMode: "environment",
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
          },
          videoRef.current,
          (result, err) => {
            if (stopped) return;
            if (result) {
              const now = Date.now();
              if (now < pausedUntil.current) return;
              if (!active) return;
              pausedUntil.current = now + pauseMs;
              onScan(result.getText());
            }
          }
        );
        setLoading(false);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("Permission") || msg.includes("NotAllowed")) {
          setError("Нет доступа к камере. Разрешите доступ в настройках браузера.");
        } else {
          setError(`Ошибка камеры: ${msg}`);
        }
        setLoading(false);
      }
    }

    start();

    return () => {
      stopped = true;
      const r = readerRef.current as { reset?: () => void } | null;
      r?.reset?.();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) {
    return (
      <div className="flex items-center justify-center bg-gray-900 text-white rounded-xl p-6 text-sm text-center">
        {error}
      </div>
    );
  }

  return (
    <div className="relative bg-black rounded-xl overflow-hidden" style={{ aspectRatio: "4/3" }}>
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center text-white text-sm z-10">
          Загрузка камеры…
        </div>
      )}
      <video
        ref={videoRef}
        className="w-full h-full object-cover"
        muted
        playsInline
        autoPlay
      />
      {/* Визуальный прицел */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div
          className="border-2 border-green-400 rounded"
          style={{ width: "60%", height: "30%", boxShadow: "0 0 0 9999px rgba(0,0,0,0.4)" }}
        />
      </div>
      {!active && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center text-white text-sm z-20">
          Пауза…
        </div>
      )}
    </div>
  );
}
