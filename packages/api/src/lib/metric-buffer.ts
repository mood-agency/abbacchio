import { EventEmitter } from 'events';
import type { MetricDataPoint } from '../types.js';
import { DEFAULT_CHANNEL } from './log-buffer.js';

export interface MetricBufferConfig {
    maxDataPointsPerChannel: number;
    maxChannels: number;
}

const DEFAULT_CONFIG: MetricBufferConfig = {
    maxDataPointsPerChannel: parseInt(process.env.MAX_METRICS || '5000', 10),
    maxChannels: parseInt(process.env.MAX_CHANNELS || '10000', 10),
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

    /**
     * Register a channel, evicting the least recently written one at the cap.
     * Map keeps insertion order, so re-inserting on write keeps it LRU-ordered.
     */
    private registerChannel(channel: string): void {
        const existing = this.channels.get(channel);
        if (existing) {
            this.channels.delete(channel);
            this.channels.set(channel, existing);
            return;
        }
        if (this.channels.size >= this.config.maxChannels) {
            const oldest = this.channels.keys().next().value;
            if (oldest !== undefined) this.channels.delete(oldest);
        }
        this.channels.set(channel, []);
    }

    /**
     * Add a batch of metrics.
     */
    addBatch(metrics: MetricDataPoint[]): void {
        if (metrics.length === 0) return;

        const metricsByChannel = new Map<string, MetricDataPoint[]>();

        for (const metric of metrics) {
            const channel = metric.channel || DEFAULT_CHANNEL;
            if (!metricsByChannel.has(channel)) {
                metricsByChannel.set(channel, []);
            }
            metricsByChannel.get(channel)!.push(metric);
        }

        for (const [channel, channelMetrics] of metricsByChannel) {
            this.registerChannel(channel);
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
