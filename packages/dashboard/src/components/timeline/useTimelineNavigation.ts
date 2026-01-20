/**
 * useTimelineNavigation Hook
 *
 * Provides one-way synchronization: timeline controls the table scroll position.
 * Table scroll does NOT update the timeline position.
 *
 * Features:
 * - Timeline click navigates to specific bucket
 * - Thumb drag navigates table with debounced scroll
 * - Immediate visual feedback during drag
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

// Debounce delay for drag scroll updates (~60fps)
const DRAG_SCROLL_DEBOUNCE_MS = 16;

// Time window to ignore updates after programmatic scroll
const PROGRAMMATIC_SCROLL_WINDOW_MS = 300;

// Debug logging - set to true to enable
const DEBUG = true;
const log = (...args: unknown[]) => {
  if (DEBUG) console.log('[Timeline]', ...args);
};

// Number of adjacent buckets to pre-cache (before and after current)
const PREFETCH_ADJACENT_BUCKETS = 2;

// Cache entry with timestamp for invalidation
interface CacheEntry {
  index: number;
  itemsLength: number; // To invalidate when items change
  loadedAt: number; // Timestamp when cached, for TTL
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
  /** Timestamp of the bucket currently selected */
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
    virtualizer,
    getIndexByTime,
    bucketSizeMs = DEFAULT_BUCKET_SIZE_MS,
    estimatedRowHeight = 36,
  } = options;

  const [thumbPosition, setThumbPosition] = useState(0);
  const [currentBucket, setCurrentBucket] = useState<number | null>(null);
  const [isDraggingInternal, setIsDraggingInternal] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);

  // Wrapper to log dragging state changes
  const setIsDragging = useCallback((value: boolean) => {
    log('setIsDragging:', value);
    setIsDraggingInternal(value);
  }, []);
  const isDragging = isDraggingInternal;

  // Track previous dragging state for snap-on-release
  const prevIsDraggingRef = useRef(false);

  // Store bucket positions from TimelineScrollbar for accurate snap positioning
  const bucketPositionsRef = useRef<BucketPositionMap>(new Map());

  // Callback to update bucket positions (just store them, no auto-sync)
  const setBucketPositions = useCallback((positions: BucketPositionMap) => {
    bucketPositionsRef.current = positions;
  }, []);

  // Store the target bucket for re-navigation after data changes
  const targetBucketRef = useRef<number | null>(null);

  // Debounce ref for drag scroll updates
  const dragScrollDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track last bucket click to prevent duplicate navigations
  const lastBucketClickRef = useRef<{ timestamp: number; time: number } | null>(null);

  // Track ongoing navigation to prevent concurrent navigations to the same bucket
  const pendingNavigationRef = useRef<number | null>(null);

  // Track current drag bucket to navigate on drag end
  const currentDragBucketRef = useRef<number | null>(null);

  // Track current bucket for comparison without causing re-renders
  const currentBucketRef = useRef<number | null>(null);

  // Cache for bucket index lookups (bucket timestamp -> index)
  const indexCacheRef = useRef<Map<number, CacheEntry>>(new Map());

  // Track last scrolled bucket during drag to avoid duplicate calls
  const lastDragScrolledBucketRef = useRef<number | null>(null);

  // Get cached index or fetch it
  const getCachedIndex = useCallback(async (bucketTimestamp: number): Promise<{ index: number; fromCache: boolean }> => {
    const cache = indexCacheRef.current;
    const cached = cache.get(bucketTimestamp);
    const now = Date.now();

    // Cache is valid if:
    // 1. Items length is exactly the same (data hasn't changed)
    // 2. Cache is less than 5 seconds old (TTL)
    const isCacheValid = cached &&
      cached.itemsLength === items.length &&
      (now - cached.loadedAt) < 5000;

    if (isCacheValid) {
      log('getCachedIndex: cache HIT for', new Date(bucketTimestamp).toISOString(), 'index:', cached.index);
      return { index: cached.index, fromCache: true };
    }

    log('getCachedIndex: cache MISS for', new Date(bucketTimestamp).toISOString(),
      cached ? `(stale: itemsLen ${cached.itemsLength} vs ${items.length}, age ${now - cached.loadedAt}ms)` : '(no entry)');

    // Fetch the index - use center of bucket for more consistent results
    const targetTime = bucketTimestamp + Math.floor(bucketSizeMs / 2);
    const index = await getIndexByTime(targetTime);

    // Store in cache with current timestamp
    cache.set(bucketTimestamp, { index, itemsLength: items.length, loadedAt: now });

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
    const now = Date.now();
    adjacentTimestamps.forEach(timestamp => {
      const cached = indexCacheRef.current.get(timestamp);
      const isCacheValid = cached &&
        cached.itemsLength === items.length &&
        (now - cached.loadedAt) < 5000;

      if (!isCacheValid) {
        // Not cached or stale, fetch it - use center of bucket
        const targetTime = timestamp + Math.floor(bucketSizeMs / 2);
        getIndexByTime(targetTime).then(index => {
          indexCacheRef.current.set(timestamp, { index, itemsLength: items.length, loadedAt: Date.now() });
        }).catch(() => {
          // Silently ignore prefetch errors
        });
      }
    });
  }, [buckets, items.length, bucketSizeMs, getIndexByTime]);

  // Snap thumb to current bucket when drag ends and navigate immediately
  useEffect(() => {
    // Detect drag end: was dragging, now not dragging
    if (prevIsDraggingRef.current && !isDragging) {
      log('DRAG END');

      // Reset the last scrolled bucket ref for next drag session
      lastDragScrolledBucketRef.current = null;

      // Cancel any pending debounced scrolls
      if (dragScrollDebounceRef.current) {
        clearTimeout(dragScrollDebounceRef.current);
        dragScrollDebounceRef.current = null;
      }

      // Use refs to get current values without adding them as dependencies
      const bucket = currentBucketRef.current;

      if (bucket !== null) {
        // Use real bucket position from TimelineScrollbar if available
        const realPosition = bucketPositionsRef.current.get(bucket);
        if (realPosition !== undefined) {
          setThumbPosition(Math.max(0, Math.min(1, realPosition)));
        } else if (buckets.length > 0) {
          // Fallback to calculated position if real positions not available
          const bucketIndex = findBucketIndex(buckets, bucket);
          if (bucketIndex >= 0) {
            const snappedPosition = (bucketIndex + 0.5) / buckets.length;
            setThumbPosition(Math.max(0, Math.min(1, snappedPosition)));
          }
        }
      }

      // Navigate immediately to the final drag position
      const targetBucket = currentDragBucketRef.current;
      log('DRAG END: targetBucket=', targetBucket ? new Date(targetBucket).toISOString() : null);
      if (targetBucket !== null && virtualizer) {
        // Use cache if available
        getCachedIndex(targetBucket)
          .then(({ index, fromCache }) => {
            log('DRAG END: got index', index, 'fromCache:', fromCache);
            // Only show loading if not from cache
            if (!fromCache) {
              setIsNavigating(true);
            }

            const clampedIndex = Math.max(0, Math.min(index, items.length - 1));

            // Use requestAnimationFrame to avoid flushSync issues with virtualizer
            requestAnimationFrame(() => {
              if (!virtualizer) return;
              log('DRAG END: scrolling to index', clampedIndex);
              virtualizer.scrollToIndex(clampedIndex, {
                align: 'start',
                behavior: 'auto',
              });
            });

            // Pre-fetch adjacent buckets
            prefetchAdjacentBuckets(targetBucket);

            return fromCache;
          })
          .then(() => {
            // Reset navigation state after navigation completes
            setTimeout(() => {
              setIsNavigating(false);
            }, PROGRAMMATIC_SCROLL_WINDOW_MS);
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
  }, [isDragging, buckets, virtualizer, items.length, getCachedIndex, prefetchAdjacentBuckets]);

  // Track previous items length to detect when data is reloaded
  const prevItemsLengthRef = useRef(0);

  // Ref to hold latest virtualizer to avoid dependency issues
  const virtualizerRef = useRef(virtualizer);
  useEffect(() => {
    virtualizerRef.current = virtualizer;
  }, [virtualizer]);

  // Handle data changes - re-sync thumb position after data reload
  // NOTE: We do NOT call getIndexByTime here because that can trigger another data load,
  // causing an infinite loop. The initial scrollToBucket already handles navigation.
  // This effect only re-syncs the thumb position with new bucket positions.
  useEffect(() => {
    const prevLength = prevItemsLengthRef.current;
    const lengthDiff = Math.abs(items.length - prevLength);
    const wasSignificantReload = prevLength > 0 && items.length > 0 && lengthDiff > 100;
    prevItemsLengthRef.current = items.length;

    log('DATA EFFECT: items', items.length, 'prevLength', prevLength, 'wasSignificantReload', wasSignificantReload);

    // If we have a target bucket and data reloaded significantly, re-sync the thumb position
    // but do NOT call getIndexByTime as it may trigger another data load
    if (targetBucketRef.current !== null && wasSignificantReload) {
      const targetBucket = targetBucketRef.current;

      // Re-sync the thumb position after data reload
      setTimeout(() => {
        const positions = bucketPositionsRef.current;
        const realPosition = positions.get(targetBucket);
        log('DATA EFFECT: re-syncing thumb after reload, bucket:', new Date(targetBucket).toISOString(), 'position:', realPosition);
        if (realPosition !== undefined) {
          setThumbPosition(Math.max(0, Math.min(1, realPosition)));
        }
      }, 100);
    }
  }, [items.length, bucketSizeMs]);

  // Scroll to a specific bucket
  const scrollToBucket = useCallback(async (timestamp: number) => {
    if (!virtualizer || items.length === 0) {
      return;
    }

    log('scrollToBucket:', new Date(timestamp).toISOString());

    // Prevent concurrent navigations to the same bucket
    if (pendingNavigationRef.current === timestamp) {
      log('scrollToBucket: BLOCKED (already navigating to this bucket)');
      return;
    }

    // Prevent duplicate navigations to the same bucket within 1000ms
    const now = Date.now();
    if (lastBucketClickRef.current &&
        lastBucketClickRef.current.timestamp === timestamp &&
        now - lastBucketClickRef.current.time < 1000) {
      log('scrollToBucket: BLOCKED (duplicate within 1s)');
      return;
    }
    lastBucketClickRef.current = { timestamp, time: now };

    // Mark this bucket as pending navigation
    pendingNavigationRef.current = timestamp;

    // Update current bucket immediately for visual feedback
    currentBucketRef.current = timestamp;
    setCurrentBucket(timestamp);

    // Store target bucket for re-navigation after data changes
    targetBucketRef.current = timestamp;

    // Calculate thumb position immediately
    if (buckets.length > 0) {
      const bucketIndex = findBucketIndex(buckets, timestamp);
      if (bucketIndex >= 0) {
        const position = (bucketIndex + 0.5) / buckets.length;
        setThumbPosition(Math.max(0, Math.min(1, position)));
      }
    }

    try {
      // Try to get from cache first
      const { index, fromCache } = await getCachedIndex(timestamp);
      log('scrollToBucket: got index', index, 'fromCache:', fromCache, 'items.length:', items.length);

      // Only show loading if not from cache
      if (!fromCache) {
        setIsNavigating(true);
      }

      // Clamp index to current items length
      const clampedIndex = Math.max(0, Math.min(index, items.length - 1));

      // Scroll to index using requestAnimationFrame to avoid flushSync issues
      requestAnimationFrame(() => {
        if (!virtualizer) return;
        virtualizer.scrollToIndex(clampedIndex, {
          align: 'start',
          behavior: 'auto',
        });
      });

      // Pre-fetch adjacent buckets in background
      prefetchAdjacentBuckets(timestamp);

      // Clear navigation state after delay
      setTimeout(() => {
        log('scrollToBucket: clearing pending navigation');
        if (pendingNavigationRef.current === timestamp) {
          pendingNavigationRef.current = null;
        }
        targetBucketRef.current = null;
        setIsNavigating(false);
      }, fromCache ? 100 : PROGRAMMATIC_SCROLL_WINDOW_MS + 500);
    } catch (error) {
      console.error('Failed to scroll to bucket:', error);
      pendingNavigationRef.current = null;
      setIsNavigating(false);
    }
  }, [virtualizer, items.length, buckets, getCachedIndex, prefetchAdjacentBuckets]);

  // Handle thumb drag
  const handleThumbDrag = useCallback((position: number) => {
    if (items.length === 0 || buckets.length === 0) {
      return;
    }

    log('DRAG: position', position.toFixed(3));

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
    log('DRAG: bucket changed to', new Date(timestamp).toISOString());
    currentBucketRef.current = timestamp;
    setCurrentBucket(timestamp);

    // Store for drag end navigation
    currentDragBucketRef.current = timestamp;

    // Skip scroll if bucket hasn't changed (avoid duplicate API calls)
    if (timestamp === lastDragScrolledBucketRef.current) {
      log('DRAG: skip scroll, same bucket');
      return;
    }

    // DEBOUNCED: Scroll item view - only when bucket changes
    if (dragScrollDebounceRef.current) {
      clearTimeout(dragScrollDebounceRef.current);
    }

    dragScrollDebounceRef.current = setTimeout(async () => {
      if (!virtualizer) return;

      // Double-check bucket hasn't been scrolled to already
      if (timestamp === lastDragScrolledBucketRef.current) {
        log('DRAG (debounced): skip, already scrolled');
        return;
      }
      lastDragScrolledBucketRef.current = timestamp;

      try {
        // Use cached index to avoid redundant API calls
        const { index } = await getCachedIndex(timestamp);
        const clampedIndex = Math.max(0, Math.min(index, items.length - 1));
        log('DRAG (debounced): scrolling to index', clampedIndex, 'for bucket', new Date(timestamp).toISOString());

        // Use requestAnimationFrame to avoid flushSync issues with virtualizer
        requestAnimationFrame(() => {
          if (!virtualizer) return;
          virtualizer.scrollToIndex(clampedIndex, {
            align: 'start',
            behavior: 'auto',
          });
        });
      } catch (error) {
        console.error('Failed to scroll during drag:', error);
      }
    }, DRAG_SCROLL_DEBOUNCE_MS);
  }, [virtualizer, items, buckets, getCachedIndex]);

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
