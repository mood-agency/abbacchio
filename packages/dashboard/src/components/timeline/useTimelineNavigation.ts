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
const SCROLL_DEBOUNCE_MS = 50;

// Debounce delay for drag scroll updates (~60fps)
const DRAG_SCROLL_DEBOUNCE_MS = 16;

// Time window to ignore timeline updates after programmatic scroll
const PROGRAMMATIC_SCROLL_WINDOW_MS = 500;

// Number of adjacent buckets to pre-cache (before and after current)
const PREFETCH_ADJACENT_BUCKETS = 2;

// Cache entry with timestamp for invalidation
interface CacheEntry {
  index: number;
  itemsLength: number; // To invalidate when items change significantly
}

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
  /** Whether currently navigating to a new time bucket */
  isNavigating: boolean;
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
  const [isNavigating, setIsNavigating] = useState(false);

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

  // Track last bucket click to prevent duplicate navigations
  const lastBucketClickRef = useRef<{ timestamp: number; time: number } | null>(null);

  // Track current drag bucket to navigate on drag end
  const currentDragBucketRef = useRef<number | null>(null);

  // Cache for bucket index lookups (bucket timestamp -> index)
  const indexCacheRef = useRef<Map<number, CacheEntry>>(new Map());

  // Get cached index or fetch it
  const getCachedIndex = useCallback(async (bucketTimestamp: number): Promise<{ index: number; fromCache: boolean }> => {
    const cache = indexCacheRef.current;
    const cached = cache.get(bucketTimestamp);

    // Check if cache entry is valid (items length hasn't changed significantly)
    if (cached && Math.abs(cached.itemsLength - items.length) < 100) {
      return { index: cached.index, fromCache: true };
    }

    // Fetch the index
    const targetTime = bucketTimestamp + bucketSizeMs;
    const index = await getIndexByTime(targetTime);

    // Store in cache
    cache.set(bucketTimestamp, { index, itemsLength: items.length });

    return { index, fromCache: false };
  }, [items.length, bucketSizeMs, getIndexByTime]);

  // Pre-fetch adjacent buckets in the background
  const prefetchAdjacentBuckets = useCallback((currentBucketTimestamp: number) => {
    const sortedBuckets = [...buckets].sort((a, b) => b.timestamp - a.timestamp);
    const currentIndex = sortedBuckets.findIndex(b => b.timestamp === currentBucketTimestamp);

    if (currentIndex === -1) return;

    // Get adjacent bucket timestamps
    const adjacentTimestamps: number[] = [];
    for (let i = 1; i <= PREFETCH_ADJACENT_BUCKETS; i++) {
      if (currentIndex - i >= 0) {
        adjacentTimestamps.push(sortedBuckets[currentIndex - i].timestamp);
      }
      if (currentIndex + i < sortedBuckets.length) {
        adjacentTimestamps.push(sortedBuckets[currentIndex + i].timestamp);
      }
    }

    // Pre-fetch in background (fire and forget)
    adjacentTimestamps.forEach(timestamp => {
      const cached = indexCacheRef.current.get(timestamp);
      if (!cached || Math.abs(cached.itemsLength - items.length) >= 100) {
        // Not cached or stale, fetch it
        const targetTime = timestamp + bucketSizeMs;
        getIndexByTime(targetTime).then(index => {
          indexCacheRef.current.set(timestamp, { index, itemsLength: items.length });
        }).catch(() => {
          // Silently ignore prefetch errors
        });
      }
    });
  }, [buckets, items.length, bucketSizeMs, getIndexByTime]);

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

    const container = scrollContainerRef.current;
    if (!virtualizer || !items.length || !timeRange.minTime || !timeRange.maxTime || isDragging || !container) {
      return;
    }

    // Get the scroll offset directly from container for accuracy
    const scrollOffset = container.scrollTop;
    const viewportHeight = container.clientHeight;
    const centerOffset = scrollOffset + viewportHeight / 2;

    // Estimate which row is at center
    const centerIndex = Math.floor(centerOffset / estimatedRowHeight);
    const clampedIndex = Math.max(0, Math.min(centerIndex, items.length - 1));

    const centerItem = items[clampedIndex];
    if (!centerItem) return;

    // Update current bucket
    const bucket = getBucketTimestamp(centerItem.time, bucketSizeMs);
    const bucketChanged = bucket !== currentBucket;
    setCurrentBucket(bucket);

    // Pre-fetch adjacent buckets when bucket changes (during user scroll)
    if (bucketChanged) {
      prefetchAdjacentBuckets(bucket);
    }

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
  }, [virtualizer, items, timeRange, scrollContainerRef, isDragging, buckets, bucketSizeMs, estimatedRowHeight, currentBucket, prefetchAdjacentBuckets]);

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

  // Snap thumb to current bucket when drag ends and navigate immediately
  useEffect(() => {
    // Detect drag end: was dragging, now not dragging
    if (prevIsDraggingRef.current && !isDragging && currentBucket !== null) {
      // Cancel any pending debounced scroll
      if (dragScrollDebounceRef.current) {
        clearTimeout(dragScrollDebounceRef.current);
        dragScrollDebounceRef.current = null;
      }

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

      // Navigate immediately to the final drag position
      const targetBucket = currentDragBucketRef.current;
      if (targetBucket !== null && virtualizer) {
        // Use cache if available
        getCachedIndex(targetBucket)
          .then(({ index, fromCache }) => {
            // Only show loading if not from cache
            if (!fromCache) {
              setIsNavigating(true);
            }

            const clampedIndex = Math.max(0, Math.min(index, items.length - 1));
            virtualizer.scrollToIndex(clampedIndex, {
              align: 'start',
              behavior: 'auto',
            });

            // Pre-fetch adjacent buckets
            prefetchAdjacentBuckets(targetBucket);

            return fromCache;
          })
          .then((fromCache) => {
            // Reset programmatic scroll flag and navigation state after navigation
            setTimeout(() => {
              isProgrammaticScrollRef.current = false;
              setIsNavigating(false);
            }, fromCache ? 50 : 100);
          })
          .catch((error) => {
            console.error('Failed to scroll on drag end:', error);
            setIsNavigating(false);
          });
      }

      // Clear the drag bucket ref
      currentDragBucketRef.current = null;
    }
    prevIsDraggingRef.current = isDragging;
  }, [isDragging, currentBucket, buckets, virtualizer, items.length, getCachedIndex, prefetchAdjacentBuckets]);

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
    // Only consider it a reload if the length changed significantly (not just new logs arriving)
    const prevLength = prevItemsLengthRef.current;
    const lengthDiff = Math.abs(items.length - prevLength);
    const wasSignificantReload = prevLength > 0 && items.length > 0 && lengthDiff > 100;
    prevItemsLengthRef.current = items.length;

    // If we're in a programmatic scroll and have a target bucket, re-navigate to it
    // but only on significant data reloads (not small incremental updates)
    if (isProgrammaticScrollRef.current && targetBucketRef.current !== null && wasSignificantReload) {
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

    // Update timeline position on first load or when bucket data arrives
    if ((isFirstLoad || (buckets.length > 0 && currentBucket === null)) && !isDragging && !isProgrammaticScrollRef.current) {
      updateTimelineFromScroll();
    }
  }, [items.length, buckets.length, currentBucket, updateTimelineFromScroll, isDragging, scrollToIndex, getIndexByTime, bucketSizeMs]);

  // Scroll to a specific bucket
  const scrollToBucket = useCallback(async (timestamp: number) => {
    if (!virtualizer || items.length === 0) {
      return;
    }

    // Prevent duplicate navigations to the same bucket within 500ms
    const now = Date.now();
    if (lastBucketClickRef.current &&
        lastBucketClickRef.current.timestamp === timestamp &&
        now - lastBucketClickRef.current.time < 500) {
      return;
    }
    lastBucketClickRef.current = { timestamp, time: now };

    try {
      // Try to get from cache first
      const { index, fromCache } = await getCachedIndex(timestamp);
      const clampedIndex = Math.max(0, Math.min(index, items.length - 1));

      // Only show loading if not from cache
      if (!fromCache) {
        setIsNavigating(true);
      }

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

      // Scroll to index (single call, no backup needed)
      virtualizer.scrollToIndex(clampedIndex, {
        align: 'start',
        behavior: 'auto',
      });

      // Pre-fetch adjacent buckets in background
      prefetchAdjacentBuckets(timestamp);

      // Reset programmatic scroll flag and navigation state after delay
      setTimeout(() => {
        isProgrammaticScrollRef.current = false;
        targetScrollTopRef.current = null;
        targetBucketRef.current = null;
        setIsNavigating(false);
      }, fromCache ? 100 : PROGRAMMATIC_SCROLL_WINDOW_MS); // Shorter delay if from cache
    } catch (error) {
      console.error('Failed to scroll to bucket:', error);
      setIsNavigating(false);
    }
  }, [virtualizer, items.length, buckets, bucketSizeMs, estimatedRowHeight, getCachedIndex, prefetchAdjacentBuckets]);

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

    // Store for drag end navigation
    currentDragBucketRef.current = timestamp;

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
    isNavigating,
  };
}

export default useTimelineNavigation;
