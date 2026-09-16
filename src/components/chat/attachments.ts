// Attachment encoding, sized to what the server will actually accept.
//
// TWO FAULTS THIS REPLACES, both reported as "the chat jams the moment an image
// goes in" (2026-09-15).
//
// 1. THE ENCODE FROZE THE TAB. The old path did
//
//        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
//        btoa(bin)
//
//    on the main thread, over the whole file. A 5 MiB screenshot is five
//    million iterations building a five-million-character rope before btoa even
//    starts, so the UI locked up AT PASTE TIME — before anything was sent,
//    which is exactly what "一输入就卡壳" describes. FileReader.readAsDataURL
//    does the same work natively, off the main thread, in one call.
//
// 2. THE CLIENT LIMIT WAS A LIE. The composer advertised 5 MiB for images and
//    10 MiB for documents. Everything rides in ONE JSON body, the server caps
//    that body at 1.5 MiB (chatStreamMaxBodyBytes, me_agent_stream.go — a
//    deliberate OOM guard on the auth authority, not an oversight), and base64
//    inflates by 4/3. So the real ceiling was ~1.1 MiB and anything above it
//    was refused after the user had already waited through the encode. Worse,
//    a mid-upload 413/400 often reaches the browser as a connection reset, and
//    the send path then silently retries the whole body once — a second long
//    stall before any error is shown.
//
// Images are DOWNSCALED to fit rather than refused: a screenshot is almost
// always far larger than a model needs, and 1568px on the long edge is the
// point beyond which Anthropic's vision stack gains nothing anyway.

/** The server's hard body cap — keep in step with chatStreamMaxBodyBytes. */
export const SERVER_MAX_BODY_BYTES = 1536 * 1024;

/**
 * What one attachment's RAW bytes may be. base64 costs 4/3, and the body also
 * carries the prose, the history and the JSON scaffolding, so hold some back.
 */
export const ATTACH_BUDGET_BYTES = Math.floor((SERVER_MAX_BODY_BYTES * 3) / 4) - 96 * 1024;

/** Longest edge we bother sending. Beyond this a vision model gains nothing. */
export const MAX_IMAGE_EDGE = 1568;

/**
 * base64 of a Blob, without blocking the main thread.
 *
 * readAsDataURL yields "data:<mime>;base64,<payload>" — we return the payload
 * only, because the wire shape carries mime separately.
 */
export function encodeBase64(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const r = new FileReader();
		r.onerror = () => reject(r.error ?? new Error('could not read file'));
		r.onload = () => {
			const s = typeof r.result === 'string' ? r.result : '';
			const comma = s.indexOf(',');
			resolve(comma >= 0 ? s.slice(comma + 1) : '');
		};
		r.readAsDataURL(blob);
	});
}

function loadBitmap(file: Blob): Promise<{ w: number; h: number; draw: CanvasImageSource; done: () => void }> {
	// createImageBitmap decodes off the main thread where available.
	if (typeof createImageBitmap === 'function') {
		return createImageBitmap(file).then((bmp) => ({
			w: bmp.width, h: bmp.height, draw: bmp, done: () => bmp.close(),
		}));
	}
	return new Promise((resolve, reject) => {
		const url = URL.createObjectURL(file);
		const img = new Image();
		img.onload = () => resolve({
			w: img.naturalWidth, h: img.naturalHeight, draw: img,
			done: () => URL.revokeObjectURL(url),
		});
		img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('could not decode image')); };
		img.src = url;
	});
}

export type PreparedImage = {
	dataB64: string;
	mime: string;
	/** Bytes actually sent, after any downscale. */
	sizeBytes: number;
	/** Set when the image was resized or re-encoded, for the UI to say so. */
	note?: string;
};

/**
 * Get an image under ATTACH_BUDGET_BYTES, downscaling and re-encoding as needed.
 *
 * Small images are passed through untouched — re-encoding a 40 KiB PNG as JPEG
 * would lose sharpness on exactly the screenshots people paste to ask about
 * text. Only images that would otherwise be REFUSED get touched, and then the
 * UI says so rather than silently changing what the user attached.
 */
export async function prepareImage(file: File): Promise<PreparedImage> {
	if (file.size <= ATTACH_BUDGET_BYTES) {
		return { dataB64: await encodeBase64(file), mime: file.type, sizeBytes: file.size };
	}

	const { w, h, draw, done } = await loadBitmap(file);
	try {
		const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(w, h));
		let width = Math.max(1, Math.round(w * scale));
		let height = Math.max(1, Math.round(h * scale));

		// Step down until it fits. Quality first, then dimensions — dropping
		// JPEG quality preserves legibility longer than shrinking does.
		for (const [q, shrink] of [[0.85, 1], [0.7, 1], [0.6, 0.75], [0.5, 0.6]] as const) {
			const cw = Math.max(1, Math.round(width * shrink));
			const ch = Math.max(1, Math.round(height * shrink));
			const canvas = document.createElement('canvas');
			canvas.width = cw;
			canvas.height = ch;
			const ctx = canvas.getContext('2d');
			if (!ctx) break;
			ctx.drawImage(draw, 0, 0, cw, ch);
			const blob: Blob | null = await new Promise((res) =>
				canvas.toBlob((b) => res(b), 'image/jpeg', q));
			if (!blob) break;
			if (blob.size <= ATTACH_BUDGET_BYTES) {
				return {
					dataB64: await encodeBase64(blob),
					mime: 'image/jpeg',
					sizeBytes: blob.size,
					note: `resized to ${cw}×${ch} to fit the ${Math.round(
						ATTACH_BUDGET_BYTES / 1024)}KB attachment limit`,
				};
			}
			width = cw;
			height = ch;
		}
	} finally {
		done();
	}
	// Everything tried and it still does not fit. Say so plainly rather than
	// sending something the server will refuse.
	throw new Error(
		`too large to send even after resizing — ${Math.round(file.size / 1024)}KB; ` +
		`the limit is about ${Math.round(ATTACH_BUDGET_BYTES / 1024)}KB`);
}
