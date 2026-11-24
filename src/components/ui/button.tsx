import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

// Button — Lumen. Token-driven: ink primary, bronze accent, paper secondary.
//
// Until 2026-11 every variant was hardcoded indigo, so Studio never used this
// and hand-rolled ~180 raw <button>s instead. The legacy variant names are
// kept as ALIASES so the 60 existing callers (account, admin, super-admin,
// gpu-rentals, alert-dialog's buttonVariants()) compile and restyle in place:
//   default -> primary, outline -> secondary, size default -> md.
// QuantArena keeps its own copy (src/quantarena/components/ui/button.tsx).

const PRIMARY = 'bg-primary text-primary-foreground shadow-e1 hover:bg-ink-800 active:bg-ink-950';
const SECONDARY = 'border border-border bg-card text-foreground shadow-e1 hover:bg-ink-50 hover:border-ink-300';

const buttonVariants = cva(
	"lumen-press inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md text-body font-medium transition-[color,background-color,border-color,box-shadow,transform] duration-120 ease-lumen disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-destructive/25 aria-[invalid=true]:border-destructive",
	{
		variants: {
			variant: {
				primary: PRIMARY,
				default: PRIMARY,
				// Bronze — brand moments only (one per view, e.g. "Install").
				// gold-700: white on gold-600 is only 3.9:1 (scripts/check-contrast.mjs).
				accent: 'bg-gold-700 text-white shadow-e1 hover:bg-gold-800 active:bg-gold-900',
				secondary: SECONDARY,
				outline: SECONDARY,
				ghost: 'text-ink-700 hover:bg-ink-100 hover:text-ink-900',
				destructive: 'bg-brick-600 text-white shadow-e1 hover:bg-brick-700 focus-visible:ring-brick-500/40',
				link: 'h-auto px-0 text-gold-700 underline-offset-4 hover:text-gold-800 hover:underline',
			},
			size: {
				sm: 'h-8 rounded-md gap-1.5 px-3 text-meta has-[>svg]:px-2.5',
				md: 'h-9 px-4 has-[>svg]:px-3',
				default: 'h-9 px-4 has-[>svg]:px-3',
				lg: 'h-10 rounded-md px-5 has-[>svg]:px-4',
				icon: 'size-9 rounded-md',
				'icon-sm': 'size-8 rounded-md',
			},
		},
		defaultVariants: {
			variant: 'primary',
			size: 'md',
		},
	}
);

const Button = React.forwardRef<
	HTMLButtonElement,
	React.ComponentProps<'button'> &
		VariantProps<typeof buttonVariants> & {
			asChild?: boolean;
		}
>(({ className, variant, size, asChild = false, ...props }, ref) => {
	const Comp = asChild ? Slot : 'button';

	return (
		<Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
	);
});
Button.displayName = 'Button';

export { Button, buttonVariants };
