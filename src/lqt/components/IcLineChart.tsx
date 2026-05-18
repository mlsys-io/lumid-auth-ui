/**
 * `IcLineChart` — signal information coefficient over time.
 *
 * Reads from `lqt.signals.ic_v1` via `/api/research/signal-ic`. The
 * IC gate threshold at ±0.03 (per T-FM-025) is rendered as a
 * reference band so the researcher can spot when a signal slides
 * below the suppression boundary.
 */

import { useMemo } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { SignalIcPoint } from '../types';

interface IcLineChartProps {
  points: SignalIcPoint[];
  signalName: string;
  /** Reference band threshold; default ±0.03 from T-FM-025. */
  threshold?: number;
  className?: string;
}

interface RechartsDatum {
  day: string;
  mean_ic: number;
  p_value: number;
  regime_context: string;
}

function toChartData(points: SignalIcPoint[]): RechartsDatum[] {
  return points.map((p) => ({
    day: p.day,
    mean_ic: Number.isFinite(p.mean_ic) ? p.mean_ic : 0,
    p_value: p.p_value,
    regime_context: p.regime_context,
  }));
}

function fmtIc(v: number): string {
  return v.toFixed(4);
}

export function IcLineChart({
  points,
  signalName,
  threshold = 0.03,
  className,
}: IcLineChartProps) {
  const data = useMemo(() => toChartData(points), [points]);

  if (data.length === 0) {
    return (
      <div
        className={`flex h-64 items-center justify-center text-sm text-muted-foreground ${className ?? ''}`}
      >
        No IC data for {signalName}.
      </div>
    );
  }

  return (
    <div className={`h-64 w-full ${className ?? ''}`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="day" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => Number(v).toFixed(3)} />
          <Tooltip
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            formatter={(value: any, name: any, ctx: any) => {
              const row = ctx?.payload as RechartsDatum | undefined;
              if (name === 'mean_ic') {
                return [fmtIc(Number(value)), 'mean IC'];
              }
              if (name === 'p_value' && row) {
                return [Number(value).toFixed(3), 'p-value'];
              }
              if (name === 'regime_context' && row) {
                return [row.regime_context, 'regime'];
              }
              return [String(value), String(name)];
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <ReferenceLine y={threshold} stroke="orange" strokeDasharray="3 3" />
          <ReferenceLine y={-threshold} stroke="orange" strokeDasharray="3 3" />
          <ReferenceLine y={0} stroke="#888" />
          <Line
            type="monotone"
            dataKey="mean_ic"
            stroke="#4f46e5"
            strokeWidth={2}
            dot={{ r: 2 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default IcLineChart;
