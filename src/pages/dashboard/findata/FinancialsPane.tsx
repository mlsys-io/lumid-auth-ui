import { useState } from "react";
import FundamentalsPane from "./FundamentalsPane";
import MetricsPane from "./MetricsPane";
import ValuationPane from "./ValuationPane";
import EstimatesPane from "./EstimatesPane";
import DividendsPane from "./DividendsPane";
import { SubTabs } from "./ValuationPane";

type Sub = "fundamentals" | "metrics" | "valuation" | "estimates" | "dividends";

const SUBS: { id: Sub; label: string }[] = [
  { id: "fundamentals", label: "Fundamentals" },
  { id: "metrics",      label: "Metrics"      },
  { id: "valuation",    label: "Valuation"    },
  { id: "estimates",    label: "Estimates"    },
  { id: "dividends",    label: "Dividends"    },
];

export default function FinancialsPane({ symbol }: { symbol: string }) {
  const [sub, setSub] = useState<Sub>("fundamentals");
  return (
    <div className="flex flex-col gap-3">
      <SubTabs subs={SUBS} active={sub} onChange={setSub} />
      {sub === "fundamentals" && <FundamentalsPane symbol={symbol} />}
      {sub === "metrics"      && <MetricsPane      symbol={symbol} />}
      {sub === "valuation"    && <ValuationPane    symbol={symbol} />}
      {sub === "estimates"    && <EstimatesPane    symbol={symbol} />}
      {sub === "dividends"    && <DividendsPane    symbol={symbol} />}
    </div>
  );
}
