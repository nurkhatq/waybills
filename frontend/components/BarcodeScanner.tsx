"use client";
import { useEffect, useRef, useState } from "react";

interface Props {
  onScan: (barcode: string) => void;
  active?: boolean;
  pauseMs?: number;
}

export default function BarcodeScanner({ onScan, active = true, pauseMs = 1500 }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const readerRef = useRef<unknown>(null);
  const pausedUntil = useRef<number>(0);
  const activeRef = useRef(active);
  const onScanRef = useRef(onScan);
  const trackRef = useRef<MediaStreamTrack | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [zoomRange, setZoomRange] = useState<{ min: number; max: number } | null>(null);

  useEffect(() => {
    activeRef.current = active;
    if (active) pausedUntil.current = 0;
  }, [active]);

  useEffect(() => { onScanRef.current = onScan; }, [onScan]);

  useEffect(() => {
    let stopped = false;

    async function start() {
      try {
        const { BrowserMultiFormatReader, DecodeHintType } = await import("@zxing/browser" as never) as never as {
          BrowserMultiFormatReader: new (hints?: Map<number, unknown>, interval?: number) => {
            decodeFromConstraints: (c: MediaStreamConstraints, v: HTMLVideoElement, cb: (r: unknown, e: unknown) => void) => Promise<void>;
            reset: () => void;
          };
          DecodeHintType: { TRY_HARDER: number };
        };

        const hints = new Map<number, unknown>();
        hints.set(DecodeHintType.TRY_HARDER, true);

        // 100мс между попытками вместо дефолтных 500мс
        const reader = new BrowserMultiFormatReader(hints, 100);
        readerRef.current = reader;

        if (stopped || !videoRef.current) return;

        await reader.decodeFromConstraints(
          {
            video: {
              facingMode: "environment",
              width: { ideal: 1920 },
              height: { ideal: 1080 },
            },
          },
          videoRef.current,
          (result: unknown) => {
            if (stopped || !result) return;
            const now = Date.now();
            if (now < pausedUntil.current || !activeRef.current) return;
            pausedUntil.current = now + pauseMs;
            const text = (result as { getText: () => string }).getText();
            onScanRef.current(text);
          }
        );

        // После запуска камеры получаем возможности трека
        if (videoRef.current?.srcObject) {
          const stream = videoRef.current.srcObject as MediaStream;
          const track = stream.getVideoTracks()[0];
          if (track) {
            trackRef.current = track;
            const caps = track.getCapabilities() as Record<string, unknown>;
            if (caps.torch) setTorchSupported(true);
            const zoomCap = caps.zoom as { min: number; max: number; step: number } | undefined;
            if (zoomCap) setZoomRange({ min: zoomCap.min, max: Math.min(zoomCap.max, 4) });
          }
        }

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

  async function toggleTorch() {
    const track = trackRef.current;
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorchOn(next);
    } catch {}
  }

  async function applyZoom(val: number) {
    const track = trackRef.current;
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ zoom: val } as MediaTrackConstraintSet] });
      setZoom(val);
    } catch {}
  }

  if (error) {
    return (
      <div className="flex items-center justify-center bg-gray-900 text-white rounded-xl p-6 text-sm text-center">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative bg-black rounded-xl overflow-hidden" style={{ height: "65vw", maxHeight: "420px", minHeight: "260px" }}>
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center text-white text-sm z-10">
            Загрузка камеры…
          </div>
        )}
        <video ref={videoRef} className="w-full h-full object-cover" muted playsInline autoPlay />
        {/* Угловые маркеры — вся площадь сканируется */}
        {!loading && (
          <div className="absolute inset-0 pointer-events-none p-4">
            {/* Верх-лево */}
            <div className="absolute top-4 left-4 w-8 h-8 border-t-4 border-l-4 border-green-400 rounded-tl" />
            {/* Верх-право */}
            <div className="absolute top-4 right-4 w-8 h-8 border-t-4 border-r-4 border-green-400 rounded-tr" />
            {/* Низ-лево */}
            <div className="absolute bottom-4 left-4 w-8 h-8 border-b-4 border-l-4 border-green-400 rounded-bl" />
            {/* Низ-право */}
            <div className="absolute bottom-4 right-4 w-8 h-8 border-b-4 border-r-4 border-green-400 rounded-br" />
          </div>
        )}
        {!active && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center text-white text-sm z-20">
            Пауза…
          </div>
        )}
        {/* Кнопка фонарика */}
        {torchSupported && !loading && (
          <button
            onClick={toggleTorch}
            className={`absolute top-3 right-3 z-20 rounded-full w-11 h-11 flex items-center justify-center text-xl shadow-lg transition-colors ${
              torchOn ? "bg-yellow-400 text-black" : "bg-black/60 text-white"
            }`}
          >
            🔦
          </button>
        )}
      </div>

      {/* Зум (если поддерживается) */}
      {zoomRange && !loading && (
        <div className="flex items-center gap-2 px-1">
          <button
            onClick={() => applyZoom(Math.max(zoomRange.min, zoom - 0.5))}
            className="w-9 h-9 rounded-lg bg-gray-100 text-gray-700 font-bold text-lg flex items-center justify-center"
          >−</button>
          <div className="flex-1 flex gap-1 justify-center">
            {[1, 1.5, 2, 2.5].filter(v => v >= zoomRange.min && v <= zoomRange.max).map(v => (
              <button
                key={v}
                onClick={() => applyZoom(v)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  Math.abs(zoom - v) < 0.1
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 text-gray-600"
                }`}
              >
                {v}×
              </button>
            ))}
          </div>
          <button
            onClick={() => applyZoom(Math.min(zoomRange.max, zoom + 0.5))}
            className="w-9 h-9 rounded-lg bg-gray-100 text-gray-700 font-bold text-lg flex items-center justify-center"
          >+</button>
        </div>
      )}
    </div>
  );
}
