"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

interface WeightChartProps {
  data: { ticker: string; current: number; target: number }[];
}

export function WeightChart({ data }: WeightChartProps) {
  if (data.length === 0) return null;
  return (
    <div style={{ height: 180 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: -16 }}>
          <XAxis dataKey="ticker" tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} />
          <Tooltip
            contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, fontSize: 12 }}
            formatter={(v) => [`${Number(v).toFixed(1)}%`]}
          />
          <Bar dataKey="current" fill="#3b82f680" radius={[3, 3, 0, 0]} />
          <Bar dataKey="target" fill="#22c55e80" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
