// Studio /studio/skills — composer absorbed into the studio shell.
// Phase S2 — closes the cross-domain hop (audit finding #1). xp.io/go
// is the legacy standalone entry; this is the canonical one going
// forward.
//
// Go.tsx is the source of truth for the composer body; embedded=true
// strips its standalone chrome so it slots cleanly inside StudioShell.

import { Go } from '../Go';

export default function StudioSkills() {
	return <Go embedded />;
}
