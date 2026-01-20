/**
 * TimelineScrollbar - Project-specific wrapper
 *
 * This is a thin wrapper around the generic TimelineScrollbar component
 * that adapts it to the project's types (HourlyLogCount, LogTimeRange).
 */

import { memo } from 'react';
import type { HourlyLogCount, LogTimeRange } from '../lib/sqlite-db';
import type { LoadedTimeRange } from '../hooks/useChannelLogStream';
import {
  TimelineScrollbar as GenericTimelineScrollbar,
  type TimeBucketData,
  type TimeRange,
  type BucketPositionMap,
  type TimelineSizeConfig,
  type TimeDisplayFormat,
  type TimeDisplayMinutes,
  type TickInterval,
} from './timeline';

export interface TimelineScrollbarProps {
  hourlyData: HourlyLogCount[];
  logTimeRange: LogTimeRange;
  thumbPosition: number;
  currentHour: number | null;
  onHourClick: (hour: number) => void;
  onThumbDrag: (position: number) => void;
  isDragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onHourPositionsChange?: (positions: BucketPositionMap) => void;
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
  /** Optional: Currently loaded time window for visual feedback */
  loadedTimeRange?: LoadedTimeRange | null;
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

// Convert LoadedTimeRange to generic format
function toLoadedRange(range: LoadedTimeRange | null | undefined): { start: number; end: number } | undefined {
  return range ? { start: range.start, end: range.end } : undefined;
}

export const TimelineScrollbar = memo(function TimelineScrollbar({
  hourlyData,
  logTimeRange,
  thumbPosition,
  currentHour,
  onHourClick,
  onThumbDrag,
  isDragging,
  onDragStart,
  onDragEnd,
  onHourPositionsChange,
  sizes,
  showTime = true,
  timeFormat = '24h',
  showMinutes = 'hide',
  tickInterval = 'hour',
  loadedTimeRange,
}: TimelineScrollbarProps) {
  return (
    <GenericTimelineScrollbar
      buckets={toTimeBucketData(hourlyData)}
      timeRange={toTimeRange(logTimeRange)}
      thumbPosition={thumbPosition}
      currentBucket={currentHour}
      onBucketClick={onHourClick}
      onThumbDrag={onThumbDrag}
      isDragging={isDragging}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      width={80}
      onBucketPositionsChange={onHourPositionsChange}
      sizes={sizes}
      showTime={showTime}
      timeFormat={timeFormat}
      showMinutes={showMinutes}
      tickInterval={tickInterval}
      loadedRange={toLoadedRange(loadedTimeRange)}
    />
  );
});
