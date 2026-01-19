/**
 * TimelineScrollbar Component
 *
 * A vertical scrollbar that displays time-based data with density bars.
 * Can be used with any virtualized list that has time-ordered items.
 *
 * Features:
 * - Displays time buckets (e.g., hours) with density bars
 * - Draggable thumb for navigation
 * - Click on time markers to navigate
 * - Bidirectional sync with scroll position
 * - Day separators when data spans multiple days
 *
 * @example
 * ```tsx
 * <TimelineScrollbar
 *   buckets={hourlyData}
 *   timeRange={logTimeRange}
 *   thumbPosition={thumbPosition}
 *   currentBucket={currentHour}
 *   onBucketClick={scrollToHour}
 *   onThumbDrag={handleThumbDrag}
 *   isDragging={isDragging}
 *   onDragStart={() => setIsDragging(true)}
 *   onDragEnd={() => setIsDragging(false)}
 * />
 * ```
 */

import { useRef, useCallback, useMemo, memo, useState, useLayoutEffect } from 'react';
import type { TimeBucketData, TimeRange } from './types';

// Utility function for combining class names (can be replaced with your own)
function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

/** Map of bucket timestamp to its center position (0-1) within the timeline */
export type BucketPositionMap = Map<number, number>;

export interface TimelineScrollbarProps {
  /** Array of time buckets with counts */
  buckets: TimeBucketData[];
  /** Time range of the data */
  timeRange: TimeRange;
  /** Current thumb position (0-1, where 0 = newest, 1 = oldest) */
  thumbPosition: number;
  /** Currently highlighted bucket timestamp, or null */
  currentBucket: number | null;
  /** Callback when a bucket is clicked */
  onBucketClick: (timestamp: number) => void;
  /** Callback when thumb is dragged (position 0-1) */
  onThumbDrag: (position: number) => void;
  /** Whether the thumb is currently being dragged */
  isDragging: boolean;
  /** Callback when drag starts */
  onDragStart: () => void;
  /** Callback when drag ends */
  onDragEnd: () => void;
  /** Optional: Custom time formatter (default: HH:MM) */
  formatTime?: (timestamp: number) => string;
  /** Optional: Custom date formatter for day separators (default: MMM DD) */
  formatDate?: (timestamp: number) => string;
  /** Optional: Custom class name for the container */
  className?: string;
  /** Optional: Width in pixels or CSS value (default: 80px / w-20) */
  width?: number | string;
  /** Optional: Callback when bucket positions are calculated, provides map of timestamp -> position (0-1) */
  onBucketPositionsChange?: (positions: BucketPositionMap) => void;
}

// Default time formatter (HH:MM in 24h format)
function defaultFormatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

