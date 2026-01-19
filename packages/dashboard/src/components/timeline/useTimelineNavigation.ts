/**
 * useTimelineNavigation Hook
 *
 * Provides bidirectional synchronization between a virtualized list and a timeline scrollbar.
 * Works with any data source by accepting a function to get the index of an item at a specific time.
 *
 * Features:
 * - Syncs scroll position to timeline thumb position
 * - Syncs timeline navigation to scroll position
 * - Debounced updates to prevent feedback loops
 * - Handles programmatic scrolls separately from user scrolls
 * - Immediate visual feedback during drag with debounced navigation
 *
 * @example
 * ```tsx
 * const {
 *   thumbPosition,
 *   currentBucket,
 *   scrollToBucket,
 *   handleThumbDrag,
 *   isDragging,
 *   setIsDragging,
 * } = useTimelineNavigation({
 *   items: logs,
 *   buckets: hourlyData,
 *   timeRange: logTimeRange,
 *   virtualizer: rowVirtualizer,
 *   scrollContainerRef,
 *   getIndexByTime: async (time) => getLogIndexByTime({ channel, targetTime: time }),
 *   bucketSizeMs: 60 * 60 * 1000, // 1 hour
 * });
 * ```
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { Virtualizer } from '@tanstack/react-virtual';
import type { TimeBucketData, TimeRange, TimelineItem, GetIndexByTimeFunction } from './types';
import type { BucketPositionMap } from './TimelineScrollbar';

// Default bucket size: 1 hour in milliseconds
const DEFAULT_BUCKET_SIZE_MS = 60 * 60 * 1000;

// Debounce delay for scroll -> timeline sync
const SCROLL_DEBOUNCE_MS = 100;

// Debounce delay for drag scroll updates (~60fps)
const DRAG_SCROLL_DEBOUNCE_MS = 16;

// Time window to ignore timeline updates after programmatic scroll
const PROGRAMMATIC_SCROLL_WINDOW_MS = 2000;

// Get the start of the bucket for a timestamp
function getBucketTimestamp(time: number, bucketSizeMs: number): number {
  return Math.floor(time / bucketSizeMs) * bucketSizeMs;
}

// Helper to find the index of a bucket in the sorted buckets array (descending order)
function findBucketIndex(buckets: TimeBucketData[], timestamp: number): number {
  // Sort descending (newest first) to match TimelineScrollbar
  const sorted = [...buckets].sort((a, b) => b.timestamp - a.timestamp);
  return sorted.findIndex(b => b.timestamp === timestamp);
}

export interface UseTimelineNavigationOptions<T extends TimelineItem> {
  /** Array of items with time property */
  items: T[];
  /** Array of time buckets with counts */
  buckets: TimeBucketData[];
  /** Time range of the data */
  timeRange: TimeRange;
  /** TanStack Virtual virtualizer instance */
  virtualizer: Virtualizer<HTMLDivElement, Element> | null;
  /** Ref to the scroll container element */
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  /** Function to get the index of an item at a specific time */
  getIndexByTime: GetIndexByTimeFunction;
  /** Optional: Size of each time bucket in milliseconds (default: 1 hour) */
  bucketSizeMs?: number;
  /** Optional: Estimated row height for scroll calculations (default: 36px) */
  estimatedRowHeight?: number;
}

export interface UseTimelineNavigationResult {
  /** Current position of the thumb (0-1, where 0 = newest, 1 = oldest) */
  thumbPosition: number;
  /** Timestamp of the bucket currently visible in viewport center */
  currentBucket: number | null;
  /** Navigate to a specific bucket timestamp */
  scrollToBucket: (timestamp: number) => void;
  /** Handle thumb drag - position is 0-1 */
  handleThumbDrag: (position: number) => void;
  /** Whether currently dragging the thumb */
  isDragging: boolean;
  /** Set dragging state */
  setIsDragging: (dragging: boolean) => void;
  /** Callback to update bucket positions from TimelineScrollbar - pass to onBucketPositionsChange prop */
  setBucketPositions: (positions: BucketPositionMap) => void;
}

