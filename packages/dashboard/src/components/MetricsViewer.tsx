import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MetricDataPoint } from '@/types';
import { TIME_RANGE_OPTIONS, type TimeRange } from '@/types';
import { Activity, BarChart3, Calendar, Clock, Gauge, Hash, LineChart } from 'lucide-react';
import {
    Sidebar,
    SidebarHeader,
    SidebarContent,
    SidebarSection,
    SidebarSectionTitle,
} from '@/components/ui/sidebar';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    AreaChart,
    Area,
    BarChart,
    Bar,
    LineChart as RechartsLineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip as RechartsTooltip,
    ResponsiveContainer,
    Legend,
} from 'recharts';

interface MetricsViewerProps {
    metrics: MetricDataPoint[];
    channelName: string | null;
}

/** Group metrics into time buckets for charting */
function bucketByTime(metrics: MetricDataPoint[], bucketMs = 10_000) {
    const byBucket = new Map<number, MetricDataPoint[]>();
    for (const m of metrics) {
        const t = typeof m.timeUnixNano === 'string'
            ? Math.floor(Number(BigInt(m.timeUnixNano) / BigInt(1_000_000)) / bucketMs) * bucketMs
            : Math.floor((m.timeUnixNano / 1_000_000) / bucketMs) * bucketMs;
        const arr = byBucket.get(t);
        if (arr) arr.push(m);
        else byBucket.set(t, [m]);
    }
    return byBucket;
}