// Default date formatter (MMM DD)
function defaultFormatDate(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// Check if two timestamps are on different days
function isDifferentDay(time1: number, time2: number): boolean {
  const date1 = new Date(time1);
  const date2 = new Date(time2);
  return date1.toDateString() !== date2.toDateString();
}

// Bucket marker component
const BucketMarker = memo(function BucketMarker({
  timestamp,
  count,
  maxCount,
  isCurrentBucket,
  showDate,
  onClick,
  formatTime,
  formatDate,
}: {
  timestamp: number;
  count: number;
  maxCount: number;
  isCurrentBucket: boolean;
  showDate: boolean;
  onClick: () => void;
  formatTime: (timestamp: number) => string;
  formatDate: (timestamp: number) => string;
}) {
  // Calculate density bar width as percentage of max
  const densityWidth = maxCount > 0 ? Math.max(4, (count / maxCount) * 100) : 0;

  return (
    <div className="flex flex-col">
      {showDate && (
        <div className="px-1 py-0.5 text-[9px] font-medium text-muted-foreground/70 bg-muted/50 border-b border-border/30">
          {formatDate(timestamp)}
        </div>
      )}
      <div
        data-hour-row
        className={cn(
          "flex items-center gap-0.5 px-1 h-5 cursor-pointer transition-colors",
          "hover:bg-muted/50",
          isCurrentBucket && "bg-primary/10"
        )}
        onClick={onClick}
      >
        <span className={cn(
          "text-[9px] tabular-nums w-9 flex-shrink-0",
          isCurrentBucket ? "text-primary font-medium" : "text-muted-foreground"
        )}>
          {formatTime(timestamp)}
        </span>
        <div className="flex-1 h-1.5 bg-muted/30 rounded-sm overflow-hidden">
          <div
            className={cn(
              "h-full rounded-sm transition-all",
              isCurrentBucket ? "bg-primary/60" : "bg-primary/40"
            )}
            style={{ width: `${densityWidth}%` }}
          />
        </div>
      </div>
    </div>
  );
});

export const TimelineScrollbar = memo(function TimelineScrollbar({
  buckets,
  timeRange,
  thumbPosition,
  currentBucket,
  onBucketClick,
  onThumbDrag,
  isDragging,
  onDragStart,
  onDragEnd,
  formatTime = defaultFormatTime,
  formatDate = defaultFormatDate,
  className,
  width = 80,
  onBucketPositionsChange,
}: TimelineScrollbarProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentWrapperRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);

  // Refs for each bucket element to measure their positions
  const bucketRefsMap = useRef<Map<number, HTMLDivElement>>(new Map());

  // Track actual content height for thumb positioning
  const [contentHeight, setContentHeight] = useState(0);

  // Sort buckets in descending order (newest first) - moved up so it's available for position calculation
  const sortedBuckets = useMemo(() => {
    return [...buckets].sort((a, b) => b.timestamp - a.timestamp);
  }, [buckets]);

  // Measure content height and bucket positions after render
  useLayoutEffect(() => {
    if (contentWrapperRef.current) {
      const totalHeight = contentWrapperRef.current.offsetHeight;
      setContentHeight(totalHeight);

      // Calculate center position for each bucket
      if (onBucketPositionsChange && totalHeight > 0) {
        const positions: BucketPositionMap = new Map();

        sortedBuckets.forEach((bucket) => {
          const element = bucketRefsMap.current.get(bucket.timestamp);
          if (element) {
            // Find the hour row element (not the date separator)
            const hourRow = element.querySelector('[data-hour-row]') as HTMLElement;
            if (hourRow) {
              const rowTop = hourRow.offsetTop;
              const rowHeight = hourRow.offsetHeight;
              const centerY = rowTop + rowHeight / 2;
              positions.set(bucket.timestamp, centerY / totalHeight);
            }
          }
        });

        onBucketPositionsChange(positions);
      }
    }
  }, [buckets, sortedBuckets, onBucketPositionsChange]);

  // Calculate max count for density bar scaling
  const maxCount = useMemo(() => {
    return Math.max(...buckets.map(b => b.count), 1);
  }, [buckets]);

  // Handle mouse/touch drag on thumb
  const handleDragStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    onDragStart();

    const container = containerRef.current;
    const contentWrapper = contentWrapperRef.current;
    if (!container || !contentWrapper) return;

    const handleMove = (moveEvent: MouseEvent | TouchEvent) => {
      const containerRect = container.getBoundingClientRect();
      const clientY = 'touches' in moveEvent
        ? moveEvent.touches[0].clientY
        : moveEvent.clientY;

      const relativeY = clientY - containerRect.top;
      // Use actual content height, not container scrollHeight
      const height = contentWrapper.offsetHeight;
      const position = (relativeY + container.scrollTop) / height;
      onThumbDrag(Math.max(0, Math.min(1, position)));
    };

    const handleEnd = () => {
      onDragEnd();
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleEnd);
      document.removeEventListener('touchmove', handleMove);
      document.removeEventListener('touchend', handleEnd);
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleEnd);
    document.addEventListener('touchmove', handleMove, { passive: false });
    document.addEventListener('touchend', handleEnd);
  }, [onDragStart, onDragEnd, onThumbDrag]);

  // Handle click on track (not on thumb or bucket marker)
  const handleTrackClick = useCallback((e: React.MouseEvent) => {
    const container = containerRef.current;
    const contentWrapper = contentWrapperRef.current;
    if (!container || !contentWrapper) return;

    // Don't handle if clicking on thumb
    if (thumbRef.current?.contains(e.target as Node)) return;

    const containerRect = container.getBoundingClientRect();
    const relativeY = e.clientY - containerRect.top;
    // Use actual content height, not container scrollHeight
    const height = contentWrapper.offsetHeight;
    const position = (relativeY + container.scrollTop) / height;
    onThumbDrag(Math.max(0, Math.min(1, position)));
  }, [onThumbDrag]);

  // Don't render if no data or no time range
  if (sortedBuckets.length === 0 || !timeRange.minTime || !timeRange.maxTime) {
    return null;
  }

  // Calculate thumb position as pixel offset within the content
  const thumbTopPx = contentHeight > 0 ? thumbPosition * contentHeight : 0;

  // Calculate width style
  const widthStyle = typeof width === 'number' ? `${width}px` : width;

  return (
    <div
      className={cn(
        "flex-shrink-0 border-l border-border bg-muted/10 flex flex-col select-none",
        className
      )}
      style={{ width: widthStyle }}
    >
      {/* Bucket markers container */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto scrollbar-hide relative"
        onClick={handleTrackClick}
      >
        {/* Content wrapper for positioning */}
        <div ref={contentWrapperRef} className="relative">
          {sortedBuckets.map((bucket, index) => {
            const prevBucket = sortedBuckets[index - 1];
            const showDate = index === 0 || (prevBucket && isDifferentDay(bucket.timestamp, prevBucket.timestamp));

            return (
              <div
                key={bucket.timestamp}
                ref={(el) => {
                  if (el) {
                    bucketRefsMap.current.set(bucket.timestamp, el);
                  } else {
                    bucketRefsMap.current.delete(bucket.timestamp);
                  }
                }}
              >
                <BucketMarker
                  timestamp={bucket.timestamp}
                  count={bucket.count}
                  maxCount={maxCount}
                  isCurrentBucket={currentBucket === bucket.timestamp}
                  showDate={showDate}
                  onClick={() => onBucketClick(bucket.timestamp)}
                  formatTime={formatTime}
                  formatDate={formatDate}
                />
              </div>
            );
          })}

          {/* Draggable thumb - arrow pointing left */}
          <div
            ref={thumbRef}
            className={cn(
              "absolute right-0 z-10 cursor-grab transition-colors",
              isDragging && "cursor-grabbing"
            )}
            style={{
              top: `${thumbTopPx}px`,
              transform: 'translateY(-50%)',
            }}
            onMouseDown={handleDragStart}
            onTouchStart={handleDragStart}
          >
            {/* Arrow shape pointing left */}
            <svg
              width="10"
              height="14"
              viewBox="0 0 10 14"
              className={cn(
                "transition-colors",
                isDragging ? "fill-primary" : "fill-primary/80"
              )}
            >
              <path d="M10 0 L10 14 L0 7 Z" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
});

export default TimelineScrollbar;
