import * as React from 'react';
import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from './button';

interface PaginationProps extends React.ComponentProps<'nav'> {
	currentPage: number;
	totalPages: number;
	total: number;
	onPageChange: (page: number) => void;
}

function Pagination({ className, currentPage, totalPages, total, onPageChange, ...props }: PaginationProps) {
	const renderPageNumbers = () => {
		const pages: (number | string)[] = [];
		const maxVisible = 5;

		if (totalPages <= maxVisible) {
			// Show all pages if total pages is less than max visible
			for (let i = 1; i <= totalPages; i++) {
				pages.push(i);
			}
		} else {
			// Always show first page
			pages.push(1);

			if (currentPage > 3) {
				pages.push('...');
			}

			// Show current page and surrounding pages
			const start = Math.max(2, currentPage - 1);
			const end = Math.min(totalPages - 1, currentPage + 1);

			for (let i = start; i <= end; i++) {
				pages.push(i);
			}

			if (currentPage < totalPages - 2) {
				pages.push('...');
			}

			// Always show last page
			if (totalPages > 1) {
				pages.push(totalPages);
			}
		}

		return pages;
	};

	return (
		<nav
			role="navigation"
			aria-label="pagination"
			className={cn('flex items-center justify-between', className)}
			{...props}
		>
			<div className="text-sm text-muted-foreground">
				Total {total} {total === 1 ? 'item' : 'items'}
			</div>

			<div className="flex items-center gap-2">
				<Button
					variant="outline"
					size="sm"
					onClick={() => onPageChange(currentPage - 1)}
					disabled={currentPage === 1}
					className="gap-1 h-9"
				>
					<ChevronLeft className="h-4 w-4" />
					Previous
				</Button>

				<div className="flex items-center gap-1">
					{renderPageNumbers().map((page, index) => {
						if (page === '...') {
							return (
								<div key={`ellipsis-${index}`} className="flex h-9 w-9 items-center justify-center">
									<MoreHorizontal className="h-4 w-4" />
								</div>
							);
						}

						return (
							<Button
								key={page}
								variant={currentPage === page ? 'default' : 'outline'}
								size="sm"
								onClick={() => onPageChange(page as number)}
							>
								{page}
							</Button>
						);
					})}
				</div>

				<Button
					variant="outline"
					size="sm"
					onClick={() => onPageChange(currentPage + 1)}
					disabled={currentPage === totalPages}
					className="gap-1 h-9"
				>
					Next
					<ChevronRight className="h-4 w-4" />
				</Button>
			</div>
		</nav>
	);
}

export { Pagination };
