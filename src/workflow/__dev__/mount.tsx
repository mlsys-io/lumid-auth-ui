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

const XPIO = `name: lumid-research-digest
kind: autoresearch
loops:
  - name: daily_digest
    schedule: '20 4 * * *'
    knowledge_agent: research-digest-analyst
    steps:
      - id: observe_papers
        stage: observe
        skill: arxiv/fetch
        args: {query: 'cat:cs.LG', max_results: 15}
        required: true
      - id: analyze_papers
        stage: analyze
        skill: analyze_papers
        experiment: e1
        required: true
      - id: learn_ingest
        stage: learn
        skill: learn/ingest_memories
        required: false
`;

const N8N_DOC = JSON.stringify({
  name: "research assistant",
  nodes: [
    { name: "When clicking Execute", type: "n8n-nodes-base.manualTrigger", parameters: {}, position: [0, 0] },
    { name: "Prompt", type: "n8n-nodes-base.set", parameters: { mode: "raw", value: "Summarise {{ $json.text }}" }, position: [220, 0] },
    { name: "Model", type: "@n8n/n8n-nodes-langchain.lmChatOpenAi", parameters: { model: "gpt-4o-mini" }, position: [220, 170],
      credentials: { openAiApi: { id: "1", name: "key" } } },
    { name: "Chain", type: "@n8n/n8n-nodes-langchain.chainLlm", parameters: { text: "Summarise this" }, position: [460, 0] },
    { name: "Slack", type: "n8n-nodes-base.slack", parameters: { channel: "#general" }, position: [700, 0] },
  ],
  connections: {
    "When clicking Execute": { main: [[{ node: "Prompt" }]] },
    Prompt: { main: [[{ node: "Chain" }]] },
    Model: { ai_languageModel: [[{ node: "Chain" }]] },
    Chain: { main: [[{ node: "Slack" }]] },
  },
}, null, 2);

const DIFY_DOC = `version: "0.7.0"
kind: app
app:
  name: summariser
  mode: workflow
workflow:
  graph:
    nodes:
      - id: start1
        type: custom
        position: {x: 0, y: 0}
        data: {type: start, title: Start, _hovering: false, selected: true}
      - id: llm1
        type: custom
        position: {x: 280, y: 0}
        data:
          type: llm
          title: Summarise
          model: {name: gpt-4o-mini, provider: openai}
          prompt_template: [{role: user, text: "Summarise {{#start1.query#}}"}]
          _runningStatus: succeeded
      - id: ifelse1
        type: custom
        position: {x: 560, y: 0}
        data: {type: if-else, title: Long enough?}
      - id: answer1
        type: custom
        position: {x: 840, y: 0}
        data: {type: answer, title: Reply}
    edges:
      - {id: e1, source: start1, target: llm1, sourceHandle: source}
      - {id: e2, source: llm1, target: ifelse1, sourceHandle: source}
      - {id: e3, source: ifelse1, target: answer1, sourceHandle: "true"}
`;

// The 38% case: five of the thirteen installed apps carry anchors.
const XPIO_ANCHORED = `name: mbb-ai
loops:
  - name: case_cycle
    schedule: '@trigger'
    engine: {type: command, module: cycle}
    skills: &id001
      - alignment
      - answer
    skills_invoked: *id001
`;

function App() {
  const [yaml, setYaml] = useState(WF);
  const [fm, setFm] = useState(FM_SINGLE);
  const [fmDag, setFmDag] = useState(FM_DAG);
  const [xp, setXp] = useState(XPIO);
  const [n8n, setN8n] = useState(N8N_DOC);
  const [dify, setDify] = useState(DIFY_DOC);
  const [anch, setAnch] = useState(XPIO_ANCHORED);
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
      <section data-testid="xpio-edit" style={{ height: 560, border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden" }}>
        <WorkflowEditor value={xp} onChange={setXp} />
      </section>
      <section data-testid="n8n-import" style={{ height: 420, border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden" }}>
        <WorkflowEditor value={n8n} onChange={setN8n} />
      </section>
      <section data-testid="dify-import" style={{ height: 380, border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden" }}>
        <WorkflowEditor value={dify} onChange={setDify} />
      </section>
      <section data-testid="xpio-anchored" style={{ height: 420, border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden" }}>
        <WorkflowEditor value={anch} onChange={setAnch} />
      </section>
      <pre data-testid="anch-out" style={{ display: "none" }}>{anch}</pre>
      <pre data-testid="n8n-out" style={{ display: "none" }}>{n8n}</pre>
      <pre data-testid="xpio-out" style={{ display: "none" }}>{xp}</pre>
      <pre data-testid="yaml-out" style={{ display: "none" }}>{yaml}</pre>
      <pre data-testid="fm-out" style={{ display: "none" }}>{fm}</pre>
      <pre data-testid="fmdag-out" style={{ display: "none" }}>{fmDag}</pre>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
