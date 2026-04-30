import React, { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Badge } from '../../components/ui/badge';
import { createFlowMeshJob, getMyCompetitionsList, getSimulationStrategies, ApiError } from '../../api';
import type { CompetitionInfo, SimulationStrategyInfo } from '../../api/types';
import { toast } from 'sonner';
import { Zap, Code, ChevronDown, ChevronUp } from 'lucide-react';

interface CreateJobDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSuccess: () => void;
}

type JobMode = 'trading' | 'yaml';

const YAML_TEMPLATE = `apiVersion: lumid/v1
kind: Task
metadata:
  name: my-workflow
spec:
  taskType: api
  api:
    url: "\${QUANTARENA_TRADING_URL}/api/custom/trading/order"
    method: POST
    headers:
      X-API-Token: "Bearer \${QUANTARENA_API_TOKEN}"
      Content-Type: "application/json"
    json:
      symbol: "DOGEUSD"
      direction: "Buy"
      volume: 1
    timeout_sec: 30
    response:
      parse_json: false
      return_body: true`;

const SCHEDULE_PRESETS = [
	{ label: 'Every 1 minute', value: '*/1 * * * *' },
	{ label: 'Every 5 minutes', value: '*/5 * * * *' },
	{ label: 'Every 15 minutes', value: '*/15 * * * *' },
	{ label: 'Every hour', value: '0 * * * *' },
	{ label: 'Every 4 hours', value: '0 */4 * * *' },
	{ label: 'Daily at 9 AM', value: '0 9 * * *' },
	{ label: 'Weekdays at 9 AM', value: '0 9 * * 1-5' },
	{ label: 'Custom', value: 'custom' },
];

function buildTradingYaml(symbol: string, direction: string, volume: number): string {
	return `apiVersion: lumid/v1
kind: Task
metadata:
  name: auto-trade
spec:
  taskType: api
  api:
    url: "\${QUANTARENA_TRADING_URL}/api/custom/trading/order"
    method: POST
    headers:
      X-API-Token: "Bearer \${QUANTARENA_API_TOKEN}"
      Content-Type: "application/json"
    json:
      symbol: "${symbol}"
      direction: "${direction}"
      volume: ${volume}
    timeout_sec: 30
    response:
      parse_json: false
      return_body: true`;
}

