// CandlesArtifact — OHLC candlesticks (+ optional volume) via lightweight-charts.
//
// Vega-Lite handles analytical charts, but a price series wants a purpose-built
// financial chart: a magnet crosshair, a real time scale, and drag-to-pan /
// scroll-to-zoom that stay smooth over thousands of bars. lightweight-charts is
// ~50 KB gzipped and does exactly that, so it earns its place next to vega.
//
// Content shape (kind = "candles"):
//   { "data": [ { "time": "2026-01-02", "open": 1, "high": 2, "low": 0.5, "close": 1.5,
//                 "volume": 1000 } ], "volume": true }
// A bare array is also accepted. `time` is a "YYYY-MM-DD" string or a UNIX
// timestamp in SECONDS (lightweight-charts' own contract — ms values render as
// year ~55000, so they are converted below).
//
// Loaded ONLY through React.lazy from ArtifactView. See `vendor-charts-fin` in
// vite.config.ts.

import { useEffect, useRef, useState } from 'react';

type Bar = {
	time: string | number;
	open: number; high: number; low: number; close: number;
	volume?: number;
};

// A ms-precision epoch is the single most likely thing to arrive from SQL
// (date_trunc + epoch, or a JS Date). lightweight-charts wants seconds.
function normalizeTime(t: string | number): string | number {
	if (typeof t === 'number' && t > 1e11) return Math.floor(t / 1000);
	return t;
}

function isFiniteNum(v: unknown): v is number {
	return typeof v === 'number' && Number.isFinite(v);
}

export default function CandlesArtifact({ spec }: { spec: string }) {
	const hostRef = useRef<HTMLDivElement>(null);
	const [error, setError] = useState('');

	useEffect(() => {
		let cancelled = false;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		let chart: any;
		let observer: ResizeObserver | undefined;

		(async () => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			let parsed: any;
			try {
				parsed = JSON.parse(spec);
			} catch {
				setError('Invalid candles spec — not JSON.');
				return;
			}
			const rows: Bar[] = Array.isArray(parsed) ? parsed : (parsed?.data ?? []);
			if (!Array.isArray(rows) || !rows.length) {
				setError('No candle data.');
				return;
			}
			// Drop rows missing any OHLC leg rather than letting the library throw on
			// the whole series — a partial price history still plots usefully.
			const bars = rows
				.filter((r) => r && isFiniteNum(r.open) && isFiniteNum(r.high) && isFiniteNum(r.low) && isFiniteNum(r.close))
				.map((r) => ({ ...r, time: normalizeTime(r.time) }));
			if (!bars.length) {
				setError('No candle rows carried a complete open/high/low/close.');
				return;
			}

			try {
				const lw = await import('lightweight-charts');
				if (cancelled || !hostRef.current) return;

				chart = lw.createChart(hostRef.current, {
					height: 300,
					layout: {
						background: { color: 'transparent' },
						textColor: '#475569',
						fontSize: 11,
					},
					grid: {
						vertLines: { color: '#eef2f7' },
						horzLines: { color: '#eef2f7' },
					},
					rightPriceScale: { borderColor: '#cbd5e1' },
					timeScale: { borderColor: '#cbd5e1', timeVisible: false },
					crosshair: { mode: lw.CrosshairMode.Magnet },
					localization: { locale: 'en-US' },
				});

				const candles = chart.addSeries(lw.CandlestickSeries, {
					upColor: '#2fa36b', downColor: '#e0518a',
					borderUpColor: '#2fa36b', borderDownColor: '#e0518a',
					wickUpColor: '#2fa36b', wickDownColor: '#e0518a',
				});
				candles.setData(bars.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));

				// Volume rides as an overlay on its own hidden scale, pinned to the
				// bottom 20% so it never fights the price series for vertical room.
				const wantVolume = parsed?.volume !== false && bars.some((b) => isFiniteNum(b.volume));
				if (wantVolume) {
					const vol = chart.addSeries(lw.HistogramSeries, {
						priceScaleId: '',
						priceFormat: { type: 'volume' },
					});
					vol.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
					vol.setData(
						bars.filter((b) => isFiniteNum(b.volume)).map((b) => ({
							time: b.time,
							value: b.volume as number,
							color: b.close >= b.open ? 'rgba(47,163,107,0.4)' : 'rgba(224,81,138,0.4)',
						})),
					);
				}

				chart.timeScale().fitContent();

				// The artifact panel is resizable, and lightweight-charts sizes to an
				// explicit width — so it needs to be told when the host box changes.
				observer = new ResizeObserver(([entry]) => {
					if (entry?.contentRect.width) chart.applyOptions({ width: entry.contentRect.width });
				});
				observer.observe(hostRef.current);
			} catch (e) {
				if (!cancelled) setError(e instanceof Error ? e.message : String(e));
			}
		})();

		return () => {
			cancelled = true;
			observer?.disconnect();
			try { chart?.remove(); } catch { /* already removed */ }
		};
	}, [spec]);

	if (error) {
		return <div className="text-rose-600 text-[11.5px] whitespace-pre-wrap break-words">{error}</div>;
	}
	return <div ref={hostRef} className="w-full" />;
}
