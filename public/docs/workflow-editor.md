# The workflow canvas

Lumid has three runtimes that each take a different workflow language, plus two
foreign formats people arrive with. There is **one canvas** for all five. It
reads the dialect off the document — you never pick it from a menu.

The canvas is a **view of a document, not a replacement for it**. The YAML is
the source of truth; the graph is a projection of it, and an edit is a patch
applied at a path inside the document. That is the whole design, and everything
below follows from it.

| Dialect | What it is | On the canvas |
|---|---|---|
| **Lumilake ops** | our op DAG, authored here | **edit** — add, connect, delete, change parameters |
| **FlowMesh `flowmesh/v1`** | our task spec, authored here | **edit** — form for a single task, DAG for `spec.graph` |
| **xpio `loops[]`** | declarative app config | **edit the loop only** — the rest of the file is never touched |
| **n8n** | foreign export | **import only** — read, convert, never written back |
| **Dify** | foreign export | **import only** — read, convert, never written back |

The asymmetry is deliberate. Lumid has no n8n writer and no Dify writer, so
there is no round-trip to get wrong. An imported workflow becomes a Lumid
document and stops being an n8n one.

---

## 1. Open one

**Studio → Workflows → New**, or go straight to
[`/studio/workflows/new`](/studio/workflows/new). Paste or upload a definition,
or start from the example that is already in the box.

**Design** and **YAML** are two views of one document. Switching between them
does not convert anything — there is nothing to convert.

![The workflow canvas with a node selected. The inspector shows that op's parameters with the schema's own help text; the unselected, unconnected node is dimmed.](/docs/img/workflow-editor.png)

Reading that screenshot:

- **`Lumilake · 4 nodes`** top right — the detected dialect and the node count.
  If this says something you did not expect, the document is not what you think
  it is.
- **`Ticker`** is dimmed because `Extract` is selected and they are not
  connected. Selecting a node dims everything outside its immediate
  neighbourhood — the node plus whatever it is directly wired to, both
  directions.
- The inspector's help text comes from the op schema, not from us writing prose
  twice. `Template` says *"Python `str.format` syntax"* because that is what
  `FormatOp` actually does.

### The one document, in text

![The same workflow in the YAML view. This is the document; the canvas is a projection of it.](/docs/img/workflow-yaml.png)

**Your file comes back as your file.** Comments, key order and formatting
survive a round trip through the canvas. Edits are applied as patches to the
parsed document, not by regenerating it from the graph. This matters most for
xpio loops, which are hand-authored files under version control — regenerating
one would be vandalism of something a person wrote.

The one thing that does *not* survive, and it is a real limitation: if you edit
a file through the canvas, **comment *alignment*** can change (the column a
trailing comment sits in). The comments themselves are kept.

---

## 2. Reading a graph

Three channels carry meaning, and they never overload each other:

| Channel | Carries | How |
|---|---|---|
| Colour + icon | what kind of thing it is | a tinted accent rail on the left edge |
| Ring | status | a ring around the card, never a border repaint |
| Edge style | what the relationship *is* | see below |

Edges are not all the same relationship, and drawing them as if they were is
how graph UIs mislead people:

- **solid, arrowed** — real data dependency. The output of one goes into the
  next.
- **dashed with a mid-line chip** — *declared*, not ordered. An xpio loop's
  `skills_invoked[]` says which skills a step uses; the contract explicitly
  does **not** say in what order. Drawing that as a pipeline would invent a
  guarantee that does not exist.
- **dotted, entering from below** — *attached*. An n8n language-model node
  plugs **into** the node it serves; it is not a step the data flows through.
- **labelled chip** — a branch, carrying its condition.

When a run overlay is applied, a node is marked succeeded only on its own
result, and an **edge** is marked succeeded only when **both** ends succeeded —
so the path that actually executed is traced through the graph rather than
inferred by eye.

---

## 3. Moving around

This is worth stating plainly, because the defaults in this class of component
are usually wrong and ours were wrong twice:

| Gesture | What happens |
|---|---|
| **Wheel / two-finger scroll** | **scrolls the page.** The canvas never traps it |
| **Ctrl / ⌘ + wheel** | zooms the canvas |
| **Drag empty canvas** | pans |
| **Controls pill**, bottom left | zoom in, zoom out, fit to view |

The canvas sits inside a scrolling page, so the page owns the wheel. A canvas
that eats your scroll as you read past it is the single most irritating thing
an embedded graph can do.

---

## 4. The inspector

Click a node. Three tabs:

