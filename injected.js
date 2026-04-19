(function interceptFetchForSSE() {
	const originalFetch = window.fetch;

	function getSiteProfileCapture() {
		try {
			const rawProfile = document.documentElement?.dataset?.autoyeminiSiteProfile;
			const parsed = rawProfile ? JSON.parse(rawProfile) : {};
			return parsed?.capture || {};
		} catch {
			return {};
		}
	}

	function resolveRequestUrl(resource) {
		if (typeof resource === "string") {
			return resource;
		}
		if (resource instanceof Request) {
			return resource.url;
		}
		if (resource instanceof URL) {
			return resource.href;
		}
		if (resource && typeof resource === "object" && resource.url) {
			return resource.url;
		}
		return "";
	}

	function isConversationRequest(url) {
		const patterns = getSiteProfileCapture().requestUrlPatterns;
		return Array.isArray(patterns) && patterns.some((segment) => typeof segment === "string" && segment && url.includes(segment));
	}

	function dispatchLine(line) {
		if (!line) {
			return;
		}

		if (line === "data: [DONE]" || line === "[DONE]") {
			window.postMessage({ type: "SSE_DONE" }, "*");
			return;
		}

		const normalizedLine = line.startsWith("data: ") ? line.substring(6) : line;
		if (!normalizedLine) {
			return;
		}

		try {
			const payload = JSON.parse(normalizedLine);
			window.postMessage({ type: "SSE_DATA", data: payload }, "*");
		} catch {
		}
	}

	async function forwardStream(response) {
		const clonedResponse = response.clone();
		if (!clonedResponse.body) {
			return response;
		}

		const reader = clonedResponse.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					if (buffer.trim()) {
						dispatchLine(buffer.trim());
					}
					break;
				}

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";
				lines.forEach((line) => dispatchLine(line.trim()));
			}
		} catch (error) {
			window.postMessage({ type: "SSE_ERROR", error: error.message }, "*");
		}

		window.postMessage({ type: "SSE_STREAM_END" }, "*");
		return response;
	}

	window.fetch = async function patchedFetch(...args) {
		const url = resolveRequestUrl(args[0]);
		if (!isConversationRequest(url)) {
			return originalFetch.apply(this, args);
		}

		const response = await originalFetch.apply(this, args);
		if (!response.ok || !response.body) {
			return response;
		}

		void forwardStream(response);
		return response;
	};
})();