import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

// Badge — Lumen. `default`, `secondary`, `destructive`, `outline` keep their
// names (LQT's KillSwitchIndicator layers its own colour over `outline`); the
// tone variants mirror src/lib/tones.ts. Text sits on the 700 step, which
// scripts/check-contrast.mjs holds at >= 4.5:1 on the 50 tint.
const badgeVariants = cva(
	'inline-flex items-center justify-center rounded-full border px-2 py-0.5 text-micro font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none focus-visible:ring-2 focus-visible:ring-ring/40 transition-[color,box-shadow] overflow-hidden',
	{
		variants: {
			variant: {
				default: 'border-gold-200/70 bg-gold-50 text-gold-700 [a&]:hover:bg-gold-100',
				secondary: 'border-ink-200/70 bg-ink-50 text-ink-700 [a&]:hover:bg-ink-100',
				destructive: 'border-brick-200/70 bg-brick-50 text-brick-700 [a&]:hover:bg-brick-100',
				outline: 'border-border text-foreground [a&]:hover:bg-ink-50',
				ok: 'border-gold-200/70 bg-gold-50 text-gold-700',
				running: 'border-lagoon-200/70 bg-lagoon-50 text-lagoon-700',
				failing: 'border-brick-200/70 bg-brick-50 text-brick-700',
				attention: 'border-ember-200/70 bg-ember-50 text-ember-700',
				idle: 'border-ink-200/70 bg-ink-50 text-ink-600',
				knowledge: 'border-plum-200/70 bg-plum-50 text-plum-700',
			},
		},
		defaultVariants: {
			variant: 'default',
		},
	}
);

function Badge({
	className,
	variant,
	asChild = false,
	...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
	const Comp = asChild ? Slot : 'span';

	return <Comp data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
