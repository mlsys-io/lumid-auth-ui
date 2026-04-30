import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { cva, type VariantProps } from 'class-variance-authority';

const loadingVariants = cva('flex items-center justify-center', {
	variants: {
		size: {
			sm: 'gap-1.5',
			md: 'gap-2',
			lg: 'gap-3',
		},
		fullScreen: {
			true: 'fixed inset-0 z-50 bg-background/80 backdrop-blur-sm',
			false: '',
		},
	},
	defaultVariants: {
		size: 'md',
		fullScreen: false,
	},
});

const spinnerSizeClasses = {
	sm: 'w-4 h-4',
	md: 'w-8 h-8',
	lg: 'w-12 h-12',
};

const textSizeClasses = {
	sm: 'text-xs',
	md: 'text-sm',
	lg: 'text-base',
};

export interface LoadingProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof loadingVariants> {
	/**
	 * Loading text to display below the spinner
	 */
	text?: string;
	/**
	 * Whether to show full screen overlay
	 */
	fullScreen?: boolean;
	/**
	 * Size of the loading spinner
	 */
	size?: 'sm' | 'md' | 'lg';
	/**
	 * Custom spinner component (optional)
	 */
	spinner?: React.ReactNode;
}

/**
 * Loading component with multiple variants and sizes
 *
 * @example
 * ```tsx
 * // Basic usage
 * <Loading />
 *
 * // With text
 * <Loading text="Loading..." />
 *
 * // Full screen
 * <Loading fullScreen text="Loading data..." />
 *
 * // Small size
 * <Loading size="sm" text="Saving..." />
 * ```
 */
function Loading({ className, size = 'md', fullScreen = false, text, spinner, ...props }: LoadingProps) {
	return (
		<div
			className={cn(loadingVariants({ size, fullScreen }), !fullScreen && 'min-h-[200px]', className)}
			{...props}
		>
			<div className="flex flex-col items-center justify-center gap-2">
				{spinner || <Loader2 className={cn('animate-spin text-primary', spinnerSizeClasses[size || 'md'])} />}
				{text && <p className={cn('text-muted-foreground', textSizeClasses[size || 'md'])}>{text}</p>}
			</div>
		</div>
	);
}

/**
 * Simple spinner component (no container, just the spinner)
 */
function Spinner({ className, size = 'md' }: { className?: string; size?: 'sm' | 'md' | 'lg' }) {
	return <Loader2 className={cn('animate-spin text-primary', spinnerSizeClasses[size || 'md'], className)} />;
}

export { Loading, Spinner };