export function useTimelineNavigation<T extends TimelineItem>(
  options: UseTimelineNavigationOptions<T>
): UseTimelineNavigationResult {
  const {
    items,
    buckets,
    timeRange,
    virtualizer,
    scrollContainerRef,
    getIndexByTime,
    bucketSizeMs = DEFAULT_BUCKET_SIZE_MS,
    estimatedRowHeight = 36,
  } = options;

  const [thumbPosition, setThumbPosition] = useState(0);
  const [currentBucket, setCurrentBucket] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Track previous dragging state for snap-on-release
  const prevIsDraggingRef = useRef(false);

  // Store bucket positions from TimelineScrollbar for accurate snap positioning
  const bucketPositionsRef = useRef<BucketPositionMap>(new Map());

  // Callback to update bucket positions and snap thumb if needed
  const setBucketPositions = useCallback((positions: BucketPositionMap) => {
    bucketPositionsRef.current = positions;

    // Whenever positions are updated and we have a current bucket, snap to it
    if (positions.size > 0 && currentBucket !== null && !isDragging) {
      const realPosition = positions.get(currentBucket);
      if (realPosition !== undefined) {
        setThumbPosition(Math.max(0, Math.min(1, realPosition)));
      }
    }
  }, [currentBucket, isDragging]);

  // Ref for debounce timeout
  const scrollDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track if we're programmatically scrolling (to avoid feedback loop)
  const isProgrammaticScrollRef = useRef(false);

  // Store the target scroll position to restore after data reloads
  const targetScrollTopRef = useRef<number | null>(null);

  // Store the target bucket to re-navigate after data changes
  const targetBucketRef = useRef<number | null>(null);

  // Store when we started programmatic scroll
  const programmaticScrollStartRef = useRef<number>(0);

  // Debounce ref for drag scroll updates
  const dragScrollDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Update timeline position based on scroll position
  const updateTimelineFromScroll = useCallback(() => {
    // Don't update if we're in the middle of a programmatic scroll
    if (isProgrammaticScrollRef.current) {
      return;
    }

    // Also check if we're within the programmatic scroll window
    const timeSinceScroll = Date.now() - programmaticScrollStartRef.current;
    if (timeSinceScroll < PROGRAMMATIC_SCROLL_WINDOW_MS) {
      return;
    }

    if (!virtualizer || !items.length || !timeRange.minTime || !timeRange.maxTime || isDragging) {
      return;
    }

    // Get the scroll offset and calculate which item is in the center of viewport
    const scrollOffset = virtualizer.scrollOffset ?? 0;
    const viewportHeight = scrollContainerRef.current?.clientHeight ?? 0;
    const centerOffset = scrollOffset + viewportHeight / 2;

    // Estimate which row is at center
    const centerIndex = Math.floor(centerOffset / estimatedRowHeight);
    const clampedIndex = Math.max(0, Math.min(centerIndex, items.length - 1));

    const centerItem = items[clampedIndex];
    if (!centerItem) return;

    // Update current bucket
    const bucket = getBucketTimestamp(centerItem.time, bucketSizeMs);
    setCurrentBucket(bucket);

    // Calculate thumb position based on bucket's position in the timeline
    // Use real bucket positions if available, otherwise fallback to index-based calculation
    if (buckets.length > 0) {
      const realPosition = bucketPositionsRef.current.get(bucket);
      if (realPosition !== undefined) {
        setThumbPosition(Math.max(0, Math.min(1, realPosition)));
      } else {
        const bucketIndex = findBucketIndex(buckets, bucket);
        if (bucketIndex >= 0) {
          const position = (bucketIndex + 0.5) / buckets.length; // Center on the bucket
          setThumbPosition(Math.max(0, Math.min(1, position)));
        }
      }
    }
  }, [virtualizer, items, timeRange, scrollContainerRef, isDragging, buckets, bucketSizeMs, estimatedRowHeight]);

  // Listen to scroll events with debounce
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      // Skip if this is a programmatic scroll
      if (isProgrammaticScrollRef.current) {
        return;
      }

      // Debounce the timeline update
      if (scrollDebounceRef.current) {
        clearTimeout(scrollDebounceRef.current);
      }
      scrollDebounceRef.current = setTimeout(() => {
        updateTimelineFromScroll();
      }, SCROLL_DEBOUNCE_MS);
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', handleScroll);
      if (scrollDebounceRef.current) {
        clearTimeout(scrollDebounceRef.current);
      }
      if (dragScrollDebounceRef.current) {
        clearTimeout(dragScrollDebounceRef.current);
      }
    };
  }, [scrollContainerRef, updateTimelineFromScroll]);

  // Snap thumb to current bucket when drag ends
  useEffect(() => {
    // Detect drag end: was dragging, now not dragging
    if (prevIsDraggingRef.current && !isDragging && currentBucket !== null) {
      // Use real bucket position from TimelineScrollbar if available
      const realPosition = bucketPositionsRef.current.get(currentBucket);
      if (realPosition !== undefined) {
        setThumbPosition(Math.max(0, Math.min(1, realPosition)));
      } else if (buckets.length > 0) {
        // Fallback to calculated position if real positions not available
        const bucketIndex = findBucketIndex(buckets, currentBucket);
        if (bucketIndex >= 0) {
          const snappedPosition = (bucketIndex + 0.5) / buckets.length;
          setThumbPosition(Math.max(0, Math.min(1, snappedPosition)));
        }
      }
    }
    prevIsDraggingRef.current = isDragging;
  }, [isDragging, currentBucket, buckets]);

  // Track previous items length to detect when data is reloaded
  const prevItemsLengthRef = useRef(0);

  // Navigate to a specific index (internal helper)
  const scrollToIndex = useCallback((index: number) => {
    if (!virtualizer || !scrollContainerRef.current) return;

    const clampedIndex = Math.max(0, Math.min(index, items.length - 1));

    // Use virtualizer's scrollToIndex
    virtualizer.scrollToIndex(clampedIndex, {
      align: 'start',
      behavior: 'auto',
    });

    // Also set scroll position directly as backup
    const targetScrollTop = clampedIndex * estimatedRowHeight;
    const container = scrollContainerRef.current;

    requestAnimationFrame(() => {
      if (container) {
        container.scrollTop = targetScrollTop;
      }
    });
  }, [virtualizer, scrollContainerRef, items.length, estimatedRowHeight]);

  // Handle data changes - re-navigate if needed
  useEffect(() => {
    const isFirstLoad = prevItemsLengthRef.current === 0 && items.length > 0;
    const wasReload = prevItemsLengthRef.current > 0 && items.length > 0;
    prevItemsLengthRef.current = items.length;

    // If we're in a programmatic scroll and have a target bucket, re-navigate to it
    if (isProgrammaticScrollRef.current && targetBucketRef.current !== null && wasReload) {
      const targetTime = targetBucketRef.current + bucketSizeMs;

      getIndexByTime(targetTime)
        .then((index) => {
          scrollToIndex(index);
        })
        .catch((error) => {
          console.error('Failed to re-navigate to bucket:', error);
        });
      return;
    }

    // Only update timeline position on first load
    if (isFirstLoad && !isDragging && !isProgrammaticScrollRef.current) {
      updateTimelineFromScroll();
    }
  }, [items.length, updateTimelineFromScroll, isDragging, scrollToIndex, getIndexByTime, bucketSizeMs]);

  // Scroll to a specific bucket
  const scrollToBucket = useCallback(async (timestamp: number) => {
    if (!virtualizer || items.length === 0) {
      return;
    }

    try {
      const targetTime = timestamp + bucketSizeMs;
      const index = await getIndexByTime(targetTime);
      const clampedIndex = Math.max(0, Math.min(index, items.length - 1));

      // Mark as programmatic scroll
      isProgrammaticScrollRef.current = true;
      programmaticScrollStartRef.current = Date.now();
      targetBucketRef.current = timestamp;

      // Update current bucket immediately
      setCurrentBucket(timestamp);

      // Calculate thumb position
      if (buckets.length > 0) {
        const bucketIndex = findBucketIndex(buckets, timestamp);
        if (bucketIndex >= 0) {
          const position = (bucketIndex + 0.5) / buckets.length;
          setThumbPosition(Math.max(0, Math.min(1, position)));
        }
      }

      // Store target scroll position
      const targetScrollTop = clampedIndex * estimatedRowHeight;
      targetScrollTopRef.current = targetScrollTop;

      // Scroll to index
      virtualizer.scrollToIndex(clampedIndex, {
        align: 'start',
        behavior: 'auto',
      });

      // Also set scroll position directly as backup
      const scrollContainer = scrollContainerRef.current;
      if (scrollContainer) {
        requestAnimationFrame(() => {
          if (scrollContainer && targetScrollTopRef.current !== null) {
            scrollContainer.scrollTop = targetScrollTopRef.current;
          }
        });
      }

      // Reset programmatic scroll flag after delay
      setTimeout(() => {
        isProgrammaticScrollRef.current = false;
        targetScrollTopRef.current = null;
        targetBucketRef.current = null;
      }, PROGRAMMATIC_SCROLL_WINDOW_MS);
    } catch (error) {
      console.error('Failed to scroll to bucket:', error);
    }
  }, [virtualizer, items.length, getIndexByTime, buckets, bucketSizeMs, estimatedRowHeight, scrollContainerRef]);

  // Handle thumb drag
  const handleThumbDrag = useCallback((position: number) => {
    if (items.length === 0 || buckets.length === 0) {
      return;
    }

    // Clamp position
    const clampedPosition = Math.max(0, Math.min(1, position));

    // IMMEDIATE: Update thumb position visually
    setThumbPosition(clampedPosition);

    // Find which bucket corresponds to this position
    // Use real bucket positions if available, otherwise fallback to index-based calculation
    const sortedBuckets = [...buckets].sort((a, b) => b.timestamp - a.timestamp);
    let timestamp: number;

    if (bucketPositionsRef.current.size > 0) {
      // Find the bucket whose real position is closest to the drag position
      let closestBucket = sortedBuckets[0];
      let closestDistance = Infinity;

      for (const bucket of sortedBuckets) {
        const bucketPos = bucketPositionsRef.current.get(bucket.timestamp);
        if (bucketPos !== undefined) {
          const distance = Math.abs(bucketPos - clampedPosition);
          if (distance < closestDistance) {
            closestDistance = distance;
            closestBucket = bucket;
          }
        }
      }
      timestamp = closestBucket.timestamp;
    } else {
      // Fallback: index-based calculation
      const bucketIndex = Math.floor(clampedPosition * sortedBuckets.length);
      const clampedBucketIndex = Math.max(0, Math.min(bucketIndex, sortedBuckets.length - 1));
      const targetBucketData = sortedBuckets[clampedBucketIndex];
      if (!targetBucketData) return;
      timestamp = targetBucketData.timestamp;
    }

    // IMMEDIATE: Update current bucket highlight
    setCurrentBucket(timestamp);

    // Mark as programmatic scroll
    isProgrammaticScrollRef.current = true;

    // DEBOUNCED: Scroll item view
    if (dragScrollDebounceRef.current) {
      clearTimeout(dragScrollDebounceRef.current);
    }

    dragScrollDebounceRef.current = setTimeout(async () => {
      if (!virtualizer) return;

      try {
        const targetTime = timestamp + bucketSizeMs;
        const index = await getIndexByTime(targetTime);
        const clampedIndex = Math.max(0, Math.min(index, items.length - 1));

        virtualizer.scrollToIndex(clampedIndex, {
          align: 'start',
          behavior: 'auto',
        });
      } catch (error) {
        console.error('Failed to scroll during drag:', error);
      }

      // Reset flag after scroll completes
      setTimeout(() => {
        isProgrammaticScrollRef.current = false;
      }, 50);
    }, DRAG_SCROLL_DEBOUNCE_MS);
  }, [virtualizer, items, buckets, getIndexByTime, bucketSizeMs]);

  return {
    thumbPosition,
    currentBucket,
    scrollToBucket,
    handleThumbDrag,
    isDragging,
    setIsDragging,
    setBucketPositions,
  };
}

export default useTimelineNavigation;
