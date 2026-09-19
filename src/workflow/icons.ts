// icons.ts — one lucide icon per node kind.
//
// Icons are monochrome and tinted with the node's accent, so the icon is part
// of the TYPE channel and never encodes status. They also replace the 🧪/🧠
// emoji the old canvas put inside nodes: emoji render differently on every
// platform, do not inherit colour, and read as a hackathon demo.

import {
	Bot, Box, Braces, Brain, CircleDot, Clock, Code2, Cpu, Database, FileInput,
	FileOutput, FlaskConical, Image, MessageSquare, Play, Radio, Regex, Rocket,
	Search, Server, Sparkles, Terminal, Type, Wand2, type LucideIcon,
} from "lucide-react";
import type { WfNodeKind } from "./model";

const LUMILAKE_ICON: Record<string, LucideIcon> = {
	LLMChatOp: Sparkles,
	LLMOp: Sparkles,
	LLMVisionOp: Image,
	EmbeddingOp: Regex,
	ImageGenerationOp: Wand2,
	LambdaOp: Code2,
	FormatOp: Type,
	MessageOp: MessageSquare,
	DataRetrievalOp: Database,
	DataOp: Database,
};

const FLOWMESH_ICON: Record<string, LucideIcon> = {
	InferenceTask: Sparkles,
	TrainingTask: Cpu,
	SFTTask: Cpu,
	LoRASFTTask: Cpu,
	OmniTask: Cpu,
	AgentTask: Bot,
	EmbeddingTask: Regex,
	DiffusersTask: Wand2,
	ImageClassificationTask: Image,
	RetrievalTask: Search,
	DataProfilingTask: Database,
	ServeTask: Server,
	APITask: Radio,
	SSHTask: Terminal,
	EchoTask: MessageSquare,
};

export function iconFor(kind: WfNodeKind): LucideIcon {
	switch (kind.family) {
		case "lumilake-op":
			return LUMILAKE_ICON[kind.op] ?? Box;
		case "flowmesh-task":
			return FLOWMESH_ICON[kind.taskType] ?? Box;
		case "xpio-step":
			return Play;
		case "xpio-engine":
			return Terminal;
		case "io":
			switch (kind.role) {
				case "trigger": return Clock;
				case "input": return FileInput;
				case "output": return FileOutput;
				case "sink": return Brain;
			}
			return CircleDot;
		case "note":
			return MessageSquare;
		default:
			return Braces;
	}
}

/** Badge icons — the replacement for the emoji. */
export const BADGE_ICON: Record<string, LucideIcon> = {
	experiment: FlaskConical,
	knowledge: Brain,
	worker: Server,
	gpu: Cpu,
	dataset: Database,
	deploy: Rocket,
};
