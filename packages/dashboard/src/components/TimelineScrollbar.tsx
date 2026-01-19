/**
 * TimelineScrollbar - Project-specific wrapper
 *
 * This is a thin wrapper around the generic TimelineScrollbar component
 * that adapts it to the project's types (HourlyLogCount, LogTimeRange).
 */

import { memo } from 'react';
import type { HourlyLogCount, LogTimeRange } from '../lib/sqlite-db';
import {
  TimelineScrollbar as GenericTimelineScrollbar,
  type TimeBucketData,
  type TimeRange,
  type BucketPositionMap,
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
    />
  );
});
