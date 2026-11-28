// Words and rules for the unified username (Sandboxes page). Pure and tested (username.test.ts). The SERVER is the
// judge (lum.id identity: shape, reserved names, taken names); this only gives instant feedback while typing.

export const USERNAME_RULE = "2–32 characters: lowercase letters, digits, - and _, starting with a letter";

/** null = looks valid; otherwise the reason, in words. */
export function usernameProblem(name: string): string | null {
	const n = name.trim();
	if (!n) return "Type a name";
	if (n !== n.toLowerCase()) return "Use lowercase letters";
	if (!/^[a-z]/.test(n)) return "Start with a letter";
	if (/[^a-z0-9_-]/.test(n)) return "Only letters, digits, - and _";
	if (n.length < 2 || n.length > 32) return "2–32 characters";
	return null;
}

/** What changing the name does, said before the person presses Save. */
export function renameNote(oldName: string | null, newName: string): string {
	if (!oldName) return `You will be ${newName} on every cluster.`;
	return `${oldName} becomes ${newName} everywhere: your sandboxes restart under the new name and your home folders are renamed. The old name keeps working as a link, and nobody else can take it.`;
}

/** The note under a published port, in words. */
export function portNote(publicAddress: string, containerPort: number): string {
	return `${publicAddress} reaches port ${containerPort} inside the sandbox from anywhere on the internet. Anyone with the address can connect, so put a password or token on the service.`;
}
