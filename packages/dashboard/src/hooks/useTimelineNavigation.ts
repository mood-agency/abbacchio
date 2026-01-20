/**
 * useTimelineNavigation - Project-specific wrapper
 *
 * This is a thin wrapper around the generic useTimelineNavigation hook
 * that adapts it to the project's types and integrates with the SQLite database.
 *
 * It now supports time-window pagination by using navigateToTime when
 * the target time is outside the currently loaded window.
 */

import { useCallback, useRef } from 'react';
import type { Virtualizer } from '@tanstack/react-virtual';
import type { LogEntry } from '../types';
import type { HourlyLogCount, LogTimeRange } from '../lib/sqlite-db';
import type { LoadedTimeRange } from './useChannelLogStream';
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
  /** Currently loaded time window (for time-window pagination) */
  loadedTimeRange?: LoadedTimeRange | null;
  /** Function to navigate to a time, loading new window if needed */
  navigateToTime?: (targetTime: number) => Promise<number>;
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
  /** Whether currently navigating to a new hour */
  isNavigating: boolean;
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
    // filters - no longer used, we find index directly in loaded logs
    loadedTimeRange,
    navigateToTime,
  } = options;

  // Track if we're currently loading to prevent duplicate loads
  const isLoadingRef = useRef(false);

  // getIndexByTime - find index in logs, load new window if needed
  const getIndexByTime = useCallback(async (targetTime: number): Promise<number> => {
    if (!channelName) return 0;

    // Check if target is outside loaded range and we can load new data
    if (loadedTimeRange && navigateToTime) {
      const isOutsideWindow = targetTime < loadedTimeRange.start || targetTime > loadedTimeRange.end;

      if (isOutsideWindow && !isLoadingRef.current) {
        // Load new window - mark as loading to prevent duplicate loads
        isLoadingRef.current = true;
        try {
          const index = await navigateToTime(targetTime);
          return index;
        } finally {
          // Reset after a delay to allow the new data to settle
          setTimeout(() => {
            isLoadingRef.current = false;
          }, 1000);
        }
      }
    }

    // Find index directly in loaded logs (logs are sorted DESC by time)
    if (logs.length === 0) return 0;
    const index = logs.findIndex(log => log.time <= targetTime);
    return index >= 0 ? index : 0;
  }, [channelName, logs, loadedTimeRange, navigateToTime]);

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
    isNavigating: result.isNavigating,
  };
}
