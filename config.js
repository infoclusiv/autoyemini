const CONFIG = {
	APP_VERSION: "1.0.0",
	APP_NAME: "ChatGPT Batch Question Assistant",

	CHATGPT: {
		BASE_URL: "https://chatgpt.com/",
		TEMP_CHAT_PARAM: "?temporary-chat=true",
		URL_PATTERN: "https://chatgpt.com/*"
	},

	PROVIDERS: {
		chatgpt: {
			id: "chatgpt",
			label: "ChatGPT",
			BASE_URL: "https://chatgpt.com/",
			TEMP_CHAT_PARAM: "?temporary-chat=true",
			URL_PATTERN: "https://chatgpt.com/*",
			HOSTNAME: "chatgpt.com",
			supportsWebSearch: true,
			supportsTempChat: true,
			supportsSSE: true,
			isBuiltIn: true,
			selectors: {
				input: 'div[contenteditable="true"]#prompt-textarea',
				inputFallback1: 'textarea#prompt-textarea',
				inputFallback2: 'textarea[placeholder]',
				submitButton: 'button#composer-submit-button, button[data-testid="send-button"]',
				stopButton: 'button[data-testid="stop-button"], button[aria-label*="Stop"]',
				responseContainer: 'div[data-message-author-role="assistant"]',
				responseContainerFallback1: 'article[data-testid^="conversation-turn-"] .markdown',
				responseContainerFallback2: 'article[data-testid^="conversation-turn-"] [class*="markdown"], article[data-testid^="conversation-turn-"] .prose',
				loadingIndicator: 'button[data-testid="stop-button"], button[aria-label*="Stop"]',
				submitMethod: "enter"
			}
		}
	},

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
		CUSTOM_PROVIDERS: "customProviders",
		BUILTIN_PROVIDER_OVERRIDES: "builtinProviderOverrides"
	},

	LOG_MAX_ENTRIES: 100
};

globalThis.CONFIG = CONFIG;

if (typeof module !== "undefined" && module.exports) {
	module.exports = CONFIG;
}