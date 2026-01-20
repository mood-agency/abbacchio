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

/** Size configuration for timeline elements */
export interface TimelineSizeConfig {
  /** Height of each hour/bucket row in pixels (default: 14) */
  bucketHeight?: number;
  /** Font size for hour text in pixels (default: 9) */
  bucketFontSize?: number;
  /** Height of day separator in pixels (default: 16) */
  dateSeparatorHeight?: number;
  /** Font size for date separator text in pixels (default: 9) */
  dateSeparatorFontSize?: number;
  /** Width of density bar in pixels (default: 20) */
  densityBarWidth?: number;
  /** Height of density bar in pixels (default: 6) */
  densityBarHeight?: number;
}

/** Time display format options */
export type TimeDisplayFormat = '24h' | '12h';

/** Whether to show minutes in time display */
export type TimeDisplayMinutes = 'show' | 'hide';

/** Tick interval options in milliseconds */
export type TickInterval = 'hour' | 'half-hour' | '15min' | '5min';

// Tick interval values in milliseconds
const TICK_INTERVALS: Record<TickInterval, number> = {
  'hour': 60 * 60 * 1000,
  'half-hour': 30 * 60 * 1000,
  '15min': 15 * 60 * 1000,
  '5min': 5 * 60 * 1000,
};

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
  /** Optional: Custom time formatter (overrides timeFormat if provided) */
  formatTime?: (timestamp: number) => string;
  /** Optional: Custom date formatter for day separators (default: MMM DD) */
  formatDate?: (timestamp: number) => string;
  /** Optional: Custom class name for the container */
  className?: string;
  /** Optional: Width in pixels or CSS value (default: 80px / w-20) */
  width?: number | string;
  /** Optional: Callback when bucket positions are calculated, provides map of timestamp -> position (0-1) */
  onBucketPositionsChange?: (positions: BucketPositionMap) => void;
  /** Optional: Size configuration for timeline elements */
  sizes?: TimelineSizeConfig;
  /** Optional: Whether to show the time label (default: true) */
  showTime?: boolean;
  /** Optional: Time display format - 24h or 12h (default: '24h') */
  timeFormat?: TimeDisplayFormat;
  /** Optional: Whether to show minutes in time display (default: 'show') */
  showMinutes?: TimeDisplayMinutes;
  /** Optional: Tick interval - how often to show time markers (default: 'hour') */
  tickInterval?: TickInterval;
}

// Create time formatter based on format and minutes options
function createTimeFormatter(format: TimeDisplayFormat, showMinutes: TimeDisplayMinutes): (timestamp: number) => string {
  return (timestamp: number) => {
    const date = new Date(timestamp);

    if (showMinutes === 'hide') {
      // Show only hour
      const hour = date.getHours();
      if (format === '12h') {
        const hour12 = hour % 12 || 12;
        const ampm = hour < 12 ? 'AM' : 'PM';
        return `${hour12} ${ampm}`;
      }
      return `${hour.toString().padStart(2, '0')}`;
    }

    return date.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      hour12: format === '12h'
    });
  };
}

// Default date formatter (MMM DD)
function defaultFormatDate(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// Full datetime formatter for tooltip (e.g., "Jan 15, 2024 14:30")
function formatFullDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  const dateStr = date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
  const timeStr = date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  return `${dateStr} ${timeStr}`;
}

// Check if two timestamps are on different days
function isDifferentDay(time1: number, time2: number): boolean {
  const date1 = new Date(time1);
  const date2 = new Date(time2);
  return date1.toDateString() !== date2.toDateString();
}

// Default size values
const DEFAULT_SIZES: Required<TimelineSizeConfig> = {
  bucketHeight: 14,
  bucketFontSize: 9,
  dateSeparatorHeight: 16,
  dateSeparatorFontSize: 9,
  densityBarWidth: 20,
  densityBarHeight: 6,
};

