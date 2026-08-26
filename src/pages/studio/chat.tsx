// /studio — the AI chat as THE main surface (claude.ai layout).
// /studio/chat/:id — the same surface with one saved thread opened by URL.
// Thin route wrapper; all behavior lives in StudioChat.

import { useParams } from "react-router-dom";

import { StudioChat } from "@/components/StudioChat";

export default function StudioChatHome() {
	// Present only on /studio/chat/:id. StudioChat treats it as "open this
	// thread"; without it the component keeps its own last-thread behaviour.
	const { id } = useParams<{ id: string }>();
	return <StudioChat threadId={id} />;
}
