(function () {
    "use strict";

    const PROMPT_IDS = [
        "txt2img_prompt",
        "txt2img_neg_prompt",
        "img2img_prompt",
        "img2img_neg_prompt",
        "hires_prompt",
        "hires_neg_prompt",
    ];

    const WILDCARD_DEFAULT_WRAP = "__";
    const RE_LORA_POSITIVE = /<lora:[^:>]+:[\d.]+>/gi;
    const RE_LORA_NEGATIVE = /\(lora:[\d.]+\)/gi;

    const STYLE_PROPS = [
        "fontFamily",
        "fontSize",
        "fontWeight",
        "fontStyle",
        "lineHeight",
        "letterSpacing",
        "wordSpacing",
        "textIndent",
        "paddingTop",
        "paddingRight",
        "paddingBottom",
        "paddingLeft",
        "borderTopWidth",
        "borderRightWidth",
        "borderBottomWidth",
        "borderLeftWidth",
        "boxSizing",
        "tabSize",
    ];

    const boundHighlights = [];

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

    function escapeRegex(text) {
        return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    function buildWildcardRegex() {
        const wrap = getWildcardWrap();
        const esc = escapeRegex(wrap);
        return new RegExp(esc + ".+?" + esc, "g");
    }

    function escapeHtml(text) {
        return text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function isNegativePromptId(id) {
        return id.includes("neg");
    }

    function collectMatches(text, isNegative) {
        const matches = [];

        const wildRe = buildWildcardRegex();
        let m;
        while ((m = wildRe.exec(text)) !== null) {
            matches.push({
                start: m.index,
                end: m.index + m[0].length,
                type: "wildcard",
            });
        }

        const loraRe = isNegative ? RE_LORA_NEGATIVE : RE_LORA_POSITIVE;
        loraRe.lastIndex = 0;
        while ((m = loraRe.exec(text)) !== null) {
            matches.push({
                start: m.index,
                end: m.index + m[0].length,
                type: "lora",
            });
        }

        if (!isNegative) {
            RE_LORA_NEGATIVE.lastIndex = 0;
            while ((m = RE_LORA_NEGATIVE.exec(text)) !== null) {
                matches.push({
                    start: m.index,
                    end: m.index + m[0].length,
                    type: "lora",
                });
            }
        }

        matches.sort((a, b) => a.start - b.start || b.end - a.end);

        const merged = [];
        let cursor = 0;
        for (const match of matches) {
            if (match.start < cursor) continue;
            merged.push(match);
            cursor = match.end;
        }
        return merged;
    }

    function buildHighlightedHtml(text, isNegative) {
        const matches = collectMatches(text, isNegative);
        if (matches.length === 0) {
            return escapeHtml(text);
        }

        let html = "";
        let pos = 0;

        for (const match of matches) {
            if (match.start > pos) {
                html += escapeHtml(text.slice(pos, match.start));
            }

            const chunk = escapeHtml(text.slice(match.start, match.end));
            const cls =
                match.type === "wildcard"
                    ? "gen-layout-prompt-wildcard"
                    : "gen-layout-prompt-lora";
            html += `<span class="${cls}">${chunk}</span>`;
            pos = match.end;
        }

        if (pos < text.length) {
            html += escapeHtml(text.slice(pos));
        }

        return html;
    }

    function syncBackdropStyles(textarea, backdrop) {
        const cs = getComputedStyle(textarea);
        for (const prop of STYLE_PROPS) {
            backdrop.style[prop] = cs[prop];
        }
    }

    function syncBackdropScroll(textarea, backdrop) {
        backdrop.style.transform = `translate(${-textarea.scrollLeft}px, ${-textarea.scrollTop}px)`;
    }

    function refreshHighlight(textarea, backdrop, isNegative) {
        syncBackdropStyles(textarea, backdrop);
        backdrop.innerHTML = buildHighlightedHtml(textarea.value, isNegative);
        syncBackdropScroll(textarea, backdrop);
    }

    function setupPromptHighlight(id) {
        const app = gradioApp();
        if (!app) return;

        const textarea = app.querySelector(`#${id} > label > textarea`);
        if (!textarea) return;

        const label = textarea.parentElement;
        if (!label || label.dataset.genLayoutPromptHighlight === "1") return;

        const backdrop = document.createElement("div");
        backdrop.className = "gen-layout-prompt-highlight-backdrop";
        backdrop.setAttribute("aria-hidden", "true");

        label.classList.add("gen-layout-prompt-highlight-wrap");
        label.insertBefore(backdrop, textarea);
        label.dataset.genLayoutPromptHighlight = "1";

        const isNegative = isNegativePromptId(id);

        const update = function () {
            refreshHighlight(textarea, backdrop, isNegative);
        };

        textarea.addEventListener("input", update);
        textarea.addEventListener("scroll", update);

        boundHighlights.push({ textarea, backdrop, isNegative, update });
        update();
    }

    function setupAllPromptHighlights() {
        for (let i = boundHighlights.length - 1; i >= 0; i--) {
            if (!boundHighlights[i].textarea.isConnected) {
                boundHighlights.splice(i, 1);
            }
        }

        for (const id of PROMPT_IDS) {
            setupPromptHighlight(id);
        }
    }

    function refreshAllHighlights() {
        for (const entry of boundHighlights) {
            if (!entry.textarea.isConnected) continue;
            entry.update();
        }
    }

    onUiLoaded(setupAllPromptHighlights);
    onAfterUiUpdate(setupAllPromptHighlights);

    if (typeof onOptionsChanged === "function") {
        onOptionsChanged(refreshAllHighlights);
    }
})();
