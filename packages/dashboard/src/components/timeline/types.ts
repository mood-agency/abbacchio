/**
 * Timeline Scrollbar Types
 *
 * These types are designed to be generic and reusable across different projects.
 */

/**
 * Represents a time bucket with a count of items.
 * Used to display density bars in the timeline.
 */
export interface TimeBucketData {
  /** Unix timestamp (start of the time bucket in milliseconds) */
  timestamp: number;
  /** Number of items in this time bucket */
  count: number;
}

/**
 * Represents the time range of available data.
 */
export interface TimeRange {
  /** Minimum timestamp in milliseconds, or null if no data */
  minTime: number | null;
  /** Maximum timestamp in milliseconds, or null if no data */
  maxTime: number | null;
}

/**
 * Generic item interface - only requires a time property.
 * Your actual items can have any additional properties.
 */
export interface TimelineItem {
  /** Unix timestamp in milliseconds */
  time: number;
}

/**
 * Function type for getting the index of an item at a specific time.
 * This allows the hook to work with any data source (SQLite, REST API, etc.)
 */
export type GetIndexByTimeFunction = (targetTime: number) => Promise<number>;
