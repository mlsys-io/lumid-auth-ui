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
	// Hovering a node drops everything OUTSIDE its immediate neighbourhood. The
	// neighbourhood is the node plus whatever it is directly wired to, in both
	// directions — dimming a node that feeds the hovered one would be worse than
	// not dimming at all.
	await editor.locator(".react-flow__node-wf").filter({ hasText: "Reply" }).first().hover();
	await page.waitForTimeout(450);
	const dimmed = await nodes.evaluateAll((els) => els.map((e) => ({
		label: e.querySelector(".truncate")?.textContent, o: getComputedStyle(e).opacity,
	})));
	const byLabel = Object.fromEntries(dimmed.map((d) => [d.label, d.o]));
	ok("hovering dims only what is NOT connected", byLabel["Name"] === "0.3", JSON.stringify(byLabel));
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

	// --- 10. no console errors -------------------------------------------------
	const real = consoleErrors.filter((e) => !/favicon|ERR_CONNECTION|Download the React DevTools/i.test(e));
	ok("no console errors", real.length === 0, real.slice(0, 3).join(" | "));
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
