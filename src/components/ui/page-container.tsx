// PageContainer — the one content column for Studio pages.
//
// Left-aligned to the shell's 32px gutter (it never centres under a full-width
// header, which is what made Runs/Inbox/Knowledge look adrift), with three
// measures:  read 720 (prose, settings)  default 1120 (most pages)  full.
// Section entry is a single CSS rise, so nothing remounts on navigation.

import { cn } from "@/lib/utils";

const WIDTH = { read: "max-w-[720px]", default: "max-w-[1120px]", full: "max-w-none" } as const;

export function PageContainer({
	width = "default", className, children, animate = true,
}: {
	width?: keyof typeof WIDTH;
	className?: string;
	children: React.ReactNode;
	/** Fade-and-rise on mount (default on). */
	animate?: boolean;
}) {
	return (
		<div className={cn("w-full px-5 sm:px-8 pb-12", WIDTH[width], animate && "animate-lumen-rise", className)}>
			{children}
		</div>
	);
}
