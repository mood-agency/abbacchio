import * as React from 'react';
import { cn } from '@/lib/utils';

interface SidebarProps extends React.HTMLAttributes<HTMLDivElement> {
  collapsed?: boolean;
}

const Sidebar = React.forwardRef<HTMLDivElement, SidebarProps>(
  ({ className, collapsed = false, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex flex-col h-full border-r border-border bg-background transition-all duration-200',
        collapsed ? 'w-12' : 'w-56',
        className
      )}
      {...props}
    />
  )
);
Sidebar.displayName = 'Sidebar';

const SidebarHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('flex items-center px-3 py-2 border-b border-border', className)}
    {...props}
  />
));
SidebarHeader.displayName = 'SidebarHeader';

const SidebarContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('flex-1 overflow-auto py-2', className)}
    {...props}
  />
));
SidebarContent.displayName = 'SidebarContent';

const SidebarSection = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('px-2 py-1', className)}
    {...props}
  />
));
SidebarSection.displayName = 'SidebarSection';

const SidebarSectionTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn(
      'px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider',
      className
    )}
    {...props}
  />
));
SidebarSectionTitle.displayName = 'SidebarSectionTitle';

interface SidebarItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
}

const SidebarItem = React.forwardRef<HTMLButtonElement, SidebarItemProps>(
  ({ className, active, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        'flex items-center justify-between w-full px-2 py-1.5 text-sm rounded-md transition-colors',
        'hover:bg-muted',
        active && 'bg-background shadow-sm border border-border',
        className
      )}
      {...props}
    />
  )
);
SidebarItem.displayName = 'SidebarItem';

const SidebarFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('mt-auto px-3 py-2 border-t border-border', className)}
    {...props}
  />
));
SidebarFooter.displayName = 'SidebarFooter';

export {
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarSection,
  SidebarSectionTitle,
  SidebarItem,
  SidebarFooter,
};
