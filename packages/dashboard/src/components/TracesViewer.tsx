import { useMemo, useState, useCallback, useRef, useEffect, memo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { TraceSpan } from '@/types';
import {
    GitCommitVertical,
    ChevronRight,
    ChevronDown,
    Hash,
    AlertCircle,
    CheckCircle2,
    X,
    Clock,
    Tag,
    Layers,
    Info,
    Copy,
    Check,
    ZoomIn,
    ZoomOut,
    Maximize2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';

// ─── Types ──────────────────────────────────────────────────────────────────

interface TracesViewerProps {
    traces: TraceSpan[];
    channelName: string | null;
}

interface TraceGroup {
    traceId: string;
    rootName: string;
    serviceName: string;
    spans: TraceSpan[];
    startTime: number;
    endTime: number;
    durationMs: number;
    hasError: boolean;
    spanCount: number;
}

interface SpanTreeNode {
    span: TraceSpan;
    depth: number;
    children: SpanTreeNode[];
}

interface FlatSpan {
    span: TraceSpan;
    depth: number;
    hasChildren: boolean;
    isCollapsed: boolean;
    isCriticalPath: boolean;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
    if (!Number.isFinite(ms) || ms < 0) return '<0.01ms';
    if (ms < 0.01) return '<0.01ms';
    if (ms < 1) return `${ms.toFixed(2)}ms`;
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
}

function formatTime(ms: number): string {
    const d = new Date(ms);
    return d.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        fractionalSecondDigits: 3,
    } as Intl.DateTimeFormatOptions);
}

function formatTimestamp(ms: number): string {
    const d = new Date(ms);
    return d.toLocaleString([], {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        fractionalSecondDigits: 3,
    } as Intl.DateTimeFormatOptions);
}

function arrayMin(arr: number[]): number {
    let min = arr[0];
    for (let i = 1; i < arr.length; i++) {
        if (arr[i] < min) min = arr[i];
    }
    return min;
}

function arrayMax(arr: number[]): number {
    let max = arr[0];
    for (let i = 1; i < arr.length; i++) {
        if (arr[i] > max) max = arr[i];
    }
    return max;
}

function getServiceName(span: TraceSpan): string {
    const attrs = span.attributes || {};
    return String(
        attrs['service.name'] ||
        attrs['http.target'] ||
        attrs['url.path'] ||
        ''
    );
}

const STATUS_COLORS = {
    ok: 'bg-emerald-500',
    error: 'bg-red-500',
    unset: 'bg-zinc-400',
} as const;

const STATUS_LABELS: Record<number, string> = {
    0: 'Unset',
    1: 'OK',
    2: 'Error',
};

const BAR_COLORS = [
    'bg-blue-500',
    'bg-emerald-500',
    'bg-amber-500',
    'bg-purple-500',
    'bg-rose-500',
    'bg-cyan-500',
    'bg-orange-500',
    'bg-indigo-500',
];

const BAR_COLORS_HEX = [
    '#3b82f6',
    '#10b981',
    '#f59e0b',
    '#a855f7',
    '#f43f5e',
    '#06b6d4',
    '#f97316',
    '#6366f1',
];

// ─── Tree building ──────────────────────────────────────────────────────────

function buildSpanTree(spans: TraceSpan[]): SpanTreeNode[] {
    const nodeMap = new Map<string, SpanTreeNode>();
    const roots: SpanTreeNode[] = [];

    for (const span of spans) {
        nodeMap.set(span.spanId, { span, depth: 0, children: [] });
    }

    for (const span of spans) {
        const node = nodeMap.get(span.spanId)!;
        if (span.parentSpanId && nodeMap.has(span.parentSpanId)) {
            nodeMap.get(span.parentSpanId)!.children.push(node);
        } else {
            roots.push(node);
        }
    }

    function setDepths(nodes: SpanTreeNode[], depth: number) {
        nodes.sort((a, b) => a.span.startTimeMs - b.span.startTimeMs);
        for (const node of nodes) {
            node.depth = depth;
            setDepths(node.children, depth + 1);
        }
    }
    setDepths(roots, 0);
    return roots;
}

/** Compute critical path: the span that ends latest at each level (the "bottleneck") */
function computeCriticalPath(roots: SpanTreeNode[]): Set<string> {
    const criticalIds = new Set<string>();

    function markCritical(nodes: SpanTreeNode[]) {
        if (nodes.length === 0) return;
        let latest = nodes[0];
        for (const n of nodes) {
            if (n.span.endTimeMs > latest.span.endTimeMs) latest = n;
        }
        criticalIds.add(latest.span.spanId);
        markCritical(latest.children);
    }

    for (const root of roots) {
        criticalIds.add(root.span.spanId);
        markCritical(root.children);
    }

    return criticalIds;
}

