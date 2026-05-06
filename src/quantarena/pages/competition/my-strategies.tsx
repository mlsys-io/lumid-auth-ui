// Cross-competition simulation roster — promoted from
// /dashboard/quant/strategy (the old "Forward Testing" tab) into the
// Competition shell on 2026-05-03 because every simulation strategy
// is competition-bound (CreateSimulationStrategyRequest requires
// competition_id; SimulationStrategyInfo has competition_id +
// competition_name + status='Competing'|'Idle'). Lives under
// /dashboard/quant/competition/my.
//
// Component stays under pages/strategy/ where its dialogs and tightly-
// coupled siblings (new-simulation-strategy-dialog, ai-strategy-wizard,
// delete-strategy-dialog) live. This file is the route entry under
// the competition tree.

export { default } from '../strategy/simulation-strategy';
