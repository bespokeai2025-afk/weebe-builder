import { Area, AreaChart, ResponsiveContainer, Tooltip } from "recharts";

export interface SparkPoint {
  date: string;
  value: number;
}

function formatShortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

export function MetricSparkline({
  points,
  formatValue,
  height = 44,
}: {
  points: SparkPoint[];
  formatValue?: (v: number) => string;
  height?: number;
}) {
  if (!points || points.length < 2) return null;
  return (
    <div style={{ height }} className="w-full mt-2">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="am-spark-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#34d399" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#34d399" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <Tooltip
            cursor={{ stroke: "rgba(255,255,255,0.15)", strokeWidth: 1 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as SparkPoint;
              return (
                <div className="rounded-md border border-white/10 bg-gray-900 px-2 py-1 text-[10px] shadow-lg">
                  <span className="text-gray-400">{formatShortDate(p.date)}: </span>
                  <span className="font-semibold text-emerald-300">
                    {formatValue ? formatValue(p.value) : p.value.toLocaleString()}
                  </span>
                </div>
              );
            }}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke="#34d399"
            strokeWidth={1.5}
            fill="url(#am-spark-fill)"
            dot={false}
            activeDot={{ r: 3, fill: "#34d399", stroke: "none" }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