function formatTime(ts: number) {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** Compute P50, P95, P99 from an array of numbers */
function percentiles(values: number[]) {
    if (values.length === 0) return { p50: 0, p95: 0, p99: 0, avg: 0 };
    const sorted = [...values].sort((a, b) => a - b);
    const p = (pct: number) => sorted[Math.min(Math.floor(sorted.length * pct), sorted.length - 1)];
    const avg = values.reduce((s, v) => s + v, 0) / values.length;
    return { p50: p(0.5), p95: p(0.95), p99: p(0.99), avg: Math.round(avg * 100) / 100 };
}

const METRICS_TIME_RANGES: TimeRange[] = ['5m', '10m', '15m', '30m', '1h', '12h', '1d', '3d', '1w', '2w', 'all'];

function filterByTimeRange(metrics: MetricDataPoint[], range: TimeRange): MetricDataPoint[] {
    const rangeMs = TIME_RANGE_OPTIONS[range];
    if (rangeMs === 0) return metrics;
    const cutoff = (Date.now() - rangeMs) * 1_000_000; // convert to nanoseconds
    return metrics.filter(m => {
        const t = typeof m.timeUnixNano === 'string' ? Number(BigInt(m.timeUnixNano)) : m.timeUnixNano;
        return t >= cutoff;
    });
}

const PALETTE = [
    'hsl(var(--chart-1))',
    'hsl(var(--chart-2))',
    'hsl(var(--chart-3))',
    'hsl(var(--chart-4, 280 65% 60%))',
    'hsl(var(--chart-5, 160 60% 45%))',
];

const tooltipStyle = {
    backgroundColor: 'hsl(var(--popover))',
    border: '1px solid hsl(var(--border))',
    borderRadius: '6px',
    color: 'hsl(var(--popover-foreground))',
    fontSize: '12px',
};

interface MetricGroup {
    name: string;
    type: 'Sum' | 'Gauge' | 'Histogram';
    description?: string;
    unit?: string;
    dataPoints: MetricDataPoint[];
}

function formatUnit(unit?: string): string {
    if (!unit) return '';
    if (unit === 'ms' || unit === 'milliseconds') return 'ms';
    if (unit === 's' || unit === 'seconds') return 's';
    if (unit === 'By' || unit === 'bytes') return 'B';
    if (unit === '%' || unit === 'percent') return '%';
    if (unit === '1') return '';
    return unit;
}

function typeIcon(type: 'Sum' | 'Gauge' | 'Histogram') {
    switch (type) {
        case 'Sum': return <BarChart3 className="w-3.5 h-3.5" />;
        case 'Gauge': return <Gauge className="w-3.5 h-3.5" />;
        case 'Histogram': return <LineChart className="w-3.5 h-3.5" />;
    }
}

function typeLabel(type: 'Sum' | 'Gauge' | 'Histogram') {
    switch (type) {
        case 'Sum': return 'Counter';
        case 'Gauge': return 'Gauge';
        case 'Histogram': return 'Histogram';
    }
}

/** Renders a Sum metric as a BarChart (total per time bucket) */
function SumChart({ group }: { group: MetricGroup }) {
    const data = useMemo(() => {
        const buckets = bucketByTime(group.dataPoints);
        return Array.from(buckets.entries())
            .sort(([a], [b]) => a - b)
            .map(([ts, items]) => ({
                time: formatTime(ts),
                ts,
                total: items.reduce((sum, i) => sum + i.value, 0),
            }));
    }, [group.dataPoints]);

    if (data.length === 0) return null;

    const unit = formatUnit(group.unit);

    return (
        <ResponsiveContainer width="100%" height={200}>
            <BarChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
                <XAxis dataKey="time" className="text-xs fill-muted-foreground" tick={{ fontSize: 11 }} />
                <YAxis className="text-xs fill-muted-foreground" tick={{ fontSize: 11 }} unit={unit} />
                <RechartsTooltip contentStyle={tooltipStyle} />
                <Bar dataKey="total" name="Total" fill={PALETTE[0]} radius={[3, 3, 0, 0]} />
            </BarChart>
        </ResponsiveContainer>
    );
}

/** Renders a Gauge metric as an AreaChart (current value over time) */
function GaugeChart({ group }: { group: MetricGroup }) {
    const data = useMemo(() => {
        const buckets = bucketByTime(group.dataPoints);
        return Array.from(buckets.entries())
            .sort(([a], [b]) => a - b)
            .map(([ts, items]) => {
                const avg = items.reduce((s, i) => s + i.value, 0) / items.length;
                const min = Math.min(...items.map(i => i.value));
                const max = Math.max(...items.map(i => i.value));
                return {
                    time: formatTime(ts),
                    ts,
                    avg: Math.round(avg * 100) / 100,
                    min: Math.round(min * 100) / 100,
                    max: Math.round(max * 100) / 100,
                };
            });
    }, [group.dataPoints]);

    if (data.length === 0) return null;

    const unit = formatUnit(group.unit);

    return (
        <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <defs>
                    <linearGradient id={`grad-gauge-${group.name}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={PALETTE[0]} stopOpacity={0.3} />
                        <stop offset="95%" stopColor={PALETTE[0]} stopOpacity={0} />
                    </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
                <XAxis dataKey="time" className="text-xs fill-muted-foreground" tick={{ fontSize: 11 }} />
                <YAxis className="text-xs fill-muted-foreground" tick={{ fontSize: 11 }} unit={unit} />
                <RechartsTooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
                <Area type="monotone" dataKey="avg" name="Avg" stroke={PALETTE[0]} fill={`url(#grad-gauge-${group.name})`} strokeWidth={2} dot={false} />
                <Area type="monotone" dataKey="max" name="Max" stroke={PALETTE[1]} fill="none" strokeWidth={1.5} strokeDasharray="4 2" dot={false} />
                <Area type="monotone" dataKey="min" name="Min" stroke={PALETTE[2]} fill="none" strokeWidth={1.5} strokeDasharray="4 2" dot={false} />
            </AreaChart>
        </ResponsiveContainer>
    );
}

/** Renders a Histogram metric as a LineChart with P50/P95/P99 */
function HistogramChart({ group }: { group: MetricGroup }) {
    const data = useMemo(() => {
        const buckets = bucketByTime(group.dataPoints);
        return Array.from(buckets.entries())
            .sort(([a], [b]) => a - b)
            .map(([ts, items]) => {
                // For histograms, use the sum/count to compute mean, and raw values for percentiles
                const vals = items.map(i => {
                    if (i.count && i.count > 0) return i.value / i.count;
                    return i.value;
                });
                const p = percentiles(vals);
                return {
                    time: formatTime(ts),
                    ts,
                    p50: Math.round(p.p50 * 100) / 100,
                    p95: Math.round(p.p95 * 100) / 100,
                    p99: Math.round(p.p99 * 100) / 100,
                    avg: p.avg,
                };
            });
    }, [group.dataPoints]);

    if (data.length === 0) return null;

    const unit = formatUnit(group.unit);

    return (
        <ResponsiveContainer width="100%" height={200}>
            <RechartsLineChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
                <XAxis dataKey="time" className="text-xs fill-muted-foreground" tick={{ fontSize: 11 }} />
                <YAxis className="text-xs fill-muted-foreground" tick={{ fontSize: 11 }} unit={unit} />
                <RechartsTooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
                <Line type="monotone" dataKey="p50" name="P50" stroke={PALETTE[0]} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="p95" name="P95" stroke={PALETTE[1]} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="p99" name="P99" stroke={PALETTE[2]} strokeWidth={1.5} strokeDasharray="4 2" dot={false} />
            </RechartsLineChart>
        </ResponsiveContainer>
    );
}

export function MetricsViewer({ metrics, channelName }: MetricsViewerProps) {
    const { t } = useTranslation('filters');
    const [timeRange, setTimeRange] = useState<TimeRange>('1h');

    const filtered = useMemo(() => filterByTimeRange(metrics, timeRange), [metrics, timeRange]);

    const { groups, totalDataPoints, totalMetrics } = useMemo(() => {
        const groupMap = new Map<string, MetricGroup>();

        for (const m of filtered) {
            const key = m.name;
            const existing = groupMap.get(key);
            if (existing) {
                existing.dataPoints.push(m);
            } else {
                groupMap.set(key, {
                    name: m.name,
                    type: m.type,
                    description: m.description,
                    unit: m.unit,
                    dataPoints: [m],
                });
            }
        }

        // Sort: Histograms first, then Gauges, then Sums — alphabetical within each type
        const typeOrder: Record<string, number> = { Histogram: 0, Gauge: 1, Sum: 2 };
        const groups = Array.from(groupMap.values()).sort((a, b) => {
            const orderDiff = (typeOrder[a.type] ?? 3) - (typeOrder[b.type] ?? 3);
            if (orderDiff !== 0) return orderDiff;
            return a.name.localeCompare(b.name);
        });

        return {
            groups,
            totalDataPoints: filtered.length,
            totalMetrics: groupMap.size,
        };
    }, [filtered]);

    if (!channelName) {
        return (
            <div className="flex-1 flex items-center justify-center bg-background">
                <p className="text-muted-foreground text-sm">Select a channel to view metrics</p>
            </div>
        );
    }

    if (metrics.length === 0) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-background">
                <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-6 shadow-sm ring-1 ring-border/50">
                    <Activity className="w-8 h-8 text-muted-foreground/70" />
                </div>
                <h2 className="text-xl font-semibold mb-2 text-foreground tracking-tight">Waiting for Metrics</h2>
                <p className="text-muted-foreground max-w-sm text-balance">
                    Send OTLP metrics to the /v1/metrics endpoint to see data here.
                </p>
            </div>
        );
    }

    return (
        <div className="flex flex-1 overflow-hidden">
            {/* Left sidebar — time range */}
            <Sidebar>
                <SidebarHeader>
                    <span className="font-semibold text-sm">Timeline</span>
                </SidebarHeader>
                <SidebarContent>
                    <SidebarSection>
                        <SidebarSectionTitle>{t('sidebar.timeline')}</SidebarSectionTitle>
                        <div className="px-2">
                            <Select value={timeRange} onValueChange={(v) => setTimeRange(v as TimeRange)}>
                                <SelectTrigger className="w-full h-9">
                                    <div className="flex items-center gap-2">
                                        <Calendar className="w-4 h-4 text-muted-foreground" />
                                        <SelectValue />
                                    </div>
                                </SelectTrigger>
                                <SelectContent>
                                    {METRICS_TIME_RANGES.map((range) => (
                                        <SelectItem key={range} value={range}>
                                            {t(`timeRange.${range}`)}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </SidebarSection>

                    {/* Summary stats */}
                    <SidebarSection className="mt-4">
                        <SidebarSectionTitle>Summary</SidebarSectionTitle>
                        <div className="px-2 space-y-2">
                            <SidebarStat icon={<Hash className="w-3.5 h-3.5" />} label="Data points" value={totalDataPoints.toLocaleString()} />
                            <SidebarStat icon={<Activity className="w-3.5 h-3.5" />} label="Metrics" value={totalMetrics.toString()} />
                            <SidebarStat icon={<BarChart3 className="w-3.5 h-3.5" />} label="Counters" value={groups.filter(g => g.type === 'Sum').length.toString()} />
                            <SidebarStat icon={<Gauge className="w-3.5 h-3.5" />} label="Gauges" value={groups.filter(g => g.type === 'Gauge').length.toString()} />
                        </div>
                    </SidebarSection>
                </SidebarContent>
            </Sidebar>

            {/* Main charts area */}
            <div className="flex-1 overflow-y-auto p-4 bg-background">
                {filtered.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                        <Clock className="w-8 h-8 text-muted-foreground/50 mb-3" />
                        <p className="text-sm text-muted-foreground">No metrics in the selected time range</p>
                        <button
                            onClick={() => setTimeRange('all')}
                            className="mt-2 text-xs text-primary hover:underline"
                        >
                            Show all data
                        </button>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                        {groups.map((group) => (
                            <MetricChartCard key={group.name} group={group} />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

function MetricChartCard({ group }: { group: MetricGroup }) {
    const unit = formatUnit(group.unit);
    const subtitle = [
        typeLabel(group.type),
        unit ? `(${unit})` : null,
        group.description || null,
    ].filter(Boolean).join(' · ');

    return (
        <ChartCard
            title={group.name}
            subtitle={subtitle}
            badge={group.type}
        >
            {group.type === 'Sum' && <SumChart group={group} />}
            {group.type === 'Gauge' && <GaugeChart group={group} />}
            {group.type === 'Histogram' && <HistogramChart group={group} />}
        </ChartCard>
    );
}

function SidebarStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
    return (
        <div className="flex items-center justify-between py-1.5 px-2 rounded-md">
            <div className="flex items-center gap-1.5 text-muted-foreground">
                {icon}
                <span className="text-xs">{label}</span>
            </div>
            <span className="text-sm font-semibold tabular-nums">{value}</span>
        </div>
    );
}

function ChartCard({ title, subtitle, badge, children }: { title: string; subtitle: string; badge?: string; children: React.ReactNode }) {
    return (
        <div className="rounded-lg border border-border/50 bg-card">
            <div className="px-4 py-3 border-b border-border/30 flex items-center justify-between">
                <div>
                    <h3 className="text-sm font-medium font-mono">{title}</h3>
                    <p className="text-xs text-muted-foreground">{subtitle}</p>
                </div>
                {badge && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground bg-muted px-2 py-1 rounded-md">
                        {typeIcon(badge as 'Sum' | 'Gauge' | 'Histogram')}
                        <span>{typeLabel(badge as 'Sum' | 'Gauge' | 'Histogram')}</span>
                    </div>
                )}
            </div>
            <div className="p-3">
                {children}
            </div>
        </div>
    );
}
