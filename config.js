const SITE_PROFILE_STORAGE_KEY = "siteProfile";

const DEFAULT_SITE_PROFILE = {
	siteKey: "google_ai_studio",
	displayName: "Google AI Studio",
	baseUrl: "https://aistudio.google.com/prompts/new_chat",
	urlPattern: "https://aistudio.google.com/*",
	tempChatParam: "",
	selectors: {
		input: '[contenteditable="true"][role="textbox"], textarea, div[contenteditable="true"]',
		sendButton: 'button[aria-label*="Run" i], button[mattooltip*="Run" i], button[aria-label*="Send" i], button[aria-label*="Submit" i]',
		assistantMessage: '[data-turn-role="model"], [data-response-id], article[role="article"], [role="article"]',
		answerRoot: '.markdown, [class*="markdown"], .prose, [data-turn-role="model"], [data-response-id]',
		sourceLinks: 'a[href^="http"]'
	},
	capture: {
		mode: "dom_only",
		requestUrlPatterns: [
			"streamGenerateContent",
			"generateContent",
			"GenerateContent",
			"BardService",
			"server-stream"
		],
		jsonPaths: [
			"candidates.0.content.parts",
			"candidates.0.content.parts.0.text",
			"candidates.0.output.0.content.parts",
			"output.0.content.parts",
			"text"
		],
		domMaxAttempts: 90,
		domPollIntervalMs: 1200,
		sseReadyDelayMs: 1500
	},
	features: {
		supportsWebSearch: false
	},
	sourceExclusions: [
		"aistudio.google.com",
		"ai.google.dev",
		"accounts.google.com"
	]
};

function cloneValue(value) {
	return JSON.parse(JSON.stringify(value));
}

