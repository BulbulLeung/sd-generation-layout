(function () {
    "use strict";

    const PROMPT_TAB_MAP = {
        txt2img_prompt: "txt2img",
        txt2img_neg_prompt: "txt2img",
        hires_prompt: "txt2img",
        hires_neg_prompt: "txt2img",
        img2img_prompt: "img2img",
        img2img_neg_prompt: "img2img",
    };

    const TAB_NAMES = ["txt2img", "img2img"];
    const WILDCARD_DEFAULT_WRAP = "__";
    const WILDCARD_SEPARATOR = ", ";

    function getTextSeparator() {
        if (
            typeof opts !== "undefined" &&
            opts.extra_networks_add_text_separator != null
        ) {
            return String(opts.extra_networks_add_text_separator);
        }
        return ", ";
    }

    function getWildcardWrap() {
        if (
            typeof opts !== "undefined" &&
            opts.dp_parser_wildcard_wrap != null &&
            String(opts.dp_parser_wildcard_wrap).length > 0
        ) {
            return String(opts.dp_parser_wildcard_wrap);
        }
        return WILDCARD_DEFAULT_WRAP;
    }

    function wildcardTokenFromName(name) {
        const wrap = getWildcardWrap();
        return wrap + name + wrap;
    }

    function getPromptTextarea(id) {
        const app = gradioApp();
        if (!app) return null;

        const root = app.querySelector("#" + id);
        if (!root) return null;

        return root.querySelector(
            ":scope > label > textarea, :scope > label > .gen-layout-prompt-highlight-layer > textarea",
        );
    }

    function getActivePromptTextarea(tabname) {
        if (
            typeof activePromptTextarea !== "undefined" &&
            activePromptTextarea[tabname] &&
            activePromptTextarea[tabname].isConnected
        ) {
            return activePromptTextarea[tabname];
        }
        return getPromptTextarea(tabname + "_prompt");
    }

    function isNegativePromptTextarea(textarea) {
        if (!textarea) return false;

        const block = textarea.closest("[id$='_prompt'], [id$='_neg_prompt']");
        if (block && block.id.includes("neg")) {
            return true;
        }

        return textarea.id.includes("neg");
    }

    function getPromptInsertIndex(textarea) {
        const value = textarea.value;
        const cursor =
            typeof textarea.selectionStart === "number"
                ? textarea.selectionStart
                : value.length;
        const lineStart = value.lastIndexOf("\n", cursor - 1) + 1;
        const linePrefix = value.slice(lineStart, cursor);
        const commaIdx = linePrefix.lastIndexOf(",");
        if (commaIdx >= 0) {
            let pos = lineStart + commaIdx + 1;
            while (pos < value.length && value[pos] === " ") {
                pos++;
            }
            return pos;
        }
        return cursor;
    }

    function endsWithCommaSegment(text) {
        return /,\s*$/.test(text);
    }

    function insertPromptText(textarea, text, isNeg) {
        if (
            typeof tryToRemoveExtraNetworkFromPrompt === "function" &&
            tryToRemoveExtraNetworkFromPrompt(textarea, text, isNeg)
        ) {
            updateInput(textarea);
            return;
        }

        const value = textarea.value;
        const cursor =
            typeof textarea.selectionStart === "number"
                ? textarea.selectionStart
                : value.length;
        const insertAt = getPromptInsertIndex(textarea);
        const before = value.slice(0, insertAt);
        const after = value.slice(insertAt);
        const sep = getTextSeparator();
        const snappedToComma = insertAt !== cursor;

        let insert = text;

        if (before.length > 0 && (snappedToComma || after.length === 0)) {
            if (!before.endsWith(",") && !endsWithCommaSegment(before)) {
                insert = sep + insert;
            }
        }

        if (after.length > 0 && (snappedToComma || before.length === 0)) {
            if (!/^\s*,/.test(after)) {
                insert = insert + sep;
            }
        }

        textarea.value = before + insert + after;
        const caret = before.length + insert.length;
        textarea.selectionStart = caret;
        textarea.selectionEnd = caret;
        updateInput(textarea);
    }

    function promptContainsWildcardToken(prompt, token) {
        return prompt.indexOf(token) >= 0;
    }

    function removeWildcardTokenFromPrompt(prompt, token) {
        if (!promptContainsWildcardToken(prompt, token)) {
            return prompt;
        }

        const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const patterns = [
            new RegExp(escaped + "\\s*,\\s*", "g"),
            new RegExp(escaped, "g"),
        ];

        let result = prompt;
        for (let i = 0; i < patterns.length; i++) {
            const next = result.replace(patterns[i], "");
            if (next !== result) {
                result = next;
                break;
            }
        }

        return result.replace(/\s{2,}/g, " ").trim();
    }

    function formatWildcardInsert(token) {
        if (endsWithCommaSegment(token)) {
            return token;
        }
        return token + WILDCARD_SEPARATOR;
    }

    function recalculatePrompts(tabname) {
        if (
            tabname === "txt2img" &&
            typeof recalculate_prompts_txt2img === "function"
        ) {
            recalculate_prompts_txt2img();
        } else if (
            tabname === "img2img" &&
            typeof recalculate_prompts_img2img === "function"
        ) {
            recalculate_prompts_img2img();
        }
    }

    function toggleWildcardToken(tabname, token) {
        const textarea = getActivePromptTextarea(tabname);
        if (!textarea || !token) return;

        const current = textarea.value || "";
        if (promptContainsWildcardToken(current, token)) {
            textarea.value = removeWildcardTokenFromPrompt(current, token);
            updateInput(textarea);
        } else {
            insertPromptText(textarea, formatWildcardInsert(token), false);
        }

        recalculatePrompts(tabname);
    }

    function setupPromptFocusTracking() {
        if (typeof activePromptTextarea === "undefined") return;

        for (const [id, tab] of Object.entries(PROMPT_TAB_MAP)) {
            const textarea = getPromptTextarea(id);
            if (!textarea) continue;

            if (textarea.dataset.genLayoutFocusBound === "1") continue;
            textarea.dataset.genLayoutFocusBound = "1";

            textarea.addEventListener("focus", function () {
                activePromptTextarea[tab] = textarea;
            });
        }

        for (const tab of TAB_NAMES) {
            if (
                activePromptTextarea[tab] &&
                activePromptTextarea[tab].isConnected
            ) {
                continue;
            }

            const fallback = getPromptTextarea(tab + "_prompt");
            if (fallback) {
                activePromptTextarea[tab] = fallback;
            }
        }
    }

    function patchCardClicked() {
        if (typeof window.cardClicked !== "function") return;
        if (window.cardClicked._genLayoutFocusPatched) return;

        const original = window.cardClicked;
        const patched = function (
            tabname,
            textToAdd,
            textToAddNegative,
            allowNegativePrompt,
        ) {
            const textarea = getActivePromptTextarea(tabname);
            if (!textarea) {
                return original(
                    tabname,
                    textToAdd,
                    textToAddNegative,
                    allowNegativePrompt,
                );
            }

            const isNeg = isNegativePromptTextarea(textarea);
            const text =
                isNeg && textToAddNegative.length > 0
                    ? textToAddNegative
                    : textToAdd;

            insertPromptText(textarea, text, isNeg);
        };
        patched._genLayoutFocusPatched = true;
        window.cardClicked = patched;
    }

    function wildcardTabnameFromContainer(container) {
        if (!container || !container.id) return null;
        const match = container.id.match(/^(txt2img|img2img)_wildcard_cards$/);
        return match ? match[1] : null;
    }

    function onWildcardCardClick(event) {
        const card = event.target.closest(".card");
        if (!card) return;

        const container = card.closest('[id$="_wildcard_cards"]');
        if (!container) return;

        if (event.target.closest(".button-row")) return;

        const tabname = wildcardTabnameFromContainer(container);
        const name = card.getAttribute("data-name");
        if (!tabname || !name) return;

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        const token = wildcardTokenFromName(name);
        toggleWildcardToken(tabname, token);
    }

    function setupWildcardInsertPatch() {
        const app = gradioApp();
        if (!app) return;

        for (const tab of TAB_NAMES) {
            const container = app.querySelector("#" + tab + "_wildcard_cards");
            if (!container || container.dataset.genLayoutWildcardInsert === "1") {
                continue;
            }

            container.dataset.genLayoutWildcardInsert = "1";
            container.addEventListener("click", onWildcardCardClick, true);
        }
    }

    function initPromptFocus() {
        patchCardClicked();
        setupPromptFocusTracking();
        setupWildcardInsertPatch();
    }

    onUiLoaded(initPromptFocus);
    onAfterUiUpdate(function () {
        setupPromptFocusTracking();
        setupWildcardInsertPatch();
    });
})();
