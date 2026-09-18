// Dev-only mount for browser testing the workflow canvas + inspector in
// isolation, without the app's auth and routing in the way. Not referenced by
// the app bundle; wf-dev.html is its only entry.
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import WorkflowEditor from "../WorkflowEditor";
import WorkflowCanvas from "../WorkflowCanvas";
import { projectXpio } from "../adapters/xpio";
import { parseLumilake } from "../adapters/lumilake";
import "../../index.css";

const WF = `name: hello-world
inputs:
  Name: ["world"]
outputs:
  - name: reply
    ref: Reply
ops:
  - id: Greeting
    op: FormatOp
    inputs: [Name]
    template: "Hello, {name}!"
    format_kwargs: {name: Name}
  - id: Reply
    op: LLMChatOp
    inputs: [Greeting]
    messages:
      - {role: user, content: Greeting}
    config: {model: Qwen/Qwen2.5-7B-Instruct, max_tokens: 64}
  - id: Shout
    op: LambdaOp
    inputs: [Reply]
    fn_name: shout
    code: "def shout(inputs):\\n    (x,) = inputs\\n    return x.upper()"
`;

const LOOP = {
  name: "daily_digest", schedule: "20 4 * * *", knowledge_agent: "research-digest-analyst",
  steps: [
    { id: "observe_papers", skill: "arxiv/fetch" },
    { id: "analyze_papers", skill: "analyze_papers", experiment: "e1" },
    { id: "learn_ingest", skill: "learn/ingest_memories", knowledge_agent: "bank" },
  ],
};

const CYCLE = { ts: 1, steps: [
  { step_id: "observe_papers", ok: true, duration_s: 0.7, output_summary: "15 papers" },
  { step_id: "analyze_papers", ok: false, duration_s: 1.2, error: "Quota exceeded\nat line 3" },
] } as never;

const FM_SINGLE = `apiVersion: flowmesh/v1
kind: SFTTask
metadata:
  name: tune-tinyllama
spec:
  taskType: sft
  resources:
    hardware: {cpu: 8, memory: 32GiB, gpu: {type: RTX 5080, count: 2}}
  model:
    source: {type: huggingface, identifier: TinyLlama/TinyLlama-1.1B-Chat-v1.0}
  data:
    dataset_name: openai/gsm8k
    split: "train[:5%]"
  training: {num_train_epochs: 2, batch_size: 4, bf16: true}
  output:
    destination: {type: local}
    artifacts: [final_model]
`;

const FM_DAG = `apiVersion: flowmesh/v1
kind: InferenceTask
metadata:
  name: dag-two-branch-demo
spec:
  taskType: inference
  resources:
    hardware: {cpu: 4, memory: 16GiB}
  model:
    source: {type: huggingface, identifier: TinyLlama/TinyLlama-1.1B-Chat-v1.0}
  graph:
    nodes:
      - name: branch-a
        spec: {taskType: inference, data: {type: list, items: ['a']}}
      - name: branch-b
        spec: {taskType: inference, data: {type: list, items: ['b']}}
      - name: synthesis
        dependsOn: [branch-a, branch-b]
        spec: {taskType: inference, data: {type: graph_template}}
`;

function App() {
  const [yaml, setYaml] = useState(WF);
  const [fm, setFm] = useState(FM_SINGLE);
  const [fmDag, setFmDag] = useState(FM_DAG);
  return (
    <div style={{ padding: 16, display: "grid", gap: 16 }}>
      <section data-testid="editor" style={{ height: 520, border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden" }}>
        <WorkflowEditor value={yaml} onChange={setYaml} />
      </section>
      <section data-testid="run-overlay">
        <WorkflowCanvas
          graph={parseLumilake(WF)}
          overlay={{ "input:Name": "succeeded", Greeting: "succeeded", Reply: "running" }}
          mode="run" height={280}
        />
      </section>
      <section data-testid="xpio">
        <WorkflowCanvas graph={projectXpio(LOOP, { cycle: CYCLE })} mode="view" />
      </section>
      <section data-testid="fm-single" style={{ height: 620, border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden" }}>
        <WorkflowEditor value={fm} onChange={setFm} />
      </section>
      <section data-testid="fm-dag" style={{ height: 420, border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden" }}>
        <WorkflowEditor value={fmDag} onChange={setFmDag} />
      </section>
      <pre data-testid="yaml-out" style={{ display: "none" }}>{yaml}</pre>
      <pre data-testid="fm-out" style={{ display: "none" }}>{fm}</pre>
      <pre data-testid="fmdag-out" style={{ display: "none" }}>{fmDag}</pre>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
