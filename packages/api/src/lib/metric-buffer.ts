import { EventEmitter } from 'events';
import type { MetricDataPoint } from '../types.js';
import { DEFAULT_CHANNEL } from './log-buffer.js';

export interface MetricBufferConfig {
    maxDataPointsPerChannel: number;
}

const DEFAULT_CONFIG: MetricBufferConfig = {
    maxDataPointsPerChannel: parseInt(process.env.MAX_METRICS || '5000', 10),
};

/**
 * In-memory buffer for Metrics.
 * Maintains a ring-buffer of the latest metrics per channel for polling.
 */
export class MetricBuffer extends EventEmitter {
    private channels: Map<string, MetricDataPoint[]> = new Map();
    private config: MetricBufferConfig;

    constructor(config: Partial<MetricBufferConfig> = {}) {
        super();
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    private registerChannel(channel: string): void {
        if (!this.channels.has(channel)) {
            this.channels.set(channel, []);
        }
    }

    /**
     * Add a batch of metrics.
     */
    addBatch(metrics: MetricDataPoint[]): void {
        if (metrics.length === 0) return;

        const metricsByChannel = new Map<string, MetricDataPoint[]>();

        for (const metric of metrics) {
            const channel = metric.channel || DEFAULT_CHANNEL;
            this.registerChannel(channel);

            if (!metricsByChannel.has(channel)) {
                metricsByChannel.set(channel, []);
            }
            metricsByChannel.get(channel)!.push(metric);
        }

        for (const [channel, channelMetrics] of metricsByChannel) {
            const stored = this.channels.get(channel)!;
            stored.push(...channelMetrics);

            // Keep only the most recent N points
            if (stored.length > this.config.maxDataPointsPerChannel) {
                stored.splice(0, stored.length - this.config.maxDataPointsPerChannel);
            }
        }
    }

    /**
     * Get all currently buffered metrics for a channel
     */
    getAll(channel: string = DEFAULT_CHANNEL): MetricDataPoint[] {
        return this.channels.get(channel) || [];
    }

    /**
     * Get all channels that have metrics
     */
    getChannels(): string[] {
        return Array.from(this.channels.keys());
    }

    clear(channel?: string): void {
        if (channel) {
            this.channels.set(channel, []);
        } else {
            this.channels.clear();
        }
    }
}

let instance: MetricBuffer | null = null;

export function getMetricBuffer(): MetricBuffer {
    if (!instance) {
        instance = new MetricBuffer();
    }
    return instance;
}

export function resetMetricBuffer(): void {
    if (instance) {
        instance.removeAllListeners();
    }
    instance = null;
}
