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

            updatePromptArea(text, textarea, isNeg);
        };
        patched._genLayoutFocusPatched = true;
        window.cardClicked = patched;
    }

    function initPromptFocus() {
        patchCardClicked();
        setupPromptFocusTracking();
    }

    onUiLoaded(initPromptFocus);
    onAfterUiUpdate(setupPromptFocusTracking);
})();
