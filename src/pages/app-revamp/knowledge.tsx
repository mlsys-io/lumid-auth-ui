// /app/knowledge — P0 delegates to the existing /dashboard/knowledge
// agent-list view. P3 lands publish/subscribe controls (Hook 3 silent).

import KnowledgePage from "../dashboard/knowledge";

export default function AppKnowledge() {
  return <KnowledgePage />;
}