export const CreateJobDialog = ({ open, onOpenChange, onSuccess }: CreateJobDialogProps) => {
	const [mode, setMode] = useState<JobMode>('trading');
	const [name, setName] = useState('');
	const [description, setDescription] = useState('');
	const [competitionId, setCompetitionId] = useState('');
	const [strategyId, setStrategyId] = useState('');
	const [schedulePreset, setSchedulePreset] = useState('*/5 * * * *');
	const [customCron, setCustomCron] = useState('');
	const [maxExecutions, setMaxExecutions] = useState(0);
	const [submitting, setSubmitting] = useState(false);
	const [showAdvanced, setShowAdvanced] = useState(false);

	// Trading mode fields
	const [symbol, setSymbol] = useState('');
	const [direction, setDirection] = useState('Buy');
	const [volume, setVolume] = useState(1);

	// YAML mode
	const [workflowYaml, setWorkflowYaml] = useState(YAML_TEMPLATE);

	const [competitions, setCompetitions] = useState<CompetitionInfo[]>([]);
	const [strategies, setStrategies] = useState<SimulationStrategyInfo[]>([]);

	useEffect(() => {
		if (open) {
			fetchCompetitions();
			fetchStrategies();
		}
	}, [open]);

	const fetchCompetitions = async () => {
		try {
			const res = await getMyCompetitionsList({ page: 1, page_size: 100, status: ['Ongoing'] });
			setCompetitions(res.data.competitions || []);
		} catch { /* ignore */ }
	};

	const fetchStrategies = async () => {
		try {
			const res = await getSimulationStrategies({ page: 1, page_size: 100, status: ['Competing'] });
			setStrategies(res.data.strategies || []);
		} catch { /* ignore */ }
	};

	const selectedCompetition = competitions.find((c) => String(c.id) === competitionId);
	const availableSymbols = selectedCompetition?.symbols || [];

	const filteredStrategies = competitionId
		? strategies.filter((s) => s.competition_id === Number(competitionId))
		: strategies;

	// Auto-select first symbol when competition changes
	useEffect(() => {
		if (availableSymbols.length > 0 && !availableSymbols.includes(symbol)) {
			setSymbol(availableSymbols[0]);
		}
	}, [competitionId, availableSymbols]);

	// Auto-generate name
	useEffect(() => {
		if (mode === 'trading' && symbol && direction) {
			setName(`${direction} ${symbol}`);
		}
	}, [mode, symbol, direction]);

	const cronExpression = schedulePreset === 'custom' ? customCron : schedulePreset;

	const cronError = useMemo(() => {
		if (schedulePreset !== 'custom' || !customCron) return '';
		const parts = customCron.trim().split(/\s+/);
		if (parts.length < 5 || parts.length > 6) return 'Cron must have 5 fields (min hour day month weekday)';
		return '';
	}, [schedulePreset, customCron]);

	const finalYaml = useMemo(() => {
		if (mode === 'yaml') return workflowYaml;
		return buildTradingYaml(symbol, direction, volume);
	}, [mode, symbol, direction, volume, workflowYaml]);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setSubmitting(true);
		try {
			await createFlowMeshJob({
				name,
				description,
				competition_id: Number(competitionId),
				simulation_strategy_id: Number(strategyId),
				workflow_yaml: finalYaml,
				cron_expression: cronExpression,
				flowmesh_url: import.meta.env.VITE_FLOWMESH_URL || 'http://localhost:8000',
				max_executions: maxExecutions,
			});
			toast.success('Job created! It will start running on schedule.');
			onSuccess();
		} catch (error) {
			toast.error(error instanceof ApiError ? error.message : 'Failed to create job');
		} finally {
			setSubmitting(false);
		}
	};

	const isValid = name && competitionId && strategyId && cronExpression && finalYaml
		&& (mode === 'yaml' || symbol) && !cronError;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>Create Automated Job</DialogTitle>
					<DialogDescription>
						Set up a recurring task that runs automatically on a schedule.
					</DialogDescription>
				</DialogHeader>

				{/* Mode toggle */}
				<div className="flex gap-2 p-1 bg-muted rounded-lg">
					<button
						type="button"
						onClick={() => setMode('trading')}
						className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer ${
							mode === 'trading' ? 'bg-white shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
						}`}
					>
						<Zap className="w-4 h-4" />
						Trading Bot
					</button>
					<button
						type="button"
						onClick={() => setMode('yaml')}
						className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer ${
							mode === 'yaml' ? 'bg-white shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
						}`}
					>
						<Code className="w-4 h-4" />
						Custom Workflow
					</button>
				</div>

				<form onSubmit={handleSubmit} className="space-y-5">
					{/* Step 1: Competition & Strategy */}
					<div className="space-y-3">
						<div className="flex items-center gap-2">
							<div className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-bold">1</div>
							<span className="text-sm font-medium">Choose Competition & Strategy</span>
						</div>
						<div className="grid grid-cols-2 gap-3 pl-8">
							<div className="space-y-1.5">
								<Label className="text-xs">Competition</Label>
								<Select value={competitionId} onValueChange={(v) => { setCompetitionId(v); setStrategyId(''); setSymbol(''); }}>
									<SelectTrigger className="h-9"><SelectValue placeholder="Select..." /></SelectTrigger>
									<SelectContent>
										{competitions.length === 0 ? (
											<div className="px-2 py-1.5 text-sm text-muted-foreground">No ongoing competitions</div>
										) : (
											competitions.map((c) => (
												<SelectItem key={c.id} value={String(c.id)}>
													<span>{c.name}</span>
												</SelectItem>
											))
										)}
									</SelectContent>
								</Select>
							</div>
							<div className="space-y-1.5">
								<Label className="text-xs">Strategy</Label>
								<Select value={strategyId} onValueChange={setStrategyId} disabled={!competitionId}>
									<SelectTrigger className="h-9"><SelectValue placeholder={competitionId ? 'Select...' : 'Pick competition first'} /></SelectTrigger>
									<SelectContent>
										{filteredStrategies.length === 0 ? (
											<div className="px-2 py-1.5 text-sm text-muted-foreground">No competing strategies</div>
										) : (
											filteredStrategies.map((s) => (
												<SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
											))
										)}
									</SelectContent>
								</Select>
							</div>
						</div>
					</div>

					{/* Step 2: What to do */}
					<div className="space-y-3">
						<div className="flex items-center gap-2">
							<div className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-bold">2</div>
							<span className="text-sm font-medium">{mode === 'trading' ? 'Configure Trade' : 'Define Workflow'}</span>
						</div>
						<div className="pl-8">
							{mode === 'trading' ? (
								<div className="space-y-3">
									<div className="grid grid-cols-3 gap-3">
										<div className="space-y-1.5">
											<Label className="text-xs">Symbol</Label>
											<Select value={symbol} onValueChange={setSymbol} disabled={availableSymbols.length === 0}>
												<SelectTrigger className="h-9"><SelectValue placeholder="Pick symbol" /></SelectTrigger>
												<SelectContent>
													{availableSymbols.map((s) => (
														<SelectItem key={s} value={s}>{s}</SelectItem>
													))}
												</SelectContent>
											</Select>
										</div>
										<div className="space-y-1.5">
											<Label className="text-xs">Direction</Label>
											<Select value={direction} onValueChange={setDirection}>
												<SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
												<SelectContent>
													<SelectItem value="Buy">
														<span className="text-green-600 font-medium">Buy</span>
													</SelectItem>
													<SelectItem value="Sell">
														<span className="text-red-600 font-medium">Sell</span>
													</SelectItem>
												</SelectContent>
											</Select>
										</div>
										<div className="space-y-1.5">
											<Label className="text-xs">Volume</Label>
											<Input type="number" min={1} value={volume} onChange={(e) => setVolume(parseInt(e.target.value) || 1)} className="h-9" />
										</div>
									</div>
									{symbol && (
										<div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
											Each execution will <Badge variant="outline" className={direction === 'Buy' ? 'text-green-700 border-green-300' : 'text-red-700 border-red-300'}>{direction}</Badge>{' '}
											<span className="font-medium text-foreground">{volume} {symbol}</span> using your strategy's API token.
										</div>
									)}
								</div>
							) : (
								<div className="space-y-2">
									<Textarea
										value={workflowYaml}
										onChange={(e) => setWorkflowYaml(e.target.value)}
										rows={12}
										className="font-mono text-xs"
									/>
									<p className="text-xs text-muted-foreground">
										Edit the template above. <code className="bg-muted px-1 rounded">{'${QUANTARENA_API_TOKEN}'}</code> and <code className="bg-muted px-1 rounded">{'${QUANTARENA_TRADING_URL}'}</code> are auto-injected at runtime.
									</p>
								</div>
							)}
						</div>
					</div>

					{/* Step 3: Schedule */}
					<div className="space-y-3">
						<div className="flex items-center gap-2">
							<div className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-bold">3</div>
							<span className="text-sm font-medium">Set Schedule</span>
						</div>
						<div className="pl-8 space-y-3">
							<div className="grid grid-cols-2 gap-3">
								<div className="space-y-1.5">
									<Label className="text-xs">Run every</Label>
									<Select value={schedulePreset} onValueChange={setSchedulePreset}>
										<SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
										<SelectContent>
											{SCHEDULE_PRESETS.map((p) => (
												<SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
								{schedulePreset === 'custom' && (
									<div className="space-y-1.5">
										<Label className="text-xs">Cron expression</Label>
										<Input placeholder="*/5 * * * *" value={customCron} onChange={(e) => setCustomCron(e.target.value)} className={`h-9 font-mono ${cronError ? 'border-red-500' : ''}`} />
										{cronError && <p className="text-xs text-red-500 mt-1">{cronError}</p>}
									</div>
								)}
							</div>
						</div>
					</div>

					{/* Advanced (collapsed) */}
					<div className="pl-8">
						<button
							type="button"
							onClick={() => setShowAdvanced(!showAdvanced)}
							className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
						>
							{showAdvanced ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
							Advanced options
						</button>
						{showAdvanced && (
							<div className="mt-3 space-y-3 rounded-lg border p-3">
								<div className="space-y-1.5">
									<Label className="text-xs">Job Name</Label>
									<Input value={name} onChange={(e) => setName(e.target.value)} className="h-9" placeholder="Auto-generated from trade config" />
								</div>
								<div className="space-y-1.5">
									<Label className="text-xs">Description</Label>
									<Input value={description} onChange={(e) => setDescription(e.target.value)} className="h-9" placeholder="Optional" />
								</div>
								<div className="space-y-1.5">
									<Label className="text-xs">Max executions (0 = unlimited)</Label>
									<Input type="number" min={0} value={maxExecutions} onChange={(e) => setMaxExecutions(parseInt(e.target.value) || 0)} className="h-9" />
								</div>
							</div>
						)}
					</div>

					<DialogFooter>
						<Button variant="outline" onClick={() => onOpenChange(false)} className="cursor-pointer" type="button">
							Cancel
						</Button>
						<Button type="submit" className="cursor-pointer gap-2" disabled={!isValid || submitting}>
							<Zap className="w-4 h-4" />
							{submitting ? 'Creating...' : 'Start Job'}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
};