function normalizeString(value, fallback) {
	return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeBoolean(value, fallback) {
	return typeof value === "boolean" ? value : fallback;
}

function normalizePositiveInteger(value, fallback) {
	const numeric = Number(value);
	if (!Number.isFinite(numeric) || numeric <= 0) {
		return fallback;
	}

	return Math.round(numeric);
}

function normalizeStringList(value, fallback) {
	const rawEntries = Array.isArray(value)
		? value
		: typeof value === "string"
			? value.split(/\r?\n|,/)
			: [];

	const normalized = rawEntries
		.map((entry) => (typeof entry === "string" ? entry.trim() : ""))
		.filter(Boolean);

	return normalized.length > 0 ? normalized : [...fallback];
}

function normalizeSiteProfile(value) {
	const raw = value && typeof value === "object" ? value : {};
	const defaults = DEFAULT_SITE_PROFILE;

	return {
		siteKey: defaults.siteKey,
		displayName: defaults.displayName,
		baseUrl: normalizeString(raw.baseUrl, defaults.baseUrl),
		urlPattern: normalizeString(raw.urlPattern, defaults.urlPattern),
		tempChatParam:
			typeof raw.tempChatParam === "string" ? raw.tempChatParam : defaults.tempChatParam,
		selectors: {
			input: normalizeString(raw.selectors?.input, defaults.selectors.input),
			sendButton: normalizeString(raw.selectors?.sendButton, defaults.selectors.sendButton),
			assistantMessage: normalizeString(
				raw.selectors?.assistantMessage,
				defaults.selectors.assistantMessage
			),
			answerRoot: normalizeString(raw.selectors?.answerRoot, defaults.selectors.answerRoot),
			sourceLinks: normalizeString(raw.selectors?.sourceLinks, defaults.selectors.sourceLinks)
		},
		capture: {
			mode: ["dom_only", "stream_plus_dom"].includes(raw.capture?.mode)
				? raw.capture.mode
				: defaults.capture.mode,
			requestUrlPatterns: normalizeStringList(
				raw.capture?.requestUrlPatterns,
				defaults.capture.requestUrlPatterns
			),
			jsonPaths: normalizeStringList(raw.capture?.jsonPaths, defaults.capture.jsonPaths),
			domMaxAttempts: normalizePositiveInteger(
				raw.capture?.domMaxAttempts,
				defaults.capture.domMaxAttempts
			),
			domPollIntervalMs: normalizePositiveInteger(
				raw.capture?.domPollIntervalMs,
				defaults.capture.domPollIntervalMs
			),
			sseReadyDelayMs: normalizePositiveInteger(
				raw.capture?.sseReadyDelayMs,
				defaults.capture.sseReadyDelayMs
			)
		},
		features: {
			supportsWebSearch: normalizeBoolean(
				raw.features?.supportsWebSearch,
				defaults.features.supportsWebSearch
			)
		},
		sourceExclusions: normalizeStringList(raw.sourceExclusions, defaults.sourceExclusions)
	};
}

let siteProfileCache = normalizeSiteProfile(DEFAULT_SITE_PROFILE);

function getSiteProfile() {
	return normalizeSiteProfile(siteProfileCache);
}

function setSiteProfile(siteProfile) {
	siteProfileCache = normalizeSiteProfile(siteProfile);
	return getSiteProfile();
}

async function loadSiteProfile() {
	if (typeof chrome === "undefined" || !chrome.storage?.local) {
		return getSiteProfile();
	}

	try {
		const stored = await chrome.storage.local.get([SITE_PROFILE_STORAGE_KEY]);
		if (Object.prototype.hasOwnProperty.call(stored, SITE_PROFILE_STORAGE_KEY)) {
			siteProfileCache = normalizeSiteProfile(stored[SITE_PROFILE_STORAGE_KEY]);
		}
	} catch {
	}

	return getSiteProfile();
}

if (
	typeof chrome !== "undefined" &&
	chrome.storage?.onChanged &&
	!globalThis.__AUTOYEMINI_SITE_PROFILE_LISTENER__
) {
	chrome.storage.onChanged.addListener((changes, areaName) => {
		if (areaName !== "local" || !Object.prototype.hasOwnProperty.call(changes, SITE_PROFILE_STORAGE_KEY)) {
			return;
		}

		siteProfileCache = normalizeSiteProfile(changes[SITE_PROFILE_STORAGE_KEY].newValue);
	});

	globalThis.__AUTOYEMINI_SITE_PROFILE_LISTENER__ = true;
}

const CONFIG = {
	APP_VERSION: "1.0.0",
	APP_NAME: "AI Studio Workflow Assistant",
	DEFAULT_SITE_PROFILE: cloneValue(DEFAULT_SITE_PROFILE),
	normalizeSiteProfile,
	getSiteProfile,
	setSiteProfile,
	loadSiteProfile,

	TIMING: {
		BETWEEN_QUESTIONS_MS: [3500, 8000],
		PAGE_LOAD_WAIT_MS: 5000,
		CONTENT_SCRIPT_POLL_INTERVAL_MS: 1200,
		CONTENT_SCRIPT_MAX_ATTEMPTS: 25,
		SSE_READY_WAIT_MS: 2000,
		SUBMIT_WAIT_MS: [350, 700],
		INPUT_WAIT_MS: [120, 320],
		MENU_APPEAR_WAIT_MS: [1500, 2500],
		ANSWER_TIMEOUT_MS: 120000,
		ANSWER_POLL_ATTEMPTS: 12,
		ANSWER_POLL_INTERVAL_MS: 1000
	},

	ANTI_BOT: {
		TYPING_SPEED_MS: [30, 100],
		ERROR_PROBABILITY: 0.02,
		FATIGUE_AFTER_QUESTIONS: 10,
		FATIGUE_PAUSE_MS: [20000, 40000]
	},

	EXTRACTION: {
		DEFAULT_REGEX: "<extract>(.*?)</extract>",
		DEFAULT_PLACEHOLDER: "{{extract}}"
	},

	STORAGE_KEYS: {
		QUESTIONS: "questions",
		TEMPLATES: "savedTemplates",
		USE_TEMP_CHAT: "useTempChat",
		USE_WEB_SEARCH: "useWebSearch",
		KEEP_SAME_CHAT: "keepSameChat",
		SINGLE_PROMPT_MODE: "singlePromptMode",
		USE_EXTRACTION: "useExtraction",
		EXTRACTION_REGEX: "extractionRegex",
		INJECTION_PLACEHOLDER: "injectionPlaceholder",
		HUMAN_TYPING: "humanTyping",
		RANDOM_DELAYS: "randomDelays",
		BIOLOGICAL_PAUSES: "biologicalPauses",
		TYPING_SPEED: "typingSpeed",
		FATIGUE_COUNT: "fatigueCount",
		FATIGUE_MIN_PAUSE_MINUTES: "fatigueMinPauseMinutes",
		FATIGUE_MAX_PAUSE_MINUTES: "fatigueMaxPauseMinutes",
		PENDING_MESSAGE: "pendingMessage",
		WORKFLOWS: "savedWorkflows",
		SITE_PROFILE: SITE_PROFILE_STORAGE_KEY
	},

	LOG_MAX_ENTRIES: 100
};

globalThis.CONFIG = CONFIG;

if (typeof module !== "undefined" && module.exports) {
	module.exports = CONFIG;
}