// /app/results — for P0 this delegates to the existing /dashboard/results
// page. P1 will lift cycle-feedback button + quality-score sparkline
// into this dedicated view; P2 adds runtime + cost columns.

import ResultsPage from "../dashboard/results";

export default function AppResults() {
  return <ResultsPage />;
}
