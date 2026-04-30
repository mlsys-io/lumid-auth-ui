/**
 * Get a consistent color class for a tag based on its name
 * Uses a hash function to ensure the same tag always gets the same color
 */
export function getTagColor(tag: string): string {
	const colors = [
		'bg-blue-50 text-blue-800 hover:bg-blue-100 dark:bg-blue-900 dark:text-blue-300',
		'bg-green-50 text-green-800 hover:bg-green-100 dark:bg-green-900 dark:text-green-300',
		'bg-amber-50 text-amber-800 hover:bg-amber-100 dark:bg-amber-900 dark:text-amber-300',
		'bg-purple-50 text-purple-800 hover:bg-purple-100 dark:bg-purple-900 dark:text-purple-300',
		'bg-cyan-50 text-cyan-800 hover:bg-cyan-100 dark:bg-cyan-900 dark:text-cyan-300',
		'bg-amber-50 text-amber-800 hover:bg-amber-100 dark:bg-amber-900 dark:text-amber-300',
		'bg-gray-100 text-gray-700 hover:bg-gray-100 dark:bg-gray-900 dark:text-gray-300',
	];
	let hash = 0;
	for (let i = 0; i < tag.length; i++) {
		hash = tag.charCodeAt(i) + ((hash << 5) - hash);
	}
	return colors[Math.abs(hash) % colors.length];
}

export function getFrameworkColor(framework: string): string {
	if (framework === 'Moonshot') {
		return 'bg-purple-100 text-purple-700 hover:bg-purple-200 dark:bg-purple-900 dark:text-purple-300';
	}
	return 'bg-cyan-100 text-cyan-700 hover:bg-cyan-200 dark:bg-cyan-900 dark:text-cyan-300';
}