function flattenTree(
    nodes: SpanTreeNode[],
    collapsedIds: Set<string>,
    criticalIds: Set<string>
): FlatSpan[] {
    const result: FlatSpan[] = [];

    function walk(nodeList: SpanTreeNode[]) {
        for (const node of nodeList) {
            const hasChildren = node.children.length > 0;
            const isCollapsed = collapsedIds.has(node.span.spanId);
            result.push({
                span: node.span,
                depth: node.depth,
                hasChildren,
                isCollapsed,
                isCriticalPath: criticalIds.has(node.span.spanId),
            });
            if (hasChildren && !isCollapsed) {
                walk(node.children);
            }
        }
    }
    walk(nodes);
    return result;
}

// ─── MiniWaterfallCanvas ────────────────────────────────────────────────────
// Renders the mini waterfall bar in each trace row header using a <canvas>
// instead of one <div> per span. This dramatically reduces DOM elements.

const MiniWaterfallCanvas = memo(function MiniWaterfallCanvas({
    spans,
    startTime,
    durationMs,
}: {
    spans: TraceSpan[];
    startTime: number;
    durationMs: number;
}) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        const w = rect.width;
        const h = rect.height;

        canvas.width = w * dpr;
        canvas.height = h * dpr;
        ctx.scale(dpr, dpr);

        // Background
        ctx.fillStyle = 'rgba(128,128,128,0.08)';
        ctx.roundRect(0, 0, w, h, 2);
        ctx.fill();

        const totalDur = durationMs || 1;
        for (const span of spans) {
            const left = ((span.startTimeMs - startTime) / totalDur) * w;
            const barW = Math.max(((span.endTimeMs - span.startTimeMs) / totalDur) * w, 1.5);
            const isErr = span.status?.code === 2;
            ctx.fillStyle = isErr ? '#ef4444' : '#3b82f6';
            ctx.globalAlpha = 0.8;
            ctx.beginPath();
            ctx.roundRect(left, 2, barW, h - 4, 1);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }, [spans, startTime, durationMs]);

    return (
        <canvas
            ref={canvasRef}
            className="flex-1 h-4 min-w-[100px]"
            style={{ display: 'block' }}
        />
    );
});

// ─── MinimapCanvas ──────────────────────────────────────────────────────────
// Renders the minimap when zoomed, using a <canvas> instead of per-span divs.

const MinimapCanvas = memo(function MinimapCanvas({
    spans,
    startTime,
    totalMs,
    zoom,
}: {
    spans: TraceSpan[];
    startTime: number;
    totalMs: number;
    zoom: ZoomState;
}) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        const w = rect.width;
        const h = rect.height;

        canvas.width = w * dpr;
        canvas.height = h * dpr;
        ctx.scale(dpr, dpr);

        ctx.clearRect(0, 0, w, h);

        // Draw spans
        for (const span of spans) {
            const left = ((span.startTimeMs - startTime) / totalMs) * w;
            const barW = Math.max(((span.endTimeMs - span.startTimeMs) / totalMs) * w, 0.5);
            const isErr = span.status?.code === 2;
            ctx.fillStyle = isErr ? 'rgba(248,113,113,0.6)' : 'rgba(96,165,250,0.6)';
            ctx.fillRect(left, 2, barW, h - 4);
        }

        // Draw viewport indicator
        const vpLeft = zoom.start * w;
        const vpWidth = (zoom.end - zoom.start) * w;
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.lineWidth = 1;
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.beginPath();
        ctx.roundRect(vpLeft, 0, vpWidth, h, 2);
        ctx.fill();
        ctx.stroke();
    }, [spans, startTime, totalMs, zoom]);

    return (
        <canvas
            ref={canvasRef}
            className="h-3 mx-4 my-1 w-[calc(100%-2rem)] shrink-0"
            style={{ display: 'block' }}
        />
    );
});

// ─── CopyButton ─────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
    const [copied, setCopied] = useState(false);
    const handleCopy = useCallback(() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    }, [text]);

    return (
        <button
            onClick={handleCopy}
            className="p-0.5 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
            title="Copy"
        >
            {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
        </button>
    );
}

// ─── SpanDetailPanel ────────────────────────────────────────────────────────

