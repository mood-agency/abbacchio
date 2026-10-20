import { EventEmitter } from 'events';
import type { TraceSpan } from '../types.js';
import { DEFAULT_CHANNEL } from './log-buffer.js';

export interface TraceBufferConfig {
    maxSpansPerChannel: number;
    maxChannels: number;
}

const DEFAULT_CONFIG: TraceBufferConfig = {
    maxSpansPerChannel: parseInt(process.env.MAX_SPANS || '10000', 10),
    maxChannels: parseInt(process.env.MAX_CHANNELS || '10000', 10),
};

/**
 * In-memory buffer for Traces.
 * Stores spans for polling by the dashboard.
 */
export class TraceBuffer extends EventEmitter {
    private channels: Map<string, TraceSpan[]> = new Map();
    private config: TraceBufferConfig;

    constructor(config: Partial<TraceBufferConfig> = {}) {
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
     * Process a batch of spans.
     */
    addBatch(spans: TraceSpan[]): void {
        if (spans.length === 0) return;

        const spansByChannel = new Map<string, TraceSpan[]>();

        for (const span of spans) {
            const channel = span.channel || DEFAULT_CHANNEL;
            if (!spansByChannel.has(channel)) {
                spansByChannel.set(channel, []);
            }
            spansByChannel.get(channel)!.push(span);
        }

        for (const [channel, channelSpans] of spansByChannel) {
            this.registerChannel(channel);
            const stored = this.channels.get(channel)!;
            stored.push(...channelSpans);

            if (stored.length > this.config.maxSpansPerChannel) {
                stored.splice(0, stored.length - this.config.maxSpansPerChannel);
            }
        }
    }

    /**
     * Get all currently buffered spans for a channel
     */
    getAll(channel: string = DEFAULT_CHANNEL): TraceSpan[] {
        return this.channels.get(channel) || [];
    }

    /**
     * Get all channels that have traces
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

let instance: TraceBuffer | null = null;

export function getTraceBuffer(): TraceBuffer {
    if (!instance) {
        instance = new TraceBuffer();
    }
    return instance;
}

export function resetTraceBuffer(): void {
    if (instance) {
        instance.removeAllListeners();
    }
    instance = null;
}
