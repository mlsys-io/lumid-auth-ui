// /studio — the AI chat as THE main surface (claude.ai layout).
// Thin route wrapper; all behavior lives in StudioChat.

import { StudioChat } from "@/components/StudioChat";

export default function StudioChatHome() {
	return <StudioChat />;
}
