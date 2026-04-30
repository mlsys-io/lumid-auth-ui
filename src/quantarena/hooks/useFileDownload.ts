import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { ApiError } from '../api';

interface UseFileDownloadReturn {
	download: (
		fetchFn: () => Promise<Blob>,
		filename: string,
		options?: { successMessage?: string; errorMessage?: string }
	) => Promise<void>;
	downloading: boolean;
}

export function useFileDownload(): UseFileDownloadReturn {
	const [downloading, setDownloading] = useState(false);

	const download = useCallback(
		async (
			fetchFn: () => Promise<Blob>,
			filename: string,
			options?: { successMessage?: string; errorMessage?: string }
		) => {
			setDownloading(true);

			try {
				const blob = await fetchFn();
				const url = window.URL.createObjectURL(blob);
				const link = document.createElement('a');
				link.href = url;
				link.download = filename;
				document.body.appendChild(link);
				link.click();
				document.body.removeChild(link);
				window.URL.revokeObjectURL(url);

				if (options?.successMessage) {
					toast.success(options.successMessage);
				}
			} catch (error) {
				if (error instanceof ApiError) {
					toast.error(error.message || options?.errorMessage || 'Download failed');
				} else {
					toast.error(options?.errorMessage || 'Download failed. Please try again.');
				}
			} finally {
				setDownloading(false);
			}
		},
		[]
	);

	return {
		download,
		downloading,
	};
}
