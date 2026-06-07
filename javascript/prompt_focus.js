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

    function getPromptInsertContext(textarea) {
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
            return { insertAt: pos, mode: "afterComma", cursor: cursor };
        }
        return { insertAt: lineStart, mode: "lineStart", cursor: cursor };
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
        const { insertAt, mode, cursor } = getPromptInsertContext(textarea);
        const before = value.slice(0, insertAt);
        const after = value.slice(insertAt);
        const sep = getTextSeparator();

        let insert = text;

        if (mode === "lineStart") {
            insert = insert + sep;
        } else {
            const snappedToComma = insertAt !== cursor;

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

    function getLineIndexForPos(text, pos) {
        if (pos <= 0) {
            return 0;
        }
        return text.slice(0, pos).split("\n").length - 1;
    }

    function removeTokenFromLine(line, token) {
        if (!promptContainsWildcardToken(line, token)) {
            return {
                line: line,
                removedStart: -1,
                removedEnd: -1,
            };
        }

        const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const patterns = [
            new RegExp(escaped + "[ \\t]*,[ \\t]*"),
            new RegExp(escaped),
        ];

        let result = line;
        let removedStart = -1;
        let removedEnd = -1;

        for (let i = 0; i < patterns.length; i++) {
            const match = patterns[i].exec(line);
            if (match) {
                removedStart = match.index;
                removedEnd = match.index + match[0].length;
                result = line.replace(patterns[i], "");
                break;
            }
        }

        result = result.replace(/[ \t]{2,}/g, " ").trimEnd();
        if (result.length > 0 && !result.endsWith(",")) {
            result += ",";
        }

        return {
            line: result,
            removedStart: removedStart,
            removedEnd: removedEnd,
        };
    }

    function mapCaretInLine(
        oldLine,
        newLine,
        posInLine,
        removedStart,
        removedEnd,
    ) {
        if (removedStart < 0) {
            return Math.min(Math.max(0, posInLine), newLine.length);
        }

        if (posInLine >= oldLine.length) {
            return newLine.length;
        }

        let pos = posInLine;
        if (pos <= removedStart) {
            pos = posInLine;
        } else if (pos >= removedEnd) {
            pos -= removedEnd - removedStart;
        } else {
            pos = removedStart;
        }

        return Math.max(0, Math.min(pos, newLine.length));
    }

    function findTokenLine(lines, token, cursorLine) {
        let fallbackLine = -1;

        for (let i = 0; i < lines.length; i++) {
            if (!promptContainsWildcardToken(lines[i], token)) {
                continue;
            }
            if (i === cursorLine) {
                return i;
            }
            if (fallbackLine < 0) {
                fallbackLine = i;
            }
        }

        return fallbackLine;
    }

    function mapSelectionAfterRemove(
        lines,
        processed,
        selectionPos,
        tokenLine,
        cursorLine,
    ) {
        let oldPos = 0;
        let newPos = 0;

        for (let i = 0; i < lines.length; i++) {
            const oldLine = lines[i];
            const entry = processed[i];
            const newLine = entry.line;

            if (i === tokenLine) {
                const posInLine =
                    cursorLine === tokenLine
                        ? selectionPos - oldPos
                        : entry.removedStart >= 0
                          ? entry.removedStart
                          : 0;
                return (
                    newPos +
                    mapCaretInLine(
                        oldLine,
                        newLine,
                        posInLine,
                        entry.removedStart,
                        entry.removedEnd,
                    )
                );
            }

            oldPos += oldLine.length + (i < lines.length - 1 ? 1 : 0);
            newPos += newLine.length + (i < processed.length - 1 ? 1 : 0);
        }

        return newPos;
    }

    function removeWildcardTokenFromPromptWithCaret(
        prompt,
        token,
        selectionStart,
        selectionEnd,
    ) {
        if (!promptContainsWildcardToken(prompt, token)) {
            return {
                text: prompt,
                caret: selectionStart,
                caretEnd: selectionEnd,
            };
        }

        const normalized = prompt.replace(/\r\n/g, "\n");
        const lines = normalized.split("\n");
        const cursorLine = getLineIndexForPos(normalized, selectionStart);
        const tokenLine = findTokenLine(lines, token, cursorLine);

        const processed = lines.map(function (line) {
            return removeTokenFromLine(line, token);
        });
        const newLines = processed.map(function (entry) {
            return entry.line;
        });
        const text = newLines.join("\n");

        let caret = mapSelectionAfterRemove(
            lines,
            processed,
            selectionStart,
            tokenLine,
            cursorLine,
        );
        let caretEnd = mapSelectionAfterRemove(
            lines,
            processed,
            selectionEnd,
            tokenLine,
            cursorLine,
        );

        caret = Math.max(0, Math.min(caret, text.length));
        caretEnd = Math.max(0, Math.min(caretEnd, text.length));
        if (caretEnd < caret) {
            caretEnd = caret;
        }

        return {
            text: text,
            caret: caret,
            caretEnd: caretEnd,
        };
    }

    function removeWildcardTokenFromPrompt(prompt, token) {
        return removeWildcardTokenFromPromptWithCaret(
            prompt,
            token,
            prompt.length,
            prompt.length,
        ).text;
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
            const selStart =
                typeof textarea.selectionStart === "number"
                    ? textarea.selectionStart
                    : current.length;
            const selEnd =
                typeof textarea.selectionEnd === "number"
                    ? textarea.selectionEnd
                    : selStart;
            const result = removeWildcardTokenFromPromptWithCaret(
                current,
                token,
                selStart,
                selEnd,
            );
            textarea.value = result.text;
            textarea.focus();
            textarea.selectionStart = result.caret;
            textarea.selectionEnd = result.caretEnd;
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
