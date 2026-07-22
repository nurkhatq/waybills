"use client";
import { useEffect, useRef, useState } from "react";

interface Props {
  onScan: (barcode: string) => void;
  active?: boolean;
  pauseMs?: number;
}

export default function BarcodeScanner({ onScan, active = true, pauseMs = 1500 }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const pausedUntil = useRef<number>(0);
  const activeRef = useRef(active);
  const onScanRef = useRef(onScan);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const torchOnRef = useRef(false);

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
    let timerId: ReturnType<typeof setTimeout> | null = null;

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
        });

        if (stopped) { stream.getTracks().forEach(t => t.stop()); return; }

        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();

        const track = stream.getVideoTracks()[0];
        if (track) {
          trackRef.current = track;
          const caps = track.getCapabilities() as Record<string, unknown>;
          if (caps.torch) setTorchSupported(true);
          const zoomCap = caps.zoom as { min: number; max: number } | undefined;
          if (zoomCap) {
            const maxZ = Math.min(zoomCap.max, 4);
            setZoomRange({ min: zoomCap.min, max: maxZ });
            const defaultZ = Math.min(2, maxZ);
            if (defaultZ > zoomCap.min) {
              try {
                await track.applyConstraints({ advanced: [{ zoom: defaultZ } as MediaTrackConstraintSet] });
                setZoom(defaultZ);
              } catch {}
            }
          }
        }

        // Динамический импорт — загружается только в браузере
        const { readBarcodes } = await import("zxing-wasm/reader");

        if (stopped) return;

        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

        setLoading(false);

        async function scan() {
          if (stopped) return;

          if (activeRef.current && video.readyState >= 3 && video.videoWidth > 0) {
            if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
            if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;
            ctx.drawImage(video, 0, 0);
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

            try {
              const results = await readBarcodes(imageData, {
                tryHarder: true,
                formats: ["Linear-Codes"], // только 1D штрихкоды, без QR/DataMatrix/Aztec
                maxSymbols: 1,
              });

              if (!stopped && results.length > 0 && results[0].isValid) {
                const now = Date.now();
                if (now >= pausedUntil.current) {
                  pausedUntil.current = now + pauseMs;
                  onScanRef.current(results[0].text);
                }
              }
            } catch {}
          }

          if (!stopped) timerId = setTimeout(scan, 100);
        }

        scan();
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
      if (timerId) clearTimeout(timerId);
      if (torchOnRef.current && trackRef.current) {
        try { trackRef.current.applyConstraints({ advanced: [{ torch: false } as MediaTrackConstraintSet] }); } catch {}
        torchOnRef.current = false;
      }
      const video = videoRef.current;
      if (video?.srcObject) {
        (video.srcObject as MediaStream).getTracks().forEach(t => t.stop());
        video.srcObject = null;
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function toggleTorch() {
    const track = trackRef.current;
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      torchOnRef.current = next;
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
        {!loading && (
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-4 left-4 w-8 h-8 border-t-4 border-l-4 border-green-400 rounded-tl" />
            <div className="absolute top-4 right-4 w-8 h-8 border-t-4 border-r-4 border-green-400 rounded-tr" />
            <div className="absolute bottom-4 left-4 w-8 h-8 border-b-4 border-l-4 border-green-400 rounded-bl" />
            <div className="absolute bottom-4 right-4 w-8 h-8 border-b-4 border-r-4 border-green-400 rounded-br" />
          </div>
        )}
        {!active && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center text-white text-sm z-20">
            Пауза…
          </div>
        )}
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
                  Math.abs(zoom - v) < 0.1 ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600"
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
