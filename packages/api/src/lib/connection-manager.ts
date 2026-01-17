/**
 * SSE Connection Manager
 * Tracks active SSE connections, enforces limits, and provides stats
 */

export interface ConnectionInfo {
  id: string;
  channel: string;
  connectedAt: number;
  lastActivity: number;
  bytesSent: number;
  messagesSent: number;
  messagesDropped: number;
  ip: string;
}

export interface ConnectionStats {
  totalConnections: number;
  connectionsByChannel: Record<string, number>;
  oldestConnection: number | null;
  totalBytesSent: number;
  totalMessagesSent: number;
  totalMessagesDropped: number;
}

export interface ConnectionManagerConfig {
  maxConnections: number;
  maxConnectionsPerIp: number; // SECURITY: limit connections per IP to prevent DoS
  connectionTimeout: number; // ms - disconnect after inactivity
  heartbeatInterval: number; // ms - interval for heartbeat checks
}

const DEFAULT_CONFIG: ConnectionManagerConfig = {
  maxConnections: parseInt(process.env.MAX_CONNECTIONS || '1000', 10),
  maxConnectionsPerIp: parseInt(process.env.MAX_CONNECTIONS_PER_IP || '10', 10),
  connectionTimeout: parseInt(process.env.CONNECTION_TIMEOUT || '3600000', 10), // 1 hour
  heartbeatInterval: 60000, // 60 seconds
};

export class ConnectionManager {
  private connections: Map<string, ConnectionInfo> = new Map();
  private config: ConnectionManagerConfig;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: Partial<ConnectionManagerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start the cleanup interval for stale connections
   */
  startCleanupInterval(): void {
    if (this.cleanupInterval) return;

    this.cleanupInterval = setInterval(() => {
      this.cleanupStaleConnections();
    }, this.config.heartbeatInterval);
  }

  /**
   * Stop the cleanup interval
   */
  stopCleanupInterval(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Check if a new connection can be accepted
   */
  canAcceptConnection(): boolean {
    return this.connections.size < this.config.maxConnections;
  }

  /**
   * Get number of connections from a specific IP
   */
  getConnectionCountByIp(ip: string): number {
    let count = 0;
    for (const conn of this.connections.values()) {
      if (conn.ip === ip) {
        count++;
      }
    }
    return count;
  }

  /**
   * Check if an IP can accept more connections
   */
  canIpAcceptConnection(ip: string): boolean {
    return this.getConnectionCountByIp(ip) < this.config.maxConnectionsPerIp;
  }

  /**
   * Register a new connection
   * @returns connection ID if accepted, null if limit reached
   */
  register(channel: string, ip: string): string | null {
    if (!this.canAcceptConnection()) {
      return null;
    }

    // SECURITY: Check per-IP limit to prevent single IP from exhausting connections
    if (!this.canIpAcceptConnection(ip)) {
      return null;
    }

    const id = `conn_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    const now = Date.now();

    this.connections.set(id, {
      id,
      channel,
      connectedAt: now,
      lastActivity: now,
      bytesSent: 0,
      messagesSent: 0,
      messagesDropped: 0,
      ip,
    });

    return id;
  }

  /**
   * Unregister a connection
   */
  unregister(id: string): void {
    this.connections.delete(id);
  }

  /**
   * Update connection activity timestamp
   */
  touch(id: string): void {
    const conn = this.connections.get(id);
    if (conn) {
      conn.lastActivity = Date.now();
    }
  }

  /**
   * Record bytes sent for a connection
   */
  recordBytesSent(id: string, bytes: number): void {
    const conn = this.connections.get(id);
    if (conn) {
      conn.bytesSent += bytes;
      conn.messagesSent++;
      conn.lastActivity = Date.now();
    }
  }

  /**
   * Record a dropped message for a connection
   */
  recordDroppedMessage(id: string): void {
    const conn = this.connections.get(id);
    if (conn) {
      conn.messagesDropped++;
    }
  }

  /**
   * Get connection info
   */
  get(id: string): ConnectionInfo | undefined {
    return this.connections.get(id);
  }

  /**
   * Get all connections for a channel
   */
  getByChannel(channel: string): ConnectionInfo[] {
    return Array.from(this.connections.values()).filter(c => c.channel === channel);
  }

  /**
   * Check if a connection is stale (no activity within timeout)
   */
  isStale(id: string): boolean {
    const conn = this.connections.get(id);
    if (!conn) return true;
    return Date.now() - conn.lastActivity > this.config.connectionTimeout;
  }

  /**
   * Get IDs of stale connections
   */
  getStaleConnectionIds(): string[] {
    const now = Date.now();
    const staleIds: string[] = [];

    for (const [id, conn] of this.connections) {
      if (now - conn.lastActivity > this.config.connectionTimeout) {
        staleIds.push(id);
      }
    }

    return staleIds;
  }

  /**
   * Clean up stale connections (returns list of cleaned IDs)
   */
  cleanupStaleConnections(): string[] {
    const staleIds = this.getStaleConnectionIds();
    for (const id of staleIds) {
      this.connections.delete(id);
    }
    return staleIds;
  }

  /**
   * Get connection statistics
   */
  getStats(): ConnectionStats {
    const connectionsByChannel: Record<string, number> = {};
    let oldestConnection: number | null = null;
    let totalBytesSent = 0;
    let totalMessagesSent = 0;
    let totalMessagesDropped = 0;

    for (const conn of this.connections.values()) {
      connectionsByChannel[conn.channel] = (connectionsByChannel[conn.channel] || 0) + 1;

      if (oldestConnection === null || conn.connectedAt < oldestConnection) {
        oldestConnection = conn.connectedAt;
      }

      totalBytesSent += conn.bytesSent;
      totalMessagesSent += conn.messagesSent;
      totalMessagesDropped += conn.messagesDropped;
    }

    return {
      totalConnections: this.connections.size,
      connectionsByChannel,
      oldestConnection,
      totalBytesSent,
      totalMessagesSent,
      totalMessagesDropped,
    };
  }

  /**
   * Get current connection count
   */
  get size(): number {
    return this.connections.size;
  }

  /**
   * Get max connections limit
   */
  get maxConnections(): number {
    return this.config.maxConnections;
  }

  /**
   * Get all connection IDs
   */
  getAllConnectionIds(): string[] {
    return Array.from(this.connections.keys());
  }

  /**
   * Clear all connections (for testing/shutdown)
   */
  clear(): void {
    this.connections.clear();
  }
}

// Singleton instance
let instance: ConnectionManager | null = null;

export function getConnectionManager(): ConnectionManager {
  if (!instance) {
    instance = new ConnectionManager();
    instance.startCleanupInterval();
  }
  return instance;
}

export function resetConnectionManager(): void {
  if (instance) {
    instance.stopCleanupInterval();
    instance.clear();
  }
  instance = null;
}