// Bucket marker component
const BucketMarker = memo(function BucketMarker({
  timestamp,
  count,
  maxCount,
  isCurrentBucket,
  showDate,
  showTime,
  formatTime,
  formatDate,
  sizes,
}: {
  timestamp: number;
  count: number;
  maxCount: number;
  isCurrentBucket: boolean;
  showDate: boolean;
  showTime: boolean;
  formatTime: (timestamp: number) => string;
  formatDate: (timestamp: number) => string;
  sizes: Required<TimelineSizeConfig>;
}) {
  // Calculate density bar width as percentage of max
  const densityWidth = maxCount > 0 ? Math.max(4, (count / maxCount) * 100) : 0;

  return (
    <div className="flex flex-col">
      {showDate && (
        <div
          className="pr-3 pl-1 font-medium text-muted-foreground/50 border-b border-border/20 text-right flex items-center justify-end"
          style={{
            height: `${sizes.dateSeparatorHeight}px`,
            fontSize: `${sizes.dateSeparatorFontSize}px`,
          }}
        >
          {formatDate(timestamp)}
        </div>
      )}
      <div
        data-hour-row
        className={cn(
          "flex items-center justify-end gap-1 pr-3 pl-1 cursor-pointer transition-colors",
          "hover:bg-muted/50",
          isCurrentBucket && "bg-primary/10"
        )}
        style={{ height: `${sizes.bucketHeight}px` }}
      >
        <div
          className="overflow-hidden flex-shrink-0 flex justify-end"
          style={{
            width: `${sizes.densityBarWidth}px`,
            height: `${sizes.densityBarHeight}px`,
          }}
        >
          <div
            className={cn(
              "h-full transition-all",
              isCurrentBucket ? "bg-primary/40" : "bg-primary/20"
            )}
            style={{ width: `${densityWidth}%` }}
          />
        </div>
        {showTime && (
          <span
            className={cn(
              "tabular-nums flex-shrink-0 text-right",
              isCurrentBucket ? "text-primary font-medium" : "text-muted-foreground"
            )}
            style={{ fontSize: `${sizes.bucketFontSize}px` }}
          >
            {formatTime(timestamp)}
          </span>
        )}
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
  formatTime: formatTimeProp,
  formatDate = defaultFormatDate,
  className,
  width = 80,
  onBucketPositionsChange,
  sizes: sizesProp,
  showTime = true,
  timeFormat = '24h',
  showMinutes = 'show',
  tickInterval = 'hour',
}: TimelineScrollbarProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentWrapperRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);

  // Refs for each bucket element to measure their positions
  const bucketRefsMap = useRef<Map<number, HTMLDivElement>>(new Map());

  // Track actual content height for thumb positioning
  const [contentHeight, setContentHeight] = useState(0);

  // Track hover state for thumb tooltip
  const [isThumbHovered, setIsThumbHovered] = useState(false);

  // Create time formatter - use custom if provided, otherwise create based on format
  const formatTime = useMemo(() => {
    return formatTimeProp ?? createTimeFormatter(timeFormat, showMinutes);
  }, [formatTimeProp, timeFormat, showMinutes]);

  // Get tick interval in milliseconds
  const tickIntervalMs = TICK_INTERVALS[tickInterval];

  // Merge sizes with defaults
  const sizes = useMemo(() => ({
    ...DEFAULT_SIZES,
    ...sizesProp,
  }), [sizesProp]);

  // Sort and filter buckets based on tick interval
  const sortedBuckets = useMemo(() => {
    const sorted = [...buckets].sort((a, b) => b.timestamp - a.timestamp);

    // Filter buckets to only show those that align with the tick interval
    if (tickIntervalMs === TICK_INTERVALS['hour']) {
      // For hour ticks, show all buckets (they should already be hourly)
      return sorted;
    }

    // For other intervals, filter to show only aligned ticks
    return sorted.filter(bucket => {
      const date = new Date(bucket.timestamp);
      const minutes = date.getMinutes();
      const tickMinutes = tickIntervalMs / (60 * 1000);
      return minutes % tickMinutes === 0;
    });
  }, [buckets, tickIntervalMs]);

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

  // Handle mousedown on track - starts drag from any position
  const handleTrackMouseDown = useCallback((e: React.MouseEvent) => {
    const container = containerRef.current;
    const contentWrapper = contentWrapperRef.current;
    if (!container || !contentWrapper) return;

    // Don't handle if clicking on thumb (it has its own handler)
    if (thumbRef.current?.contains(e.target as Node)) return;

    e.preventDefault();

    const startY = e.clientY;
    let hasMoved = false;
    let dragStarted = false;

    // Immediately move thumb to click position
    const containerRect = container.getBoundingClientRect();
    const relativeY = e.clientY - containerRect.top;
    const height = contentWrapper.offsetHeight;
    const position = (relativeY + container.scrollTop) / height;

    // Continue with drag
    const handleMove = (moveEvent: MouseEvent) => {
      // Only start drag if mouse moved more than 3px (to distinguish from click)
      if (!hasMoved && Math.abs(moveEvent.clientY - startY) > 3) {
        hasMoved = true;
        dragStarted = true;
        onDragStart();
        // Move thumb to initial position when drag starts
        onThumbDrag(Math.max(0, Math.min(1, position)));
      }

      if (hasMoved) {
        const rect = container.getBoundingClientRect();
        const y = moveEvent.clientY - rect.top;
        const h = contentWrapper.offsetHeight;
        const pos = (y + container.scrollTop) / h;
        onThumbDrag(Math.max(0, Math.min(1, pos)));
      }
    };

    const handleEnd = () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleEnd);

      if (dragStarted) {
        // End drag
        onDragEnd();
      } else {
        // It was a click, not a drag - find which bucket was clicked
        const target = e.target as HTMLElement;
        const hourRow = target.closest('[data-hour-row]');
        if (hourRow) {
          // Find the bucket timestamp from the row
          const bucketWrapper = hourRow.closest('[data-bucket-timestamp]');
          if (bucketWrapper) {
            const timestamp = Number(bucketWrapper.getAttribute('data-bucket-timestamp'));
            if (!isNaN(timestamp)) {
              onBucketClick(timestamp);
            }
          }
        }
      }
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleEnd);
  }, [onDragStart, onDragEnd, onThumbDrag, onBucketClick]);

  // Don't render if no data or no time range
  if (sortedBuckets.length === 0 || !timeRange.minTime || !timeRange.maxTime) {
    return null;
  }

  // Calculate thumb position as pixel offset within the content
  const thumbTopPx = contentHeight > 0 ? thumbPosition * contentHeight : 0;

  // Calculate width style
  const widthStyle = typeof width === 'number' ? `${width}px` : width;

  // Calculate tooltip position relative to the main container
  // We need to account for scroll position within the bucket container
  const getTooltipTop = () => {
    if (!containerRef.current) return thumbTopPx;
    return thumbTopPx - containerRef.current.scrollTop;
  };

  return (
    <div
      className={cn(
        "flex-shrink-0 border-l border-border bg-muted/10 flex flex-col select-none relative",
        className
      )}
      style={{ width: widthStyle }}
    >
      {/* Tooltip - rendered outside the overflow container */}
      {(isDragging || isThumbHovered) && currentBucket !== null && (
        <div
          className="absolute right-full mr-1 px-2 py-1 bg-popover border border-border rounded shadow-md whitespace-nowrap text-xs font-mono text-foreground pointer-events-none z-50"
          style={{
            top: `${getTooltipTop()}px`,
            transform: 'translateY(-50%)',
          }}
        >
          {formatFullDateTime(currentBucket)}
        </div>
      )}

      {/* Bucket markers container */}
      <div
        ref={containerRef}
        className={cn(
          "flex-1 overflow-y-auto scrollbar-hide relative",
          isDragging && "cursor-grabbing"
        )}
        onMouseDown={handleTrackMouseDown}
      >
        {/* Content wrapper for positioning */}
        <div ref={contentWrapperRef} className="relative">
          {sortedBuckets.map((bucket, index) => {
            const prevBucket = sortedBuckets[index - 1];
            const showDate = index === 0 || (prevBucket && isDifferentDay(bucket.timestamp, prevBucket.timestamp));

            return (
              <div
                key={bucket.timestamp}
                data-bucket-timestamp={bucket.timestamp}
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
                  showTime={showTime}
                  formatTime={formatTime}
                  formatDate={formatDate}
                  sizes={sizes}
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
            onMouseEnter={() => setIsThumbHovered(true)}
            onMouseLeave={() => setIsThumbHovered(false)}
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
