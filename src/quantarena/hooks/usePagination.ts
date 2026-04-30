import { useState, useCallback, useMemo } from 'react';
import { PAGE_SIZE } from '../lib/enum';

interface UsePaginationOptions {
	initialPage?: number;
	pageSize?: number;
}

interface UsePaginationReturn {
	currentPage: number;
	totalPages: number;
	total: number;
	pageSize: number;
	hasNextPage: boolean;
	hasPreviousPage: boolean;
	setCurrentPage: (page: number) => void;
	setTotal: (total: number) => void;
	goToPage: (page: number) => void;
	nextPage: () => void;
	previousPage: () => void;
	resetPage: () => void;
}

export function usePagination(options: UsePaginationOptions = {}): UsePaginationReturn {
	const { initialPage = 1, pageSize = PAGE_SIZE } = options;

	const [currentPage, setCurrentPage] = useState(initialPage);
	const [total, setTotal] = useState(0);

	const totalPages = useMemo(() => Math.ceil(total / pageSize), [total, pageSize]);

	const hasNextPage = useMemo(() => currentPage < totalPages, [currentPage, totalPages]);
	const hasPreviousPage = useMemo(() => currentPage > 1, [currentPage]);

	const goToPage = useCallback(
		(page: number) => {
			const validPage = Math.max(1, Math.min(page, totalPages || 1));
			setCurrentPage(validPage);
		},
		[totalPages]
	);

	const nextPage = useCallback(() => {
		if (hasNextPage) {
			setCurrentPage((prev) => prev + 1);
		}
	}, [hasNextPage]);

	const previousPage = useCallback(() => {
		if (hasPreviousPage) {
			setCurrentPage((prev) => prev - 1);
		}
	}, [hasPreviousPage]);

	const resetPage = useCallback(() => {
		setCurrentPage(initialPage);
	}, [initialPage]);

	return useMemo(
		() => ({
			currentPage,
			totalPages,
			total,
			pageSize,
			hasNextPage,
			hasPreviousPage,
			setCurrentPage,
			setTotal,
			goToPage,
			nextPage,
			previousPage,
			resetPage,
		}),
		[
			currentPage,
			totalPages,
			total,
			pageSize,
			hasNextPage,
			hasPreviousPage,
			setCurrentPage,
			setTotal,
			goToPage,
			nextPage,
			previousPage,
			resetPage,
		]
	);
}
