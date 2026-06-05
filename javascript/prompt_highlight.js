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
        "borderStyle",
        "borderTopColor",
        "borderRightColor",
        "borderBottomColor",
        "borderLeftColor",
        "boxSizing",
        "tabSize",
        "width",
        "whiteSpace",
        "wordBreak",
        "overflowWrap",
    ];

    const LAYER_STYLE_PROPS = [
        "borderRadius",
        "borderTopLeftRadius",
        "borderTopRightRadius",
        "borderBottomRightRadius",
        "borderBottomLeftRadius",
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

    function getScrollTargets(textarea) {
        const targets = [textarea];
        const textbox = textarea.closest(".gradio-textbox.prompt");
        if (!textbox) return targets;

        const overflowY = getComputedStyle(textbox).overflowY;
        if (
            (overflowY === "auto" || overflowY === "scroll") &&
            !targets.includes(textbox)
        ) {
            targets.push(textbox);
        }
        return targets;
    }

    function syncLayerStyles(textarea, layer) {
        if (!layer) return;
        const cs = getComputedStyle(textarea);
        for (const prop of LAYER_STYLE_PROPS) {
            layer.style[prop] = cs[prop];
        }
    }

    function syncInnerStyles(textarea, inner) {
        const cs = getComputedStyle(textarea);
        for (const prop of STYLE_PROPS) {
            inner.style[prop] = cs[prop];
        }
        inner.style.removeProperty("color");
    }

    function syncBackdropScroll(textarea, inner) {
        inner.style.transform = `translate(${-textarea.scrollLeft}px, ${-textarea.scrollTop}px)`;
    }

    function refreshHighlight(textarea, inner, layer, isNegative) {
        syncLayerStyles(textarea, layer);
        syncInnerStyles(textarea, inner);
        inner.innerHTML = buildHighlightedHtml(textarea.value, isNegative);
        syncBackdropScroll(textarea, inner);
    }

    function findPromptTextarea(app, id) {
        const root = app.querySelector(`#${id}`);
        if (!root) return null;
        return root.querySelector(
            ":scope > label > textarea, :scope > label > .gen-layout-prompt-highlight-layer > textarea",
        );
    }

    function setupPromptHighlight(id) {
        const app = gradioApp();
        if (!app) return;

        const textarea = findPromptTextarea(app, id);
        if (!textarea) return;

        const label = textarea.closest("label");
        if (!label || label.dataset.genLayoutPromptHighlight === "1") return;

        let layer = textarea.closest(".gen-layout-prompt-highlight-layer");

        const backdrop = document.createElement("div");
        backdrop.className = "gen-layout-prompt-highlight-backdrop";
        backdrop.setAttribute("aria-hidden", "true");

        const inner = document.createElement("div");
        inner.className = "inner";
        backdrop.appendChild(inner);

        label.classList.add("gen-layout-prompt-highlight-wrap");
        label.dataset.genLayoutPromptHighlight = "1";

        if (!layer && textarea.parentElement === label) {
            layer = document.createElement("div");
            layer.className = "gen-layout-prompt-highlight-layer";
            layer.appendChild(backdrop);
            layer.appendChild(textarea);
            label.appendChild(layer);
        } else if (layer) {
            layer.insertBefore(backdrop, textarea);
        } else {
            return;
        }

        const isNegative = isNegativePromptId(id);
        const scrollTargets = getScrollTargets(textarea);

        const update = function () {
            refreshHighlight(textarea, inner, layer, isNegative);
        };

        textarea.addEventListener("input", update);
        for (const target of scrollTargets) {
            target.addEventListener("scroll", update);
        }

        if (typeof ResizeObserver !== "undefined") {
            const resizeObserver = new ResizeObserver(update);
            resizeObserver.observe(textarea);
            boundHighlights.push({
                textarea,
                inner,
                layer,
                isNegative,
                update,
                resizeObserver,
            });
        } else {
            boundHighlights.push({ textarea, inner, layer, isNegative, update });
        }

        update();
    }

    function setupAllPromptHighlights() {
        for (let i = boundHighlights.length - 1; i >= 0; i--) {
            const entry = boundHighlights[i];
            if (!entry.textarea.isConnected) {
                entry.resizeObserver?.disconnect();
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
