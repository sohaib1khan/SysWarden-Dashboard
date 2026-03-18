import {
  LineChart as ReLineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'

export default function LineChart({ data, dataKey = 'value', unit = '', color = '#818cf8' }) {
  const formatted = data.map((p) => ({
    ...p,
    time: new Date(p.timestamp).toLocaleTimeString(),
  }))

  return (
    <ResponsiveContainer width="100%" height={200}>
      <ReLineChart data={formatted} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
        <XAxis
          dataKey="time"
          tick={{ fill: '#6b7280', fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fill: '#6b7280', fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => `${v}${unit}`}
        />
        <Tooltip
          contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 6 }}
          labelStyle={{ color: '#9ca3af' }}
          itemStyle={{ color: color }}
          formatter={(v) => [`${v}${unit}`, dataKey]}
        />
        <Line
          type="monotone"
          dataKey={dataKey}
          stroke={color}
          dot={false}
          strokeWidth={2}
          isAnimationActive={false}
        />
      </ReLineChart>
    </ResponsiveContainer>
  )
}
