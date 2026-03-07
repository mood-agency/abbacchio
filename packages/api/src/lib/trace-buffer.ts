import { EventEmitter } from 'events';
import type { TraceSpan } from '../types.js';
import { DEFAULT_CHANNEL } from './log-buffer.js';

export interface TraceBufferConfig {
    maxSpansPerChannel: number;
}

const DEFAULT_CONFIG: TraceBufferConfig = {
    maxSpansPerChannel: parseInt(process.env.MAX_SPANS || '10000', 10),
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

    private registerChannel(channel: string): void {
        if (!this.channels.has(channel)) {
            this.channels.set(channel, []);
        }
    }

    /**
     * Process a batch of spans.
     */
    addBatch(spans: TraceSpan[]): void {
        if (spans.length === 0) return;

        const spansByChannel = new Map<string, TraceSpan[]>();

        for (const span of spans) {
            const channel = span.channel || DEFAULT_CHANNEL;
            this.registerChannel(channel);

            if (!spansByChannel.has(channel)) {
                spansByChannel.set(channel, []);
            }
            spansByChannel.get(channel)!.push(span);
        }

        for (const [channel, channelSpans] of spansByChannel) {
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
