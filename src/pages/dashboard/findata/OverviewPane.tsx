import OverviewEquity from "./OverviewEquity";
import OverviewETF from "./OverviewETF";
import OverviewSimple from "./OverviewSimple";

export type SecKind = "equity" | "etf" | "fund" | "index" | "crypto" | "forex" | "unknown";

export default function OverviewPane({
  symbol,
  kind,
  onSelect,
}: {
  symbol: string;
  kind: SecKind;
  onSelect?: (s: string) => void;
}) {
  if (kind === "etf")    return <OverviewETF    symbol={symbol} onSelect={onSelect} />;
  if (kind === "fund")   return <OverviewETF    symbol={symbol} onSelect={onSelect} />;
  if (kind === "crypto") return <OverviewSimple symbol={symbol} kindLabel="Crypto" accent="#f59e0b" />;
  if (kind === "forex")  return <OverviewSimple symbol={symbol} kindLabel="Forex"  accent="#06b6d4" />;
  if (kind === "index")  return <OverviewSimple symbol={symbol} kindLabel="Index"  accent="#10b981" />;
  return <OverviewEquity symbol={symbol} />;
}
