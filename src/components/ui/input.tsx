import * as React from 'react';
import { cn } from '../../lib/utils';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
	return (
		<input
			type={type}
			data-slot="input"
			className={cn(
				// Lumen: paper field, hairline border, bronze focus halo. (`bg-card`
				// was never a mapped colour, so fields rendered transparent.)
				'file:text-foreground placeholder:text-ink-500 selection:bg-gold-100 selection:text-foreground border-border flex h-9 w-full min-w-0 rounded-md border bg-card px-3 py-1 text-base shadow-e1 transition-[color,box-shadow,border-color] duration-120 outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm hover:border-ink-300',
				'focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/15',
				'aria-[invalid=true]:ring-4 aria-[invalid=true]:ring-destructive/15 aria-[invalid=true]:border-destructive',
				className
			)}
			{...props}
		/>
	);
}

export { Input };
