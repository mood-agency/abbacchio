/**
 * Timeline Scrollbar Components
 *
 * A reusable timeline scrollbar for virtualized lists with time-based data.
 *
 * @example
 * ```tsx
 * import {
 *   TimelineScrollbar,
 *   useTimelineNavigation,
 *   type TimeBucketData,
 *   type TimeRange,
 * } from './components/timeline';
 *
 * function MyComponent() {
 *   const {
 *     thumbPosition,
 *     currentBucket,
 *     scrollToBucket,
 *     handleThumbDrag,
 *     isDragging,
 *     setIsDragging,
 *   } = useTimelineNavigation({
 *     items: logs,
 *     buckets: hourlyData,
 *     timeRange: logTimeRange,
 *     virtualizer: rowVirtualizer,
 *     scrollContainerRef,
 *     getIndexByTime: async (time) => getLogIndexByTime({ channel, targetTime: time }),
 *   });
 *
 *   return (
 *     <div className="flex">
 *       <VirtualizedList ... />
 *       <TimelineScrollbar
 *         buckets={hourlyData}
 *         timeRange={logTimeRange}
 *         thumbPosition={thumbPosition}
 *         currentBucket={currentBucket}
 *         onBucketClick={scrollToBucket}
 *         onThumbDrag={handleThumbDrag}
 *         isDragging={isDragging}
 *         onDragStart={() => setIsDragging(true)}
 *         onDragEnd={() => setIsDragging(false)}
 *       />
 *     </div>
 *   );
 * }
 * ```
 */

// Types
export type {
  TimeBucketData,
  TimeRange,
  TimelineItem,
  GetIndexByTimeFunction,
} from './types';

// Components
export {
  TimelineScrollbar,
  type TimelineScrollbarProps,
  type BucketPositionMap,
  type TimelineSizeConfig,
  type TimeDisplayFormat,
  type TimeDisplayMinutes,
  type TickInterval,
} from './TimelineScrollbar';

// Hooks
export {
  useTimelineNavigation,
  type UseTimelineNavigationOptions,
  type UseTimelineNavigationResult,
} from './useTimelineNavigation';
