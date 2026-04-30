import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
	"inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
	{
		variants: {
			variant: {
				// 主按钮：实心 indigo
				default: 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm',

				// 危险按钮：保持红色系
				destructive:
					'bg-red-500 text-white hover:bg-red-600 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-red-500/80',

				// 线框按钮：indigo 描边 + 轻微填充
				outline:
					'border border-indigo-300 text-indigo-600 hover:bg-indigo-50 dark:bg-transparent dark:border-indigo-500/70 dark:text-indigo-100 dark:hover:bg-indigo-950/40',

				// 次级按钮：浅 indigo 背景
				secondary:
					'bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-950/40 dark:text-indigo-100 dark:hover:bg-indigo-900/60',

				// ghost：无边框，文字用 indigo
				ghost: 'text-indigo-600 hover:bg-indigo-50 hover:text-indigo-700 dark:text-indigo-200 dark:hover:bg-indigo-950/40',

				// link：链接风格 indigo
				link: 'text-indigo-500 hover:text-indigo-600 underline-offset-4 hover:underline',
			},
			size: {
				default: 'h-9 px-4 py-2 has-[>svg]:px-3',
				sm: 'h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5',
				lg: 'h-10 rounded-md px-6 has-[>svg]:px-4',
				icon: 'size-9 rounded-md',
			},
		},
		defaultVariants: {
			variant: 'default',
			size: 'default',
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