const SpanDetailPanel = memo(function SpanDetailPanel({
    span,
    onClose,
    nameColorIndex,
}: {
    span: TraceSpan;
    onClose: () => void;
    nameColorIndex: Map<string, number>;
}) {
    const durationMs = span.endTimeMs - span.startTimeMs;
    const statusCode = span.status?.code ?? 0;
    const isError = statusCode === 2;
    const colorIdx = nameColorIndex.get(span.name) ?? 0;
    const barColorHex = isError ? '#ef4444' : BAR_COLORS_HEX[colorIdx % BAR_COLORS_HEX.length];
    const attributes = span.attributes || {};
    const attrEntries = Object.entries(attributes);

    return (
        <div className="w-[380px] border-l border-border bg-background flex flex-col h-full shrink-0 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card/50">
                <div className="flex items-center gap-2 min-w-0">
                    <div
                        className="w-3 h-3 rounded-sm shrink-0"
                        style={{ backgroundColor: barColorHex }}
                    />
                    <span className="text-sm font-semibold truncate">{span.name}</span>
                </div>
                <button
                    onClick={onClose}
                    className="p-1 rounded-md hover:bg-muted transition-colors shrink-0"
                >
                    <X className="w-4 h-4 text-muted-foreground" />
                </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto">
                {/* Overview */}
                <div className="px-4 py-3 space-y-3 border-b border-border/50">
                    <div className="flex items-center gap-2">
                        <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">Duration</span>
                        <span className="text-sm font-mono font-medium ml-auto">{formatDuration(durationMs)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <Info className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">Status</span>
                        <span className={cn(
                            'text-xs font-medium ml-auto px-1.5 py-0.5 rounded',
                            isError ? 'bg-red-500/10 text-red-500' : statusCode === 1 ? 'bg-emerald-500/10 text-emerald-500' : 'bg-zinc-500/10 text-muted-foreground'
                        )}>
                            {STATUS_LABELS[statusCode] || `Code ${statusCode}`}
                        </span>
                    </div>
                    {span.status?.message && (
                        <div className="mt-1 p-2 rounded bg-red-500/5 border border-red-500/20">
                            <p className="text-xs text-red-400 font-mono break-all">{span.status.message}</p>
                        </div>
                    )}
                    <div className="flex items-center gap-2">
                        <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">Start</span>
                        <span className="text-xs font-mono ml-auto">{formatTimestamp(span.startTimeMs)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">End</span>
                        <span className="text-xs font-mono ml-auto">{formatTimestamp(span.endTimeMs)}</span>
                    </div>
                </div>

                {/* IDs */}
                <div className="px-4 py-3 space-y-2 border-b border-border/50">
                    <div className="flex items-center gap-1.5 mb-1">
                        <Layers className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">IDs</span>
                    </div>
                    <div className="space-y-1.5">
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground w-16 shrink-0">Trace</span>
                            <span className="text-xs font-mono text-foreground truncate flex-1">{span.traceId}</span>
                            <CopyButton text={span.traceId} />
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground w-16 shrink-0">Span</span>
                            <span className="text-xs font-mono text-foreground truncate flex-1">{span.spanId}</span>
                            <CopyButton text={span.spanId} />
                        </div>
                        {span.parentSpanId && (
                            <div className="flex items-center gap-2">
                                <span className="text-xs text-muted-foreground w-16 shrink-0">Parent</span>
                                <span className="text-xs font-mono text-foreground truncate flex-1">{span.parentSpanId}</span>
                                <CopyButton text={span.parentSpanId} />
                            </div>
                        )}
                    </div>
                </div>

                {/* Attributes */}
                {attrEntries.length > 0 && (
                    <div className="px-4 py-3">
                        <div className="flex items-center gap-1.5 mb-2">
                            <Tag className="w-3.5 h-3.5 text-muted-foreground" />
                            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                Attributes ({attrEntries.length})
                            </span>
                        </div>
                        <div className="space-y-1">
                            {attrEntries.map(([key, value]) => (
                                <div
                                    key={key}
                                    className="flex items-start gap-2 py-1 px-2 rounded hover:bg-muted/30 group/attr"
                                >
                                    <span className="text-xs text-muted-foreground font-mono shrink-0 pt-0.5 break-all">{key}</span>
                                    <span className="text-xs font-mono text-foreground ml-auto text-right break-all">{String(value)}</span>
                                    <div className="opacity-0 group-hover/attr:opacity-100 transition-opacity shrink-0 pt-0.5">
                                        <CopyButton text={`${key}=${String(value)}`} />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
});

// ─── SpanTooltip ────────────────────────────────────────────────────────────

function SpanTooltip({
    span,
    durationMs,
    barColorHex,
}: {
    span: TraceSpan;
    durationMs: number;
    barColorHex: string;
}) {
    const statusCode = span.status?.code ?? 0;
    const isError = statusCode === 2;
    const attributes = span.attributes || {};
    const topAttrs = Object.entries(attributes).slice(0, 4);

    return (
        <div className="bg-popover border border-border rounded-md shadow-lg text-xs min-w-[200px]">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50">
                <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: barColorHex }} />
                <span className="font-semibold truncate">{span.name}</span>
            </div>
            <div className="px-3 py-2 space-y-1.5">
                <div className="flex justify-between">
                    <span className="text-muted-foreground">Duration</span>
                    <span className="font-mono font-medium">{formatDuration(durationMs)}</span>
                </div>
                <div className="flex justify-between">
                    <span className="text-muted-foreground">Status</span>
                    <span className={cn('font-medium', isError ? 'text-red-500' : statusCode === 1 ? 'text-emerald-500' : 'text-muted-foreground')}>
                        {STATUS_LABELS[statusCode] || `Code ${statusCode}`}
                    </span>
                </div>
                {span.status?.message && (
                    <div className="text-red-400 font-mono break-all">{span.status.message}</div>
                )}
                <div className="flex justify-between">
                    <span className="text-muted-foreground">Span ID</span>
                    <span className="font-mono">{span.spanId.slice(0, 8)}</span>
                </div>
                <div className="flex justify-between">
                    <span className="text-muted-foreground">Start</span>
                    <span className="font-mono">{formatTime(span.startTimeMs)}</span>
                </div>
                {topAttrs.length > 0 && (
                    <>
                        <div className="border-t border-border/30 mt-1 pt-1" />
                        {topAttrs.map(([k, v]) => (
                            <div key={k} className="flex justify-between gap-3">
                                <span className="text-muted-foreground truncate">{k}</span>
                                <span className="font-mono truncate text-right max-w-[140px]">{String(v)}</span>
                            </div>
                        ))}
                        {Object.keys(attributes).length > 4 && (
                            <div className="text-muted-foreground/60 text-center">
                                +{Object.keys(attributes).length - 4} more
                            </div>
                        )}
                    </>
                )}
            </div>
            <div className="px-3 py-1.5 border-t border-border/30 text-muted-foreground/60 text-center">
                Click for details
            </div>
        </div>
    );
}

// ─── Zoom state ─────────────────────────────────────────────────────────────

interface ZoomState {
    /** 0..1 start of visible range */
    start: number;
    /** 0..1 end of visible range */
    end: number;
}

const ZOOM_INITIAL: ZoomState = { start: 0, end: 1 };
const MIN_RANGE = 0.01; // minimum 1% zoom

// ─── WaterfallView ──────────────────────────────────────────────────────────

const WaterfallView = memo(function WaterfallView({
    group,
    selectedSpanId,
    onSelectSpan,
}: {
    group: TraceGroup;
    selectedSpanId: string | null;
    onSelectSpan: (span: TraceSpan | null) => void;
}) {
    const { spans, startTime, endTime } = group;
    const totalMs = endTime - startTime || 1;

    const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
    const [zoom, setZoom] = useState<ZoomState>(ZOOM_INITIAL);

    // For drag-to-pan
    const dragRef = useRef<{ dragging: boolean; startX: number; startZoom: ZoomState }>({
        dragging: false, startX: 0, startZoom: ZOOM_INITIAL,
    });
    const timelineRef = useRef<HTMLDivElement>(null);

    const toggleCollapse = useCallback((spanId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setCollapsedIds(prev => {
            const next = new Set(prev);
            if (next.has(spanId)) next.delete(spanId);
            else next.add(spanId);
            return next;
        });
    }, []);

    // Build tree, critical path, flatten
    const tree = useMemo(() => buildSpanTree(spans), [spans]);
    const criticalIds = useMemo(() => computeCriticalPath(tree), [tree]);
    const flatSpans = useMemo(() => flattenTree(tree, collapsedIds, criticalIds), [tree, collapsedIds, criticalIds]);

    const nameColorIndex = useMemo(() => {
        const names = [...new Set(spans.map(s => s.name))];
        const map = new Map<string, number>();
        names.forEach((name, i) => map.set(name, i));
        return map;
    }, [spans]);

    // Virtualization
    const parentRef = useRef<HTMLDivElement>(null);
    const rowVirtualizer = useVirtualizer({
        count: flatSpans.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => 32,
        overscan: 10,
    });

    // Zoom visible range in ms
    const visibleDurationMs = totalMs * (zoom.end - zoom.start);
    const isZoomed = zoom.start > 0.001 || zoom.end < 0.999;

    // Zoom controls
    const handleZoomIn = useCallback(() => {
        setZoom(prev => {
            const range = prev.end - prev.start;
            const newRange = Math.max(range * 0.5, MIN_RANGE);
            const center = (prev.start + prev.end) / 2;
            return {
                start: Math.max(0, center - newRange / 2),
                end: Math.min(1, center + newRange / 2),
            };
        });
    }, []);

    const handleZoomOut = useCallback(() => {
        setZoom(prev => {
            const range = prev.end - prev.start;
            const newRange = Math.min(range * 2, 1);
            const center = (prev.start + prev.end) / 2;
            return {
                start: Math.max(0, center - newRange / 2),
                end: Math.min(1, center + newRange / 2),
            };
        });
    }, []);

    const handleZoomReset = useCallback(() => setZoom(ZOOM_INITIAL), []);

    // Mouse wheel zoom on timeline area
    const handleWheel = useCallback((e: React.WheelEvent) => {
        if (!timelineRef.current) return;
        e.preventDefault();
        const rect = timelineRef.current.getBoundingClientRect();
        const mouseX = (e.clientX - rect.left) / rect.width; // 0..1 position

        setZoom(prev => {
            const range = prev.end - prev.start;
            const factor = e.deltaY > 0 ? 1.2 : 0.8; // scroll down = zoom out
            const newRange = Math.max(Math.min(range * factor, 1), MIN_RANGE);

            // Keep the point under the mouse fixed
            const mouseTime = prev.start + mouseX * range;
            let newStart = mouseTime - mouseX * newRange;
            let newEnd = newStart + newRange;

            // Clamp
            if (newStart < 0) { newEnd -= newStart; newStart = 0; }
            if (newEnd > 1) { newStart -= (newEnd - 1); newEnd = 1; }
            newStart = Math.max(0, newStart);

            return { start: newStart, end: newEnd };
        });
    }, []);

    // Drag to pan
    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        if (e.button !== 0) return;
        dragRef.current = { dragging: true, startX: e.clientX, startZoom: zoom };
    }, [zoom]);

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!dragRef.current.dragging || !timelineRef.current) return;
            const rect = timelineRef.current.getBoundingClientRect();
            const dx = (e.clientX - dragRef.current.startX) / rect.width;
            const range = dragRef.current.startZoom.end - dragRef.current.startZoom.start;
            const shift = -dx * range;

            let newStart = dragRef.current.startZoom.start + shift;
            let newEnd = dragRef.current.startZoom.end + shift;

            if (newStart < 0) { newEnd -= newStart; newStart = 0; }
            if (newEnd > 1) { newStart -= (newEnd - 1); newEnd = 1; }
            newStart = Math.max(0, newStart);
            newEnd = Math.min(1, newEnd);

            setZoom({ start: newStart, end: newEnd });
        };

        const handleMouseUp = () => { dragRef.current.dragging = false; };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, []);

    // Timeline tick marks (5 ticks)
    const ticks = [0, 0.25, 0.5, 0.75, 1];

    return (
        <div className="bg-muted/10 border-t border-border/20 flex flex-col">
            {/* Timeline header with zoom controls */}
            <div className="flex items-center px-4 py-1.5 text-[10px] text-muted-foreground border-b border-border/20 shrink-0">
                <div className="w-[260px] shrink-0 flex items-center gap-1">
                    <span>Service / Operation</span>
                    <span className="text-muted-foreground/50">({flatSpans.length}/{spans.length})</span>
                </div>
                <div className="flex-1 flex justify-between">
                    {ticks.map((t) => (
                        <span key={t}>{formatDuration(visibleDurationMs * t)}</span>
                    ))}
                </div>
                {/* Zoom controls */}
                <div className="flex items-center gap-0.5 ml-2 shrink-0">
                    <button
                        onClick={handleZoomIn}
                        className="p-1 rounded hover:bg-muted/50 transition-colors"
                        title="Zoom in"
                    >
                        <ZoomIn className="w-3 h-3" />
                    </button>
                    <button
                        onClick={handleZoomOut}
                        className="p-1 rounded hover:bg-muted/50 transition-colors"
                        title="Zoom out"
                        disabled={!isZoomed}
                    >
                        <ZoomOut className={cn("w-3 h-3", !isZoomed && "opacity-30")} />
                    </button>
                    {isZoomed && (
                        <button
                            onClick={handleZoomReset}
                            className="p-1 rounded hover:bg-muted/50 transition-colors"
                            title="Reset zoom"
                        >
                            <Maximize2 className="w-3 h-3" />
                        </button>
                    )}
                </div>
            </div>

            {/* Minimap when zoomed — canvas-based */}
            {isZoomed && (
                <MinimapCanvas
                    spans={spans}
                    startTime={startTime}
                    totalMs={totalMs}
                    zoom={zoom}
                />
            )}

            {/* Virtualized spans */}
            <TooltipProvider delayDuration={200}>
                <div
                    ref={parentRef}
                    className="overflow-y-auto"
                    style={{ maxHeight: Math.min(flatSpans.length * 32 + 4, 500) }}
                >
                    <div
                        ref={timelineRef}
                        style={{
                            height: `${rowVirtualizer.getTotalSize()}px`,
                            width: '100%',
                            position: 'relative',
                            cursor: isZoomed ? 'grab' : undefined,
                        }}
                        onWheel={handleWheel}
                        onMouseDown={handleMouseDown}
                    >
                        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                            const { span, depth, hasChildren, isCollapsed, isCriticalPath } = flatSpans[virtualRow.index];

                            // Map span position into the zoomed viewport
                            const spanStartNorm = (span.startTimeMs - startTime) / totalMs;
                            const spanEndNorm = (span.endTimeMs - startTime) / totalMs;
                            const viewRange = zoom.end - zoom.start;
                            const offsetPct = ((spanStartNorm - zoom.start) / viewRange) * 100;
                            const spanDurationMs = span.endTimeMs - span.startTimeMs;
                            const widthPct = Math.max(((spanEndNorm - spanStartNorm) / viewRange) * 100, 0.5);

                            const isError = span.status?.code === 2;
                            const colorIdx = nameColorIndex.get(span.name) ?? 0;
                            const barColor = isError ? 'bg-red-500' : BAR_COLORS[colorIdx % BAR_COLORS.length];
                            const barColorHex = isError ? '#ef4444' : BAR_COLORS_HEX[colorIdx % BAR_COLORS_HEX.length];
                            const isSelected = selectedSpanId === span.spanId;

                            return (
                                <div
                                    key={span.spanId}
                                    className={cn(
                                        'absolute top-0 left-0 w-full flex items-center px-4 transition-colors cursor-pointer',
                                        isSelected ? 'bg-accent/40' : 'hover:bg-muted/20'
                                    )}
                                    style={{
                                        height: `${virtualRow.size}px`,
                                        transform: `translateY(${virtualRow.start}px)`,
                                    }}
                                    onClick={() => onSelectSpan(isSelected ? null : span)}
                                >
                                    {/* Span name with tree indentation */}
                                    <div className="w-[260px] shrink-0 flex items-center gap-1 pr-3">
                                        <div style={{ width: depth * 16 }} className="shrink-0" />

                                        {hasChildren ? (
                                            <button
                                                onClick={(e) => toggleCollapse(span.spanId, e)}
                                                className="p-0.5 rounded hover:bg-muted/50 shrink-0"
                                            >
                                                {isCollapsed
                                                    ? <ChevronRight className="w-3 h-3 text-muted-foreground" />
                                                    : <ChevronDown className="w-3 h-3 text-muted-foreground" />
                                                }
                                            </button>
                                        ) : (
                                            <div className="w-4 shrink-0" />
                                        )}

                                        {isError
                                            ? <AlertCircle className="w-3 h-3 text-red-500 shrink-0" />
                                            : <CheckCircle2 className="w-3 h-3 text-emerald-500/70 shrink-0" />
                                        }

                                        <div
                                            className="w-2 h-2 rounded-full shrink-0"
                                            style={{ backgroundColor: barColorHex }}
                                        />

                                        <span className="text-xs truncate font-mono" title={span.name}>
                                            {span.name}
                                        </span>
                                    </div>

                                    {/* Waterfall bar */}
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <div className="flex-1 relative h-6 overflow-hidden">
                                                {/* Grid lines */}
                                                {[0, 25, 50, 75].map(p => (
                                                    <div
                                                        key={p}
                                                        className="absolute top-0 bottom-0 border-l border-border/10"
                                                        style={{ left: `${p}%` }}
                                                    />
                                                ))}

                                                {/* Bar */}
                                                <div
                                                    className={cn(
                                                        'absolute top-1 h-4 rounded-sm transition-opacity',
                                                        barColor,
                                                        isCriticalPath ? 'opacity-100 ring-1 ring-foreground/20' : 'opacity-70 hover:opacity-100'
                                                    )}
                                                    style={{
                                                        left: `${offsetPct}%`,
                                                        width: `${Math.max(widthPct, 0.5)}%`,
                                                        minWidth: '2px',
                                                    }}
                                                />

                                                {/* Duration label */}
                                                {offsetPct >= -10 && offsetPct <= 110 && (
                                                    <span
                                                        className="absolute top-1 text-[10px] font-mono text-muted-foreground tabular-nums pointer-events-none"
                                                        style={{
                                                            left: `${Math.min(Math.max(offsetPct + widthPct + 0.5, 0), 88)}%`,
                                                        }}
                                                    >
                                                        {formatDuration(spanDurationMs)}
                                                    </span>
                                                )}
                                            </div>
                                        </TooltipTrigger>
                                        <TooltipContent side="bottom" className="max-w-xs p-0" sideOffset={4}>
                                            <SpanTooltip span={span} durationMs={spanDurationMs} barColorHex={barColorHex} />
                                        </TooltipContent>
                                    </Tooltip>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </TooltipProvider>
        </div>
    );
});

// ─── TraceRow (memoized individual trace header) ─────────────────────────────

const TraceRow = memo(function TraceRow({
    group,
    isExpanded,
    onToggle,
    selectedSpanId,
    onSelectSpan,
}: {
    group: TraceGroup;
    isExpanded: boolean;
    onToggle: () => void;
    selectedSpanId: string | null;
    onSelectSpan: (span: TraceSpan | null) => void;
}) {
    return (
        <div>
            {/* Trace header row with canvas mini bar */}
            <button
                onClick={onToggle}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors text-left group/trace"
            >
                {isExpanded
                    ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                    : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                }
                <div className={`w-2 h-2 rounded-full shrink-0 ${group.hasError ? STATUS_COLORS.error : STATUS_COLORS.ok}`} />
                <span className="text-sm font-medium truncate max-w-[200px]" title={group.rootName}>
                    {group.rootName}
                </span>
                <span className="text-xs text-muted-foreground font-mono shrink-0">
                    {group.traceId.slice(0, 8)}
                </span>
                <span className="text-xs text-muted-foreground shrink-0">
                    {group.spanCount} span{group.spanCount !== 1 ? 's' : ''}
                </span>

                {/* Canvas-based mini waterfall bar */}
                <MiniWaterfallCanvas
                    spans={group.spans}
                    startTime={group.startTime}
                    durationMs={group.durationMs}
                />

                <span className="text-xs font-mono tabular-nums shrink-0 font-medium">
                    {formatDuration(group.durationMs)}
                </span>
                <span className="text-xs text-muted-foreground shrink-0">
                    {formatTime(group.startTime)}
                </span>
            </button>

            {/* Expanded waterfall view */}
            {isExpanded && (
                <WaterfallView
                    group={group}
                    selectedSpanId={selectedSpanId}
                    onSelectSpan={onSelectSpan}
                />
            )}
        </div>
    );
});

// ─── Main TracesViewer ──────────────────────────────────────────────────────

export function TracesViewer({ traces, channelName }: TracesViewerProps) {
    const [expandedTraces, setExpandedTraces] = useState<Set<string>>(new Set());
    const [selectedSpan, setSelectedSpan] = useState<TraceSpan | null>(null);

    const traceGroups = useMemo(() => {
        const grouped = new Map<string, TraceSpan[]>();
        for (const span of traces) {
            const existing = grouped.get(span.traceId);
            if (existing) existing.push(span);
            else grouped.set(span.traceId, [span]);
        }

        const groups: TraceGroup[] = [];
        for (const [traceId, spans] of grouped) {
            spans.sort((a, b) => a.startTimeMs - b.startTimeMs);
            const startTimes = spans.map(s => s.startTimeMs);
            const endTimes = spans.map(s => s.endTimeMs);
            const startTime = arrayMin(startTimes);
            const endTime = arrayMax(endTimes);
            const root = spans.find(s => !s.parentSpanId) || spans[0];
            const hasError = spans.some(s => s.status?.code === 2);
            const serviceName = getServiceName(root);
            groups.push({
                traceId,
                rootName: root.name,
                serviceName,
                spans,
                startTime,
                endTime,
                durationMs: endTime - startTime,
                hasError,
                spanCount: spans.length,
            });
        }

        groups.sort((a, b) => b.startTime - a.startTime);
        return groups;
    }, [traces]);

    const nameColorIndex = useMemo(() => {
        if (!selectedSpan) return new Map<string, number>();
        const group = traceGroups.find(g => g.traceId === selectedSpan.traceId);
        if (!group) return new Map<string, number>();
        const names = [...new Set(group.spans.map(s => s.name))];
        const map = new Map<string, number>();
        names.forEach((name, i) => map.set(name, i));
        return map;
    }, [selectedSpan, traceGroups]);

    const toggleTrace = useCallback((traceId: string) => {
        setExpandedTraces(prev => {
            const next = new Set(prev);
            if (next.has(traceId)) next.delete(traceId);
            else next.add(traceId);
            return next;
        });
    }, []);

    const handleSelectSpan = useCallback((span: TraceSpan | null) => {
        setSelectedSpan(span);
    }, []);

    // Virtualize the trace group list
    const listParentRef = useRef<HTMLDivElement>(null);
    const groupVirtualizer = useVirtualizer({
        count: traceGroups.length,
        getScrollElement: () => listParentRef.current,
        // Collapsed rows are ~44px, expanded ones vary but estimateSize is just a hint
        estimateSize: (index) => {
            const group = traceGroups[index];
            if (!group) return 44;
            if (expandedTraces.has(group.traceId)) {
                // header + timeline header + span rows (capped) + padding
                return 44 + 32 + Math.min(group.spanCount * 32, 500) + 16;
            }
            return 44;
        },
        overscan: 5,
    });

    // Re-measure when expanded set changes
    useEffect(() => {
        groupVirtualizer.measure();
    }, [expandedTraces, groupVirtualizer]);

    if (!channelName) {
        return (
            <div className="flex-1 flex items-center justify-center bg-background">
                <p className="text-muted-foreground text-sm">Select a channel to view traces</p>
            </div>
        );
    }

    if (traces.length === 0) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-background">
                <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-6 shadow-sm ring-1 ring-border/50">
                    <GitCommitVertical className="w-8 h-8 text-muted-foreground/70" />
                </div>
                <h2 className="text-xl font-semibold mb-2 text-foreground tracking-tight">Waiting for Traces</h2>
                <p className="text-muted-foreground max-w-sm text-balance">
                    Send OTLP traces to the /v1/traces endpoint to see span data here.
                </p>
            </div>
        );
    }

    return (
        <div className="flex-1 flex bg-background overflow-hidden">
            {/* Main content */}
            <div className="flex-1 flex flex-col overflow-hidden min-w-0">
                {/* Summary bar */}
                <div className="flex items-center gap-4 px-4 py-3 border-b border-border/50 bg-card/50 shrink-0">
                    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <Hash className="w-3.5 h-3.5" />
                        <span>{traceGroups.length} traces</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <GitCommitVertical className="w-3.5 h-3.5" />
                        <span>{traces.length} spans</span>
                    </div>
                    {traceGroups.some(g => g.hasError) && (
                        <div className="flex items-center gap-1.5 text-sm text-red-500">
                            <AlertCircle className="w-3.5 h-3.5" />
                            <span>{traceGroups.filter(g => g.hasError).length} with errors</span>
                        </div>
                    )}
                </div>

                {/* Virtualized trace group list */}
                <div ref={listParentRef} className="flex-1 overflow-y-auto">
                    <div
                        style={{
                            height: `${groupVirtualizer.getTotalSize()}px`,
                            width: '100%',
                            position: 'relative',
                        }}
                    >
                        {groupVirtualizer.getVirtualItems().map((virtualRow) => {
                            const group = traceGroups[virtualRow.index];
                            const isExpanded = expandedTraces.has(group.traceId);
                            return (
                                <div
                                    key={group.traceId}
                                    className="absolute top-0 left-0 w-full border-b border-border/30"
                                    style={{
                                        transform: `translateY(${virtualRow.start}px)`,
                                    }}
                                    ref={groupVirtualizer.measureElement}
                                    data-index={virtualRow.index}
                                >
                                    <TraceRow
                                        group={group}
                                        isExpanded={isExpanded}
                                        onToggle={() => toggleTrace(group.traceId)}
                                        selectedSpanId={selectedSpan?.spanId ?? null}
                                        onSelectSpan={handleSelectSpan}
                                    />
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Detail panel */}
            {selectedSpan && (
                <SpanDetailPanel
                    span={selectedSpan}
                    onClose={() => setSelectedSpan(null)}
                    nameColorIndex={nameColorIndex}
                />
            )}
        </div>
    );
}
