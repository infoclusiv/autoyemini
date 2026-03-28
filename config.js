const CONFIG = {
	APP_VERSION: "1.0.0",
	APP_NAME: "ChatGPT Batch Question Assistant",

	CHATGPT: {
		BASE_URL: "https://chatgpt.com/",
		TEMP_CHAT_PARAM: "?temporary-chat=true",
		URL_PATTERN: "https://chatgpt.com/*"
	},

	TIMING: {
		BETWEEN_QUESTIONS_MS: 3000,
		PAGE_LOAD_WAIT_MS: 5000,
		CONTENT_SCRIPT_POLL_INTERVAL_MS: 1200,
		CONTENT_SCRIPT_MAX_ATTEMPTS: 25,
		SSE_READY_WAIT_MS: 2000,
		SUBMIT_WAIT_MS: 500,
		INPUT_WAIT_MS: 300,
		MENU_APPEAR_WAIT_MS: 2000,
		ANSWER_TIMEOUT_MS: 120000,
		ANSWER_POLL_ATTEMPTS: 12,
		ANSWER_POLL_INTERVAL_MS: 1000
	},

	STORAGE_KEYS: {
		QUESTIONS: "questions",
		USE_TEMP_CHAT: "useTempChat",
		USE_WEB_SEARCH: "useWebSearch",
		KEEP_SAME_CHAT: "keepSameChat",
		PENDING_MESSAGE: "pendingMessage"
	},

	LOG_MAX_ENTRIES: 100
};

globalThis.CONFIG = CONFIG;

if (typeof module !== "undefined" && module.exports) {
	module.exports = CONFIG;
}