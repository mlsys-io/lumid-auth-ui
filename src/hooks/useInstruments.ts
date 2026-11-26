import { useEffect, useState } from "react";
import { me } from "@/api/me";
import type { MeasureInstrument } from "@/lib/measure";

// The measurement instruments identity offers (GET /me/measure/instruments).
// One read per page load, shared by every panel; null until it answers, []
// when it can't (the panel then falls back to the instruments it knows).
let shared: Promise<MeasureInstrument[]> | null = null;

export function useInstruments(): MeasureInstrument[] | null {
	const [list, setList] = useState<MeasureInstrument[] | null>(null);
	useEffect(() => {
		let live = true;
		shared ??= me.measureInstruments().then((r) => r.instruments ?? []).catch(() => {
			shared = null; // let a later panel try again
			return [];
		});
		shared.then((l) => { if (live) setList(l); });
		return () => { live = false; };
	}, []);
	return list;
}
