import { cn } from '../../lib/utils';

// Skeleton — Lumen: a warm sheen travelling over ink-100 (globals.css
// .lumen-skeleton), not a grey pulse. Under reduced motion it becomes a slow
// fade so loading still reads as loading.
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
	return <div aria-hidden className={cn('lumen-skeleton', className)} {...props} />;
}

export { Skeleton };
