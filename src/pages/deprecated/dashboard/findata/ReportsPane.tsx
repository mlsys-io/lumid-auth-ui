import { useState } from "react";
import EarningsPane from "./EarningsPane";
import EarningsHistoryPane from "./EarningsHistoryPane";
import FilingsPane from "./FilingsPane";
import TranscriptsPane from "./TranscriptsPane";
import { SubTabs } from "./ValuationPane";

type Sub = "earnings" | "history" | "filings" | "transcripts";

const SUBS: { id: Sub; label: string }[] = [
  { id: "earnings",    label: "Earnings calendar" },
  { id: "history",     label: "Earnings history"  },
  { id: "filings",     label: "Filings"           },
  { id: "transcripts", label: "Transcripts"       },
];

export default function ReportsPane({ symbol }: { symbol: string }) {
  const [sub, setSub] = useState<Sub>("earnings");
  return (
    <div className="flex flex-col gap-3">
      <SubTabs subs={SUBS} active={sub} onChange={setSub} />
      {sub === "earnings"    && <EarningsPane symbol={symbol} />}
      {sub === "history"     && <EarningsHistoryPane symbol={symbol} />}
      {sub === "filings"     && <FilingsPane symbol={symbol} />}
      {sub === "transcripts" && <TranscriptsPane symbol={symbol} />}
    </div>
  );
}
