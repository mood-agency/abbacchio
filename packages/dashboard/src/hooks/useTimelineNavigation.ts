/**
 * useTimelineNavigation - Project-specific wrapper
 *
 * This is a thin wrapper around the generic useTimelineNavigation hook
 * that adapts it to the project's types and integrates with the SQLite database.
 */

import { useCallback } from 'react';
import type { Virtualizer } from '@tanstack/react-virtual';
import type { LogEntry } from '../types';
import type { HourlyLogCount, LogTimeRange } from '../lib/sqlite-db';
import { getLogIndexByTime } from '../lib/sqlite-db';
import {
  useTimelineNavigation as useGenericTimelineNavigation,
  type TimeBucketData,
  type TimeRange,
  type BucketPositionMap,
} from '../components/timeline';

// Hour bucket size in milliseconds
const HOUR_MS = 60 * 60 * 1000;

export interface UseTimelineNavigationOptions {
  logs: LogEntry[];
  hourlyData: HourlyLogCount[];
  logTimeRange: LogTimeRange;
  virtualizer: Virtualizer<HTMLDivElement, Element> | null;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  channelName: string | null;
  filters: {
    levels: string[];
    namespaces: string[];
    minTime?: number;
    search: string;
  };
}

export interface UseTimelineNavigationResult {
  /** Current position of the thumb (0-1, where 0 = newest, 1 = oldest) */
  thumbPosition: number;
  /** Timestamp of the hour currently visible in viewport center */
  currentHour: number | null;
  /** Navigate to a specific hour with smooth scroll */
  scrollToHour: (hour: number) => void;
  /** Handle thumb drag - position is 0-1 */
  handleThumbDrag: (position: number) => void;
  /** Whether currently dragging the thumb */
  isDragging: boolean;
  /** Set dragging state */
  setIsDragging: (dragging: boolean) => void;
  /** Callback to update bucket positions - pass to TimelineScrollbar's onBucketPositionsChange */
  setHourPositions: (positions: BucketPositionMap) => void;
}

// Convert HourlyLogCount to TimeBucketData
function toTimeBucketData(hourlyData: HourlyLogCount[]): TimeBucketData[] {
  return hourlyData.map(h => ({
    timestamp: h.hour,
    count: h.count,
  }));
}

// Convert LogTimeRange to TimeRange
function toTimeRange(logTimeRange: LogTimeRange): TimeRange {
  return {
    minTime: logTimeRange.minTime,
    maxTime: logTimeRange.maxTime,
  };
}

export function useTimelineNavigation(options: UseTimelineNavigationOptions): UseTimelineNavigationResult {
  const {
    logs,
    hourlyData,
    logTimeRange,
    virtualizer,
    scrollContainerRef,
    channelName,
    filters,
  } = options;

  // Create the getIndexByTime function that uses SQLite
  const getIndexByTime = useCallback(async (targetTime: number): Promise<number> => {
    if (!channelName) return 0;

    return getLogIndexByTime({
      channel: channelName,
      targetTime,
      levels: filters.levels.length > 0 ? filters.levels : undefined,
      namespaces: filters.namespaces.length > 0 ? filters.namespaces : undefined,
      minTime: filters.minTime,
      search: filters.search || undefined,
    });
  }, [channelName, filters]);

  // Use the generic hook
  const result = useGenericTimelineNavigation({
    items: logs,
    buckets: toTimeBucketData(hourlyData),
    timeRange: toTimeRange(logTimeRange),
    virtualizer,
    scrollContainerRef,
    getIndexByTime,
    bucketSizeMs: HOUR_MS,
    estimatedRowHeight: 36,
  });

  // Map the result to project-specific names
  return {
    thumbPosition: result.thumbPosition,
    currentHour: result.currentBucket,
    scrollToHour: result.scrollToBucket,
    handleThumbDrag: result.handleThumbDrag,
    isDragging: result.isDragging,
    setIsDragging: result.setIsDragging,
    setHourPositions: result.setBucketPositions,
  };
}