**Parameters** — the fields for that node kind, from a schema, with the
schema's own help. Required fields are marked. An unknown node kind falls back
to editing that node's YAML subtree directly, so a node type we do not have a
schema for is still editable rather than a dead end.

**Run** — that node's last run: duration, output, error. Present only when a
run overlay is loaded.

**YAML** — the document, scoped to *this node*, editable both ways.

---

## 5. xpio loops

An xpio app's `.xpcloud.yaml` declares `loops[]`. Paste one and the canvas
renders the loop with its stages as bands.

![An xpio loop. Stage bands down the left, the schedule as a trigger node, the experiment badge on the step that feeds one, and the knowledge bank the loop writes into.](/docs/img/workflow-xpio.png)

The bands are the loop's own `stage:` values — `observe`, `analyze`, `learn`
above. The trigger card is the `schedule:`. The flask badge on
`analyze_papers` marks a step feeding an experiment. The card at the bottom is
the knowledge agent the loop ingests into.

**What the canvas will not let you do**, because the contract forbids it:

- **Draw an arbitrary edge.** `steps[]` is a sequence and `skills_invoked[]` is
  unordered. Neither admits a free-form edge, so connecting two nodes by hand
  is refused rather than silently written.
- **Touch anything outside `loops[]`.** Roles, datasets, skills and manifest
  metadata are never rewritten.

### One case where structural editing is refused outright

If the document uses **YAML anchors** on or above the part you are editing
(`skills: &id001` … `skills_invoked: *id001`, which real installed apps do use),
the canvas will not patch that subtree — it offers the YAML tab and says why.
Writing through an alias changes text somewhere else in the file, which is
exactly the surprise the document-first design exists to prevent.

---

## 6. FlowMesh tasks

A FlowMesh task is usually **one** node, and a canvas showing one box is a
worse form than a form. So a single-task spec is inspector-first.

Add a `spec.graph` and it becomes a real DAG:

![A FlowMesh spec with spec.graph: two branches fanning into a synthesis node, each card showing its requested hardware.](/docs/img/workflow-flowmesh.png)

Each card shows what that node asked the scheduler for. Going from a single
task to a graph rewrites `spec:` into `spec.graph.nodes[]` — that is a real
change to your document, so it is an explicit, confirmed, undoable step rather
than something that happens because you dragged a second node in.

---

## 7. Importing from n8n or Dify

Paste an n8n or Dify export and the canvas reads it immediately — you do not
have to convert it first to see what you have.

![An n8n workflow rendered natively. The dotted languageModel edge shows the model attaching into the chain node rather than feeding it.](/docs/img/workflow-import-preview.png)

Note the banner: it is viewable, and usable as a starting point, but **never
written back**. Note also the `languageModel` edge — dotted, entering from
below. That is the `attach` relationship; drawing it like a data edge would
claim the model is a step in the pipeline.

**Import…** converts it, and the dialog says exactly what you are getting:

![The import dialog: four of five n8n nodes not imported, each with the reason; credential and attachment warnings; and what FlowMesh's own parser would accept if you submitted the original instead.](/docs/img/workflow-import-dialog.png)

This dialog is deliberately unflattering. Four of five nodes did not come
across, and each one says why — including the one that is *not* a loss
(`OpenAI Chat Model` is a model provider, so it was folded into the op it was
attached to rather than becoming an orphan node).

**What never imports:** credentials, always. Expressions — n8n's `{{$json.x}}`
and Dify's `{{#node.var#}}` — are not translated; topology and prompts are.
Any node kind with no equivalent op.

**The alternative the dialog points at** is the honest one: if you want the
original to run *as it is*, submit it with `Workflow-Format: n8n` and let the
runtime that owns those semantics execute it. Importing is for when you want it
to become a Lumid workflow.

---

## Known limits

- **Code fields do not render right now.** Fields that use the embedded code
  editor show *"Loading…"* and never resolve, because the editor is fetched
  from a CDN our Content-Security-Policy blocks. Every other field type works,
  and the node's YAML tab and the page's YAML view are both unaffected — edit
  code-shaped fields there for now.
- **Expressions are not translated on import** (above). Topology and prompts
  come across; the plumbing between them does not.
- **Positions are not stored in your document.** Layout is computed. Dragging a
  node is remembered in your browser, not written into the file — so a workflow
  in git does not carry one person's canvas arrangement. Imported n8n and Dify
  graphs seed those local positions from the original, so they open looking
  like they did in the tool they came from.
- **No credentials manager, no expression language, no webhook registry.** They
  are not missing pending work; they are outside what this is.
