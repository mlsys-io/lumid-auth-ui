// The Compute section shell: the tab strip plus a docked AI chat.
//
// Exists because AdminSectionLayout is shared by every admin section and only
// Compute wants a chat rail — wrapping here keeps the other sections untouched.
//
// Grounded on COMPUTE_KEY, a virtual scope with no bundle behind it, exactly as
// /studio/data is on DATA_KEY. Without its own key the thread would save
// untagged: unresumable on re-entry and filed under "General" in history.
//
// NOTE for whoever adds the next docked chat: the route must also be in
// `fullBleed` in StudioShell.tsx, or <main>'s default `max-w-5xl` cap applies
// and the rail pins itself to the middle of the viewport — correctly, to its
// container's right edge, which just happens to be nowhere useful. Full-bleed
// also carries h-screen/overflow-hidden, which is what makes the transcript
// scroll inside the rail instead of growing the page.

import ChatRail from "../../components/ChatRail";
import { COMPUTE_KEY } from "../../components/StudioChat";
import AdminSectionLayout from "../../pages/app/admin-section-layout";

type Props = React.ComponentProps<typeof AdminSectionLayout>;

// Own open/closed key, same reasoning as the groundApp comment above: without
// it this rail shares ChatRail's default (WS_CHAT_OPEN_KEY) with every
// /studio/apps/* workspace page, so closing (or opening) chat here silently
// flips the persisted state an app page reads on its next mount, and vice
// versa. /studio/data avoids this the same way (see data.tsx's CHAT_OPEN_KEY).
const COMPUTE_CHAT_OPEN_KEY = "studio_compute_chat_open";

export default function ComputeSection(props: Props) {
	return (
		<div className="flex min-h-0 flex-1">
			<div className="min-w-0 flex-1 overflow-y-auto px-6 py-6">
				<AdminSectionLayout {...props} />
			</div>
			<ChatRail groundApp={COMPUTE_KEY} openKey={COMPUTE_CHAT_OPEN_KEY} />
		</div>
	);
}
