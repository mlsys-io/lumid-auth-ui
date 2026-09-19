// workflow-canvas-check.mjs — drives the workflow canvas + inspector in a real
// browser.
//
// Everything about this feature was verified by tsc, unit tests and a clean
// build, none of which can tell you whether a node renders, whether clicking it
// opens anything, or whether an edit reaches the document. This does.
//
//   node e2e/workflow-canvas-check.mjs
//
// Expects the dev harness at $WF_URL (default http://localhost:5199/auth/wf-dev.html),
// which mounts LumilakeEditor and two read-only canvases without the app's auth
// or routing in the way.

import { chromium } from "playwright";
import { launchBrowser } from "./_browser.mjs";

const URL = process.env.WF_URL || "http://localhost:5199/auth/wf-dev.html";
const SHOTS = process.env.WF_SHOTS || "/tmp/wf-shots";

let pass = 0;
const failures = [];
const ok = (name, cond, detail = "") => {
	if (cond) { pass++; console.log(`  ✓ ${name}`); }
	else { failures.push(`${name}${detail ? ` — ${detail}` : ""}`); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
};

const browser = await launchBrowser(chromium);
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

// Console errors are findings, not noise: a React key warning or a failed
// dynamic import is exactly the class of bug a build cannot catch.
const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

try {
	await page.goto(URL, { waitUntil: "networkidle", timeout: 30000 });
	await page.waitForSelector(".react-flow__node", { timeout: 15000 });
	await page.waitForTimeout(600); // let the enter animation settle

	// --- 1. the graph renders -------------------------------------------------
	const editor = page.getByTestId("editor");
	const nodes = editor.locator(".react-flow__node-wf > div");
	const nodeCount = await nodes.count();
	ok("editor renders every op plus the declared input", nodeCount === 4, `got ${nodeCount}, expected 4`);

	const edgeCount = await editor.locator(".react-flow__edge").count();
	ok("edges are derived from op.inputs", edgeCount === 3, `got ${edgeCount}, expected 3`);

	const labels = await nodes.allInnerTexts();
	const joined = labels.join(" | ");
	ok("node labels are the op ids", /Greeting/.test(joined) && /Reply/.test(joined) && /Shout/.test(joined), joined.slice(0, 120));
	ok("the subtitle carries the one meaningful parameter", /Qwen2\.5-7B-Instruct/.test(joined), "model not shown on the card");
	ok("a LambdaOp shows its function name", /fn shout/.test(joined), "fn name not shown");

	// --- 2. the visual language -----------------------------------------------
	const rail = await nodes.first().locator("> span").first().evaluate((el) => {
		const s = getComputedStyle(el);
		return { w: s.width, bg: s.backgroundColor };
	});
	ok("each node carries a 3px type accent rail", rail.w === "3px", `width=${rail.w}`);
	ok("the rail is tinted, not grey-on-grey", rail.bg !== "rgba(0, 0, 0, 0)", `bg=${rail.bg}`);

	const border = await nodes.first().evaluate((el) => getComputedStyle(el).borderColor);
	ok("the node border stays neutral so type keeps its own channel", /226, 232, 240/.test(border), border);

	// Stock React Flow controls must be gone — that grey column is the tell.
	ok("stock <Controls> is replaced", await editor.locator(".react-flow__controls").count() === 0);
	ok("a custom control pill is present", await editor.locator('button[title="Fit to view"]').count() === 1);

	// --- 3. status is a ring, never a repaint ---------------------------------
	const runCanvas = page.getByTestId("run-overlay");
	const runNodes = runCanvas.locator(".react-flow__node-wf > div");
	const shadows = await runNodes.evaluateAll((els) => els.map((e) => getComputedStyle(e).boxShadow));
	ok("a succeeded node gets the brand GOLD ring", shadows.some((s) => /176, 143, 69/.test(s)), shadows[1]?.slice(0, 90));
	ok("a running node gets the sky ring", shadows.some((s) => /14, 165, 233/.test(s)), shadows.join(" | ").slice(0, 160));
	// Regression guard: an invalid entry anywhere in a comma-separated
	// box-shadow list invalidates the WHOLE declaration, which is how a running
	// node silently lost its ring and its base shadow at once.
	ok("no node has a dropped box-shadow declaration", shadows.every((s) => s !== "none"), shadows.join(" | ").slice(0, 160));
	const runBgs = await runNodes.evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor));
	ok("status never repaints the card background", runBgs.every((b) => /255, 255, 255/.test(b)), runBgs.join(","));

	// The executed path is traced in gold: only edges whose BOTH ends succeeded.
	const strokes = await runCanvas.locator(".react-flow__edge-path").evaluateAll((els) => els.map((e) => getComputedStyle(e).stroke));
	ok("the executed path is traced in gold", strokes.some((s) => /197, 167, 94/.test(s)), strokes.join(" | "));
	ok("the edge into the RUNNING node is sky, not gold", strokes.some((s) => /14, 165, 233/.test(s)), strokes.join(" | "));

	// --- 4. xpio: bands, dashed declared edges, error text --------------------
	const xpio = page.getByTestId("xpio");
	ok("xpio stage bands render behind the pipeline", await xpio.locator(".react-flow__node-band").count() >= 2);
	const xpioText = await xpio.innerText();
	ok("a failed step shows its error text on the node", /Quota exceeded/.test(xpioText), xpioText.slice(0, 140));
	ok("the stage gutter is labelled", /OBSERVE|LEARN/i.test(xpioText));
	ok("emoji badges are gone (lucide icons instead)", !/🧪|🧠/.test(xpioText));
	// In a top-to-bottom graph every handle must be on the top/bottom edge.
	// Keying handle orientation off the node FAMILY put the trigger's handle on
	// its side, so its edge left sideways and looped back to the node beneath.
	const handlePos = await xpio.locator(".react-flow__node-wf .react-flow__handle").evaluateAll(
		(els) => els.map((e) => [...e.classList].find((c) => /^react-flow__handle-(top|bottom|left|right)$/.test(c))));
	ok("a vertical graph puts every handle on a top or bottom edge",
		handlePos.every((c) => c === "react-flow__handle-top" || c === "react-flow__handle-bottom"),
		[...new Set(handlePos)].join(", "));

	// --- 4b. focus by dimming --------------------------------------------------
	// SELECTING a node drops everything outside its immediate neighbourhood --
	// the node plus whatever it is directly wired to, both directions, since
	// dimming a node that feeds the selected one is worse than not dimming.
	//
	// This keyed off HOVER until v0.5.427. Every mouse move re-animated every
	// node, which is what "the canvas is flickering" turned out to be: sweeping
	// across nodes produced 27 distinct opacity states, 24 of 70 samples caught
	// mid-animation. Selection is a discrete event, so it settles. Keep it that
	// way -- if this ever goes back to hover, the flicker comes back with it.
	await editor.locator(".react-flow__node-wf").filter({ hasText: "Reply" }).first().click();
	await page.waitForTimeout(450);
	const dimmed = await nodes.evaluateAll((els) => els.map((e) => ({
		label: e.querySelector(".truncate")?.textContent, o: getComputedStyle(e).opacity,
	})));
	const byLabel = Object.fromEntries(dimmed.map((d) => [d.label, d.o]));
	ok("selecting dims only what is NOT connected", byLabel["Name"] === "0.3", JSON.stringify(byLabel));

	// The flicker guard proper: hovering a DIFFERENT node must not change any
	// opacity, because hover no longer drives dimming at all.
	const opac = () => nodes.evaluateAll((els) => els.map((e) => getComputedStyle(e).opacity).join(","));
	const beforeHover = await opac();
	await editor.locator(".react-flow__node-wf").filter({ hasText: "Shout" }).first().hover();
	await page.waitForTimeout(400);
	ok("hovering changes no opacity (flicker guard)", (await opac()) === beforeHover,
		`${beforeHover} -> ${await opac()}`);

	// Clear the selection this section introduced: it opens the inspector, and
	// the next assertions expect the canvas in its resting state.
	await editor.locator(".react-flow__pane").first().click({ position: { x: 8, y: 8 } });
	await page.waitForTimeout(350);

	ok("the node feeding the hovered one stays bright", byLabel["Greeting"] === "1", JSON.stringify(byLabel));
	ok("the node it feeds stays bright", byLabel["Shout"] === "1", JSON.stringify(byLabel));

	// --- 5. selection opens the inspector -------------------------------------
	await editor.locator(".react-flow__node-wf").filter({ hasText: "Reply" }).first().click();
	await page.waitForTimeout(400);
	const inspector = editor.locator("aside").filter({ hasText: "Parameters" }).first();
	ok("clicking a node opens the inspector", await inspector.count() === 1);
	const insText = await inspector.innerText();
	ok("the inspector names the op kind", /LLMChatOp/.test(insText), insText.slice(0, 120));
	ok("schema-driven fields are rendered", /Model/.test(insText) && /Max tokens/.test(insText), insText.slice(0, 200));
	ok("hints are present, which is what makes it feel authored", /HuggingFace/.test(insText));

	// The canvas must REFIT when the inspector narrows it, or the right-hand
	// nodes slide underneath the panel at exactly the moment the user asked to
	// look at the graph.
	await page.waitForTimeout(600);
	const paneRight = await editor.locator(".react-flow__pane").boundingBox();
	const cardBoxes = await nodes.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().right));
	ok("the graph refits when the inspector opens, instead of hiding behind it",
		cardBoxes.every((r) => r <= paneRight.x + paneRight.width + 2),
		`pane right=${Math.round(paneRight.x + paneRight.width)}, furthest card=${Math.round(Math.max(...cardBoxes))}`);

	await page.screenshot({ path: `${SHOTS}/01-editor-inspector.png`, fullPage: false });

	// --- 5b. code fields, and the two bugs under them -------------------------
	// This field type was unreachable in production for its whole life: it was a
	// Monaco editor, @monaco-editor/react fetches Monaco from cdn.jsdelivr.net at
	// runtime, and lum.id sends `script-src 'self'`. tsc, the bundler and every
	// test here were clean the entire time, because nothing is wrong until a
	// browser makes that request. Assert on the RENDERED control, not the import.
	{
		// Restore this block's own preconditions. Earlier sections leave the
		// editor in whatever mode they finished in, and if that is the YAML pane
		// there are no nodes to click -- which fails as a 30s timeout naming the
		// node, not the mode, and reads like the node disappeared.
		await editor.scrollIntoViewIfNeeded();
		const backToCanvas = editor.getByRole("button", { name: /^Canvas$/ });
		if (await backToCanvas.count()) { await backToCanvas.first().click(); await page.waitForTimeout(600); }
		await editor.locator(".react-flow__node-wf").first().waitFor({ timeout: 10000 });

		const insp = editor.locator("aside").filter({ hasText: "Parameters" }).first();
		// Clicking a node that is ALREADY selected closes the inspector, and the
		// previous section leaves one selected. Clear first, then select, so this
		// block does not depend on which node the section before it left open.
		await editor.locator(".react-flow__pane").first().click({ position: { x: 8, y: 8 } });
		await page.waitForTimeout(400);
		await editor.locator(".react-flow__node-wf").filter({ hasText: "Reply" }).first().click();
		await page.waitForTimeout(900);
		await insp.waitFor({ timeout: 10000 });
		ok("no CDN-loaded editor anywhere", (await page.$$(".monaco-editor")).length === 0);
		ok("the inspector is not stuck loading", !/Loading\.\.\./.test(await insp.innerText()));
		const ta = insp.locator("textarea");
		ok("a code field renders an editable control", await ta.count() > 0);

		// Commit an EXPLICIT new value. Never str.replace against text you have
		// not proved is present: a non-matching replace returns the input
		// unchanged, the field never changes, and the assertion then passes or
		// fails on nothing. That mistake shipped once as v0.5.424 and was made
		// again while writing this very test.
		const before = await ta.first().inputValue();
		const MARK = "zzmark-" + Date.now();
		const edited = JSON.stringify([{ role: "system", content: MARK }, { role: "user", content: "Greeting" }], null, 2);
		ok("the test's edit is actually a change", edited !== before);
		await ta.first().fill(edited);
		await ta.first().blur();
		await page.waitForTimeout(700);
		await editor.getByRole("button", { name: /^YAML$/ }).first().click();
		await page.waitForTimeout(700);
		const doc = await page.evaluate(() => {
			const all = [...document.querySelectorAll("textarea,pre")].map((e) => e.value ?? e.textContent ?? "");
			return all.find((v) => /ops:/.test(v) && /LLMChatOp/.test(v)) || "";
		});
		ok("the document is observable", doc.length > 0);
		// The second bug: `list` and `keyValue` parse their text back before
		// writing; `code` committed the raw string, so a structured field would
		// have been replaced by a JSON string. Only reachable once Monaco was gone.
		ok("a structured code edit lands as a LIST, not a string",
			doc.includes(MARK) && /role:\s*system/.test(doc) && !/messages:\s*["']/.test(doc));
		await editor.getByRole("button", { name: /^Canvas$/ }).first().click();
		await page.waitForTimeout(500);
	}

	// --- 6. an edit reaches the document --------------------------------------
	const modelInput = inspector.locator('input[id="f-config-model"]');
	ok("the model field is a resource picker input", await modelInput.count() === 1);
	await modelInput.fill("Qwen/Qwen2.5-0.5B-Instruct");
	await modelInput.blur();
	await page.waitForTimeout(600);
	const yamlOut = await page.getByTestId("yaml-out").innerText();
	ok("editing a field writes through to the YAML", yamlOut.includes("Qwen2.5-0.5B-Instruct"), "value not in the document");
	ok("and the untouched parts of the document survive", yamlOut.includes("template: \"Hello, {name}!\""), "template lost");
	// Read the card via allInnerTexts()/title rather than container.innerText():
	// innerText on React Flow's transformed pane comes back empty, which reads
	// like "the card did not update" when the card is in fact correct.
	const cardTitles = await nodes.locator("[title]").evaluateAll((els) => els.map((e) => e.getAttribute("title")));
	ok("the node card reflects the new value", cardTitles.some((t) => t?.includes("Qwen2.5-0.5B-Instruct")), cardTitles.join(" | "));

	// --- 7. undo ---------------------------------------------------------------
	await editor.locator('button[title="Undo"]').click();
	await page.waitForTimeout(400);
	const afterUndo = await page.getByTestId("yaml-out").innerText();
	ok("undo restores the previous model", afterUndo.includes("Qwen2.5-7B-Instruct") && !afterUndo.includes("0.5B"), "undo did not revert");

	// --- 8. adding a node ------------------------------------------------------
	const before = await editor.locator(".react-flow__node-wf > div").count();
	await editor.getByRole("button", { name: "Add" }).click();
	await page.waitForTimeout(250);
	await editor.getByRole("button", { name: /Message/ }).first().click();
	await page.waitForTimeout(600);
	const after = await editor.locator(".react-flow__node-wf > div").count();
	ok("the add menu adds a node", after === before + 1, `${before} -> ${after}`);
	const yamlAfterAdd = await page.getByTestId("yaml-out").innerText();
	ok("a new node is wired up, not orphaned", /inputs:\s*\[/.test(yamlAfterAdd.split("MessageOp")[0].slice(-200)) || yamlAfterAdd.includes("- message"), "no inputs on the new op");

	// --- 9. diagnostics --------------------------------------------------------
	await editor.locator('button[title="Toggle the YAML pane"]').click();
	await page.waitForTimeout(300);
	const ta = editor.locator("textarea").first();
	await ta.fill("ops:\n  - id: A\n    op: LLMChatOp\n    inputs: [DoesNotExist]\n");
	await page.waitForTimeout(500);
	await editor.locator('button[title="Toggle the YAML pane"]').click();
	await page.waitForTimeout(600);
	const editorText = await editor.innerText();
	ok("a dangling reference surfaces as a visible problem", /DoesNotExist/.test(editorText) && /problem/i.test(editorText), editorText.slice(0, 200));

	await page.screenshot({ path: `${SHOTS}/02-diagnostics.png` });
	await page.getByTestId("xpio").screenshot({ path: `${SHOTS}/03-xpio-bands.png` });
	await page.getByTestId("run-overlay").screenshot({ path: `${SHOTS}/04-run-overlay.png` });

	// --- 9b. FlowMesh: form-first, and the dialect is read from the bytes ------
	const fm = page.getByTestId("fm-single");
	const fmText = await fm.innerText();
	ok("the dialect is detected from the document, not a column", /FlowMesh/.test(fmText), fmText.slice(0, 120));

	// A single task is NOT a graph — 13 of the 15 kinds are one task, so the
	// form gets the room and the canvas is reduced to a header strip.
	const fmReal = await fm.locator(".react-flow__node-wf > div").count();
	ok("a single task renders one real node plus its two endpoints", fmReal === 3, `got ${fmReal}`);
	// The form sits in an overflow-y-auto panel, so innerText only returns what
	// is above the fold. Read the section headings out of the DOM instead.
	const fmSections = await fm.locator("aside h4").evaluateAll((els) => els.map((e) => e.textContent?.trim()));
	ok("the spec form is shown without having to select anything",
		fmSections.includes("Resources") && fmSections.includes("Training"), fmSections.join(", "));
	ok("the kind's own blocks are present, and only those",
		fmSections.includes("Model") && !fmSections.includes("LoRA"),
		`SFT should show Model but not LoRA; got ${fmSections.join(", ")}`);
	const fmBadges = await fm.locator(".react-flow__node-wf [title]").evaluateAll((els) => els.map((e) => e.getAttribute("title")));
	ok("the GPU request shows its VALUE, not just a generic icon",
		fmBadges.some((t) => t?.includes("RTX 5080x2")), fmBadges.join(" | "));

	// Editing a nested spec field must reach the document.
	const epochs = fm.locator('input[id="f-training-num_train_epochs"]');
	ok("a nested training field is rendered", await epochs.count() === 1);
	await epochs.fill("5");
	await epochs.blur();
	await page.waitForTimeout(600);
	ok("editing a nested spec field writes through",
		(await page.getByTestId("fm-out").innerText()).includes("num_train_epochs: 5"), "not written");

	// --- 9c. FlowMesh DAG: dependsOn IS the edge set ---------------------------
	const dag = page.getByTestId("fm-dag");
	const dagNodes = await dag.locator(".react-flow__node-wf > div").count();
	const dagEdges = await dag.locator(".react-flow__edge").count();
	ok("spec.graph.nodes render as real nodes", dagNodes === 3, `got ${dagNodes}`);
	ok("dependsOn renders as edges", dagEdges === 2, `got ${dagEdges}`);
	const dagText = await dag.innerText();
	ok("a graph document is NOT form-first", /3 nodes/.test(dagText), dagText.slice(0, 120));
	ok("graph nodes inherit the shared model for their subtitle", /TinyLlama/.test(dagText), dagText.slice(0, 200));

	await page.getByTestId("fm-single").screenshot({ path: `${SHOTS}/05-flowmesh-form.png` });
	await page.getByTestId("fm-dag").screenshot({ path: `${SHOTS}/06-flowmesh-dag.png` });

	// --- 9d. xpio: the dialect with NO drawable edge ---------------------------
	const xp = page.getByTestId("xpio-edit");
	const xpText = await xp.innerText();
	ok("an xpcloud manifest is detected as an xpio loop", /xpio loop/.test(xpText), xpText.slice(0, 120));

	// steps[] is ordered, so the order IS the edge set and there is nothing to
	// draw. The canvas must not offer handles it would then refuse to honour.
	const xpHandles = await xp.locator(".react-flow__handle.connectable").count();
	ok("no connectable handles are offered, because there is no edge to draw", xpHandles === 0, `got ${xpHandles}`);

	await xp.locator(".react-flow__node-wf").filter({ hasText: "analyze_papers" }).first().click();
	await page.waitForTimeout(400);
	const xpIns = xp.locator("aside").filter({ hasText: "Parameters" }).first();
	const xpInsText = await xpIns.innerText();
	ok("a step opens the step schema", /Step/.test(xpInsText) && /Skill/.test(xpInsText), xpInsText.slice(0, 160));
	ok("the id hint warns that renaming orphans past cycles",
		/history|orphan/i.test(xpInsText), xpInsText.slice(0, 300));

	// An edit must land in the right loop, at the right index.
	const skillInput = xpIns.locator('input[id="f-skill"]');
	ok("the skill field is rendered", await skillInput.count() === 1);
	await skillInput.fill("analyze_v2");
	await skillInput.blur();
	await page.waitForTimeout(600);
	const xpOut = await page.getByTestId("xpio-out").innerText();
	ok("the edit reaches the loop inside the manifest", xpOut.includes("skill: analyze_v2"), "not written");
	ok("and the manifest around it is intact",
		xpOut.includes("name: lumid-research-digest") && xpOut.includes("loops:") && xpOut.includes("arxiv/fetch"),
		"surrounding document damaged");

	await page.getByTestId("xpio-edit").screenshot({ path: `${SHOTS}/07-xpio-edit.png` });

	// --- 9e. import: what you are about to lose, before you lose it -----------
	const imp = page.getByTestId("n8n-import");
	const impText = await imp.innerText();
	ok("an n8n document is viewable, not hidden", await imp.locator(".react-flow__node-wf > div").count() === 5, "expected all 5 nodes drawn");
	ok("and is plainly marked as never written back", /never written back/.test(impText), impText.slice(0, 200));

	// An ai_languageModel edge is an ATTACHMENT — the model plugs into the chain
	// node, it does not feed it data — so it must be drawn differently.
	const impDash = await imp.locator(".react-flow__edge-path").evaluateAll(
		(els) => els.map((e) => getComputedStyle(e).strokeDasharray));
	ok("a model attachment is drawn dotted, not as a pipeline",
		impDash.some((d) => d && d !== "none" && d.startsWith("2")), impDash.join(" | "));

	await imp.getByRole("button", { name: /Import/ }).click();
	await page.waitForTimeout(700);
	// The dialog is the fixed overlay, not an ancestor N levels up from the
	// heading — counting ancestors breaks the moment the markup nests differently.
	const dialog = page.locator("div.fixed.inset-0.z-50").first();
	const dlgText = await dialog.innerText();
	ok("the dialog calls itself a starting point, not a translation", /starting point/.test(dlgText), dlgText.slice(0, 200));
	// Case-insensitive: innerText reflects CSS text-transform, so a heading
	// styled `uppercase` comes back as "NOT IMPORTED" whatever the source says.
	ok("unmapped nodes are shown as ghosts with a reason",
		/Slack/.test(dlgText) && /not imported/i.test(dlgText) && /No Lumilake op does this/.test(dlgText),
		dlgText.slice(0, 400));
	ok("credentials and expressions are called out before importing",
		/credential/i.test(dlgText) && /expression/i.test(dlgText), dlgText.slice(0, 600));
	ok("it reports what the REAL parser would accept, rather than guessing",
		/3 of 5/.test(dlgText), dlgText.slice(0, 700));

	await page.screenshot({ path: `${SHOTS}/08-import-dialog.png` });

	await dialog.getByRole("button", { name: /^Import \d+ op/ }).click();
	await page.waitForTimeout(800);
	const imported = await page.getByTestId("n8n-out").innerText();
	ok("importing replaces the document with valid Lumilake", /^name:/m.test(imported) && /ops:/.test(imported), imported.slice(0, 120));
	ok("and the scaffold declares outputs, or the job fails server-side", /outputs:/.test(imported), imported.slice(0, 200));
	ok("the editor now treats it as Lumilake", /Lumilake/.test(await imp.innerText()), "dialect not switched");

	// --- 9f. Dify, which carries the most traps ------------------------------
	const dify = page.getByTestId("dify-import");
	const difyText = await dify.innerText();
	ok("a Dify app is recognised and viewable", /Dify workflow/.test(difyText), difyText.slice(0, 160));

	const difyLabels = await dify.locator(".react-flow__node-wf > div .truncate").evaluateAll((els) => els.map((e) => e.textContent));
	// data.title is the label; node.type is the literal "custom" on every node,
	// so reading it would make all four identical.
	ok("labels come from data.title, not the node's own type",
		difyLabels.includes("Summarise") && difyLabels.includes("Long enough?") && !difyLabels.includes("custom"),
		difyLabels.join(" | "));

	// sourceHandle carries branch identity — an edge that drops it loses which
	// branch it was.
	const difyEdgeLabels = await dify.locator(".react-flow__edge-textwrapper, .react-flow__edge-text").allTextContents();
	ok("a branch edge keeps the branch it came from", difyEdgeLabels.some((t) => /true/.test(t)), difyEdgeLabels.join(" | "));

	await dify.getByRole("button", { name: /Import/ }).click();
	await page.waitForTimeout(700);
	const difyDlg = page.locator("div.fixed.inset-0.z-50").first();
	const difyDlgText = await difyDlg.innerText();
	ok("control flow is named as needing a redesign, not silently dropped",
		/if-else/.test(difyDlgText) && /redesign/i.test(difyDlgText), difyDlgText.slice(0, 500));
	ok("flattened branches are called out before importing",
		/branch/i.test(difyDlgText) && /rebuil/i.test(difyDlgText), difyDlgText.slice(0, 700));
	await page.screenshot({ path: `${SHOTS}/09-dify-import.png` });
	await difyDlg.getByRole("button", { name: /Cancel/ }).click();
	await page.waitForTimeout(300);

	// --- 9g. the anchored xpio file — the 38% case ---------------------------
	// Five of the thirteen installed apps carry anchors. A whole-file lock would
	// refuse all of them; the guard is per-path, so the file opens and edits are
	// refused only where the sharing actually is.
	const anch = page.getByTestId("xpio-anchored");
	ok("an anchored manifest still opens and renders",
		await anch.locator(".react-flow__node-wf > div").count() >= 3,
		"anchored file should not be blank");

	await anch.locator(".react-flow__node-wf").filter({ hasText: "alignment" }).first().click();
	await page.waitForTimeout(400);
	const anchIns = anch.locator("aside").filter({ hasText: "Parameters" }).first();
	if (await anchIns.count()) {
		const before = await page.getByTestId("anch-out").innerText();
		ok("the anchor is intact before any edit", before.includes("&id001"), "fixture wrong");
	}

	// --- 9h. marketplace previews, which replaced a 504 iframe ---------------
	const pv = page.getByTestId("previews");
	for (const [id, chip] of [["lumilake", "Lumilake"], ["flowmesh", "FlowMesh"], ["n8n", "n8n"]]) {
		const one = page.getByTestId(`preview-${id}`);
		ok(`a ${id} definition previews natively`,
			await one.locator(".react-flow__node-wf > div").count() > 0, `${id} drew nothing`);
		ok(`the ${id} preview names its dialect`, (await one.innerText()).includes(chip), await one.innerText());
	}
	// definition_json has no schema discipline, so an empty row is ordinary.
	const junk = page.getByTestId("preview-junk");
	ok("an empty definition degrades to a sentence, not an error",
		/no definition saved/.test(await junk.innerText()), await junk.innerText());
	ok("a showcase preview carries no chrome", await pv.locator(".react-flow__controls").count() === 0);
	await pv.screenshot({ path: `${SHOTS}/11-previews.png` });

	// --- 10. no console errors -------------------------------------------------
	const real = consoleErrors.filter((e) => !/favicon|ERR_CONNECTION|Download the React DevTools/i.test(e));
	ok("no console errors", real.length === 0, real.slice(0, 3).join(" | "));

	// --- N. the wheel belongs to the page ------------------------------------
	// Shipped broken twice. v0.5.426 fixed the editor and I called it done;
	// view/run canvases still ate the wheel because React Flow has TWO wheel
	// paths and preventScrolling is only read by one of them (panOnScroll
	// installs a handler that always preventDefault + stopImmediatePropagation).
	// Assert on EVERY pane, not just the editor's — a per-mode prop is exactly
	// what a single-canvas check cannot see.
	await page.evaluate(() => { document.scrollingElement.scrollTop = 0; });
	await page.waitForTimeout(200);
	const panes = await page.$$(".react-flow__pane");
	ok("harness exposes canvases in several modes", panes.length >= 4, `got ${panes.length}`);
	let trapped = [];
	for (let i = 0; i < panes.length; i++) {
		const box = await panes[i].boundingBox();
		if (!box || box.width < 200 || box.height < 120) continue;
		await panes[i].scrollIntoViewIfNeeded();
		await page.waitForTimeout(250);
		const bb = await panes[i].boundingBox();
		const doc = () => page.evaluate(() => document.scrollingElement.scrollTop);
		const room = await page.evaluate(() => {
			const d = document.scrollingElement;
			return d.scrollHeight - d.clientHeight - d.scrollTop;
		});
		if (room < 120) continue; // at the page bottom there is nothing to scroll
		const before = await doc();
		await page.mouse.move(bb.x + bb.width / 2, bb.y + Math.min(bb.height / 2, 160));
		// defaultPrevented on a listener at document tells us whether React Flow
		// swallowed it; a swallowed event never arrives at all.
		await page.evaluate(() => {
			window.__wheelSeen = [];
			window.__wl = (e) => window.__wheelSeen.push(e.defaultPrevented);
			document.addEventListener("wheel", window.__wl, { passive: true });
		});
		await page.mouse.wheel(0, 240);
		await page.waitForTimeout(350);
		const moved = (await doc()) - before;
		const seen = await page.evaluate(() => {
			document.removeEventListener("wheel", window.__wl);
			return window.__wheelSeen;
		});
		if (moved <= 0 || seen.length === 0 || seen.some(Boolean)) {
			trapped.push(`pane#${i} scrolled ${moved}px, wheel@document=${JSON.stringify(seen)}`);
		}
	}
	ok("every canvas lets the wheel scroll the page", trapped.length === 0, trapped.join("; "));

	// ...but ctrl+wheel must still zoom, or the canvas becomes un-navigable.
	{
		const pane = (await page.$$(".react-flow__pane"))[0];
		await pane.scrollIntoViewIfNeeded();
		await page.waitForTimeout(250);
		const bb = await pane.boundingBox();
		const k = async () => page.evaluate((el) => {
			const v = el.closest(".react-flow").querySelector(".react-flow__viewport");
			return getComputedStyle(v).transform;
		}, pane);
		const a = await k();
		await page.mouse.move(bb.x + bb.width / 2, bb.y + Math.min(bb.height / 2, 160));
		await page.keyboard.down("Control");
		await page.mouse.wheel(0, -240);
		await page.keyboard.up("Control");
		await page.waitForTimeout(400);
		const b2 = await k();
		ok("ctrl+wheel still zooms", a !== b2, `transform unchanged: ${a}`);
	}


	// --- N+1. promotion is confirmed, not silent ------------------------------
	// flowmesh.edit.ts asserted "the caller confirms it first" for two releases.
	// No caller did. Adding a second node silently rewrote `spec:` into
	// `spec.graph.nodes[]` in a file the user may have hand-written.
	{
		const fm = page.getByTestId("fm-single");
		await fm.scrollIntoViewIfNeeded();
		await page.waitForTimeout(500);
		const specOf = () => page.evaluate(() => {
			const all = [...document.querySelectorAll("textarea,pre")].map((e) => e.value ?? e.textContent ?? "");
			return all.find((v) => /apiVersion:\s*flowmesh\/v1/.test(v) && /SFTTask|tune-tinyllama/.test(v)) || "";
		});
		await fm.getByRole("button", { name: /^YAML$/ }).first().click();
		await page.waitForTimeout(600);
		const before = await specOf();
		ok("the single-task spec starts without a graph", before.length > 0 && !/graph:/.test(before));
		await fm.getByRole("button", { name: /^Canvas$/ }).first().click();
		await page.waitForTimeout(600);

		const addTask = async () => {
			await fm.getByRole("button", { name: /Add/ }).first().click();
			await page.waitForTimeout(500);
			const item = page.locator("button,[role=option],li").filter({ hasText: /inference/i }).first();
			if (await item.count()) await item.click();
			await page.waitForTimeout(600);
		};
		await addTask();
		ok("adding a second task ASKS first", await page.locator("text=Restructure this spec?").count() > 0);
		await page.getByRole("button", { name: /^Cancel$/ }).first().click();
		await page.waitForTimeout(500);
		await fm.getByRole("button", { name: /^YAML$/ }).first().click();
		await page.waitForTimeout(600);
		ok("declining leaves the document byte-identical", (await specOf()) === before);
		await fm.getByRole("button", { name: /^Canvas$/ }).first().click();
		await page.waitForTimeout(500);

		await addTask();
		const go = page.getByRole("button", { name: /Restructure and add/ }).first();
		if (await go.count()) await go.click();
		await page.waitForTimeout(800);
		await fm.getByRole("button", { name: /^YAML$/ }).first().click();
		await page.waitForTimeout(700);
		const after = await specOf();
		ok("accepting promotes to spec.graph.nodes[]", /graph:/.test(after) && /nodes:/.test(after));
	}

} catch (e) {
	failures.push(`threw: ${e.message}`);
	console.log(`  ✗ threw: ${e.message}`);
	try { await page.screenshot({ path: `${SHOTS}/99-failure.png` }); } catch { /* ignore */ }
} finally {
	await browser.close();
}

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
	console.log("failures:");
	for (const f of failures) console.log(`  - ${f}`);
	process.exitCode = 1;
}
