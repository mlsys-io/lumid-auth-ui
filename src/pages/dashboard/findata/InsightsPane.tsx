import { useState } from "react";
import ESGPane from "./ESGPane";
import GovernmentPane from "./GovernmentPane";
import ActivityPane from "./ActivityPane";
import { SubTabs } from "./ValuationPane";

type Sub = "esg" | "government" | "activity";

const SUBS: { id: Sub; label: string }[] = [
  { id: "esg",        label: "ESG"        },
  { id: "government", label: "Government" },
  { id: "activity",   label: "Activity"   },
];

export default function InsightsPane({ symbol }: { symbol: string }) {
  const [sub, setSub] = useState<Sub>("esg");
  return (
    <div className="flex flex-col gap-3">
      <SubTabs subs={SUBS} active={sub} onChange={setSub} />
      {sub === "esg"        && <ESGPane        symbol={symbol} />}
      {sub === "government" && <GovernmentPane symbol={symbol} />}
      {sub === "activity"   && <ActivityPane   symbol={symbol} />}
    </div>
  );
}
