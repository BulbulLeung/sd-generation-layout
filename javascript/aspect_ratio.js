(function () {
    "use strict";

    const TABS = ["txt2img", "img2img"];

    const RATIO_KEYS = ["custom", "1:1", "3:2", "4:3", "5:4", "16:9", "21:9"];

    const RATIOS = {
        custom: null,
        "1:1": [1, 1],
        "3:2": [3, 2],
        "4:3": [4, 3],
        "5:4": [5, 4],
        "16:9": [16, 9],
        "21:9": [21, 9],
    };

    const RATIO_MATCH_EPS = 0.02;
    const tabState = {};
    let outsideCloseBound = false;

    function isInteractionLocked() {
        return !!gradioApp()?.querySelector(".gen-layout-aspect-dropdown.open");
    }

    function getState(tab) {
        if (!tabState[tab]) {
            tabState[tab] = {
                ratioKey: "custom",
                swapped: false,
                syncing: false,
            };
        }
        return tabState[tab];
    }

    function getNumberInput(tab, dim) {
        return gradioApp().querySelector(`#${tab}_${dim} input[type=number]`);
    }

    function getRangeInput(tab, dim) {
        return gradioApp().querySelector(`#${tab}_${dim} input[type=range]`);
    }

    function getSliderMeta(tab) {
        const range = getRangeInput(tab, "width") || getRangeInput(tab, "height");
        if (!range) {
            return { step: 8, min: 64, max: 2048 };
        }
        return {
            step: parseFloat(range.step) || 8,
            min: parseFloat(range.min) || 64,
            max: parseFloat(range.max) || 2048,
        };
    }

    function snapToStep(value, meta) {
        const stepped = Math.round(value / meta.step) * meta.step;
        return Math.min(meta.max, Math.max(meta.min, stepped));
    }

    function readDim(tab, dim) {
        const input = getNumberInput(tab, dim);
        if (!input) return 0;
        return parseFloat(input.value) || 0;
    }

    function writeDim(tab, dim, value) {
        const input = getNumberInput(tab, dim);
        const range = getRangeInput(tab, dim);
        if (!input) return;

        const str = String(value);
        input.value = str;
        if (range) range.value = str;
        updateInput(input);
        if (range && range !== input) updateInput(range);
    }

    function onDimensionInput(tab, state, ui, dim) {
        if (state.syncing) return;
        if (state.ratioKey === "custom") return;
        if (dim === "width") applyRatioFromWidth(tab, state, ui);
        else applyRatioFromHeight(tab, state, ui);
    }

    function onDimensionChange(tab, state, ui, swapToggle, dim) {
        if (state.syncing) return;
        if (state.ratioKey !== "custom") {
            if (dim === "width") applyRatioFromWidth(tab, state, ui);
            else applyRatioFromHeight(tab, state, ui);
            return;
        }
        const detected = detectRatioState(readDim(tab, "width"), readDim(tab, "height"));
        if (
            detected.ratioKey !== state.ratioKey ||
            detected.swapped !== state.swapped
        ) {
            applyRatioState(
                state,
                ui,
                swapToggle,
                detected.ratioKey,
                detected.swapped,
                true,
            );
        }
    }

    function bindDimControlListeners(tab, state, ui, swapToggle, elements, dim) {
        const seen = new Set();
        for (const el of elements) {
            if (!el || seen.has(el)) continue;
            seen.add(el);
            el.addEventListener("input", function () {
                onDimensionInput(tab, state, ui, dim);
            });
            el.addEventListener("change", function () {
                onDimensionChange(tab, state, ui, swapToggle, dim);
            });
        }
    }

    function getActiveRatio(state) {
        const pair = RATIOS[state.ratioKey];
        if (!pair) return null;
        return state.swapped ? [pair[1], pair[0]] : [pair[0], pair[1]];
    }

    function ratioLabelForKey(key, swapped) {
        if (key === "custom") return "Custom";
        const pair = RATIOS[key];
        if (!pair) return key;
        return swapped ? `${pair[1]}:${pair[0]}` : `${pair[0]}:${pair[1]}`;
    }

    function detectRatioState(width, height) {
        if (!width || !height) {
            return { ratioKey: "custom", swapped: false };
        }

        const ratio = width / height;
        let bestKey = "custom";
        let bestSwapped = false;
        let bestDiff = Infinity;

        for (const key of RATIO_KEYS) {
            if (key === "custom") continue;
            const [rw, rh] = RATIOS[key];
            const forward = rw / rh;
            const reverse = rh / rw;
            const forwardDiff = Math.abs(ratio - forward);
            const reverseDiff = Math.abs(ratio - reverse);

            if (forwardDiff < bestDiff) {
                bestDiff = forwardDiff;
                bestKey = key;
                bestSwapped = false;
            }
            if (reverseDiff < bestDiff) {
                bestDiff = reverseDiff;
                bestKey = key;
                bestSwapped = true;
            }
        }

        if (bestDiff <= RATIO_MATCH_EPS) {
            return { ratioKey: bestKey, swapped: bestSwapped };
        }

        return { ratioKey: "custom", swapped: false };
    }

    function closeAllDropdowns() {
        for (const el of gradioApp().querySelectorAll(".gen-layout-aspect-dropdown.open")) {
            closeDropdown(el);
        }
    }

    function getOptionsList(dropdown) {
        return dropdown?._genLayoutAspectOptionsList || findDropdownOptionsList(dropdown);
    }

    function getDropdownAnchor(dropdown) {
        const input = findDropdownDisplayInput(dropdown);
        return (
            input?.closest(".wrap-inner") ||
            input?.closest(".wrap:not(.hide)") ||
            input ||
            dropdown
        );
    }

    const ASPECT_DROPDOWN_WIDTH_PX = 100;

    function getAspectDropdownWidthPx(dropdown) {
        const root = dropdown?.closest(".gen-layout-aspect-controls");
        if (root) {
            const raw = getComputedStyle(root)
                .getPropertyValue("--gen-layout-aspect-width")
                .trim();
            const parsed = parseFloat(raw);
            if (!Number.isNaN(parsed) && parsed > 0) return parsed;
        }
        return ASPECT_DROPDOWN_WIDTH_PX;
    }

    function positionFloatingOptionsList(anchor, list, dropdown) {
        if (!anchor || !list) return;
        const rect = anchor.getBoundingClientRect();
        const widthPx = getAspectDropdownWidthPx(
            dropdown || anchor.closest(".gen-layout-aspect-dropdown"),
        );
        list.style.position = "fixed";
        list.style.top = `${rect.bottom}px`;
        list.style.left = `${rect.left}px`;
        list.style.width = `${widthPx}px`;
        list.style.minWidth = `${widthPx}px`;
        list.style.maxWidth = `${widthPx}px`;
        list.style.zIndex = "3000";
    }

    function mountFloatingOptionsList(dropdown, list) {
        if (!dropdown || !list) return;
        document.body.appendChild(list);
        positionFloatingOptionsList(getDropdownAnchor(dropdown), list, dropdown);
    }

    function unmountFloatingOptionsList(dropdown, list) {
        if (!dropdown || !list) return;
        const home = dropdown._genLayoutAspectOptionsHome;
        list.style.position = "";
        list.style.top = "";
        list.style.left = "";
        list.style.minWidth = "";
        list.style.width = "";
        list.style.maxWidth = "";
        list.style.zIndex = "";
        if (home && list.parentElement !== home) {
            home.appendChild(list);
        }
    }

    function bindRepositionWhileOpen(dropdown, list) {
        const reposition = function () {
            if (!dropdown.classList.contains("open")) return;
            positionFloatingOptionsList(getDropdownAnchor(dropdown), list, dropdown);
        };
        dropdown._genLayoutReposition = reposition;
        window.addEventListener("scroll", reposition, true);
        window.addEventListener("resize", reposition);
    }

    function unbindRepositionWhileOpen(dropdown) {
        const reposition = dropdown?._genLayoutReposition;
        if (!reposition) return;
        window.removeEventListener("scroll", reposition, true);
        window.removeEventListener("resize", reposition);
        dropdown._genLayoutReposition = null;
    }

    function openDropdown(dropdown) {
        closeAllDropdowns();
        dropdown.classList.add("open");
        const input = findDropdownDisplayInput(dropdown);
        const list = getOptionsList(dropdown);
        if (input) input.setAttribute("aria-expanded", "true");
        if (list) {
            mountFloatingOptionsList(dropdown, list);
            showOptionsList(list);
            bindRepositionWhileOpen(dropdown, list);
        }
    }

    function closeDropdown(dropdown) {
        if (!dropdown) return;
        dropdown.classList.remove("open");
        const input = findDropdownDisplayInput(dropdown);
        const list = getOptionsList(dropdown);
        if (input) input.setAttribute("aria-expanded", "false");
        unbindRepositionWhileOpen(dropdown);
        hideOptionsList(list);
        unmountFloatingOptionsList(dropdown, list);
    }

    function refreshDropdownUI(ui, state) {
        const label = ratioLabelForKey(state.ratioKey, state.swapped);
        if (ui.displayInput) ui.displayInput.value = label;
        for (const item of ui.items) {
            const key = item.dataset.value;
            item.textContent = ratioLabelForKey(key, state.swapped);
            item.classList.toggle("selected", key === state.ratioKey);
        }
    }

    function applyRatioState(state, ui, swapToggle, ratioKey, swapped, skipApply) {
        state.ratioKey = ratioKey;
        state.swapped = swapped;
        if (swapToggle) swapToggle.checked = swapped;
        refreshDropdownUI(ui, state);
        if (!skipApply && ratioKey !== "custom") {
            applyRatioFromWidth(state.tab, state, ui);
        }
    }

    function setRatioKey(state, ui, swapToggle, key, skipApply) {
        applyRatioState(state, ui, swapToggle, key, state.swapped, skipApply);
    }

    function applyRatioFromWidth(tab, state, ui) {
        const active = getActiveRatio(state);
        if (!active) return;

        const [rw, rh] = active;
        const meta = getSliderMeta(tab);
        const width = readDim(tab, "width");
        if (!width) return;

        const height = snapToStep((width * rh) / rw, meta);
        state.syncing = true;
        writeDim(tab, "height", height);
        state.syncing = false;
        refreshDropdownUI(ui, state);
    }

    function applyRatioFromHeight(tab, state, ui) {
        const active = getActiveRatio(state);
        if (!active) return;

        const [rw, rh] = active;
        const meta = getSliderMeta(tab);
        const height = readDim(tab, "height");
        if (!height) return;

        const width = snapToStep((height * rw) / rh, meta);
        state.syncing = true;
        writeDim(tab, "width", width);
        state.syncing = false;
        refreshDropdownUI(ui, state);
    }

    function swapDimensions(tab, state, ui, swapToggle) {
        const width = readDim(tab, "width");
        const height = readDim(tab, "height");

        state.syncing = true;
        writeDim(tab, "width", height);
        writeDim(tab, "height", width);
        state.syncing = false;

        state.swapped = swapToggle.checked;
        refreshDropdownUI(ui, state);
    }

    function hideNativeSwapButton(tab) {
        const btn = gradioApp().getElementById(`${tab}_res_switch_btn`);
        if (btn) {
            btn.style.display = "none";
            btn.setAttribute("aria-hidden", "true");
        }
    }

    function getDropdownTemplate(tab) {
        return (
            gradioApp().getElementById(`${tab}_scheduler`) ||
            gradioApp().getElementById(`${tab}_sampling`)
        );
    }

    function shouldSkipTemplateChild(node) {
        return (
            node.nodeType !== Node.ELEMENT_NODE ||
            (node.classList.contains("wrap") && node.classList.contains("hide"))
        );
    }

    function cloneDropdownSkeleton(node, depth) {
        const el = document.createElement(node.tagName.toLowerCase());
        if (node.className && typeof node.className === "string") {
            el.className = node.className;
        }
        for (const attr of node.getAttributeNames()) {
            if (["id", "style", "disabled", "value"].includes(attr)) continue;
            el.setAttribute(attr, node.getAttribute(attr));
        }
        if (el.tagName === "INPUT") {
            el.readOnly = true;
            el.removeAttribute("disabled");
            el.value = "Custom";
            el.setAttribute("aria-label", "Aspect Ratio");
        }
        if (depth >= 14) return el;
        for (const child of node.children) {
            if (!shouldSkipTemplateChild(child)) {
                el.appendChild(cloneDropdownSkeleton(child, depth + 1));
            }
        }
        return el;
    }

    function findDropdownLabelSpan(root) {
        if (!root) return null;
        return (
            root.querySelector('[data-testid="block-info"]') ||
            root.querySelector(".container > span") ||
            root.querySelector("label > span")
        );
    }

    function findDropdownDisplayInput(root) {
        if (!root) return null;
        return root.querySelector(
            'input[role="listbox"]:not([type="hidden"]), input[role="combobox"], textarea[role="combobox"], input.single-select, .container input:not([type="hidden"]), label input:not([type="hidden"]), label textarea',
        );
    }

    function findDropdownOptionsList(root) {
        if (!root) return null;
        return root.querySelector("ul.options, ul.gen-layout-aspect-options");
    }

    function findDropdownOptionTemplate(root) {
        const list = findDropdownOptionsList(root);
        if (!list) return null;
        return list.querySelector('li.item, li[role="option"], [role="option"]');
    }

    function showOptionsList(list) {
        if (!list) return;
        list.style.display = "block";
        list.hidden = false;
        list.setAttribute("aria-hidden", "false");
    }

    function hideOptionsList(list) {
        if (!list) return;
        list.style.display = "none";
        list.hidden = true;
        list.setAttribute("aria-hidden", "true");
    }

    function buildDropdownOptions(list, optionTemplate, state, uiRef, swapToggle) {
        const items = [];
        list.textContent = "";
        for (const key of RATIO_KEYS) {
            const item = optionTemplate
                ? optionTemplate.cloneNode(false)
                : document.createElement("li");
            if (!optionTemplate) {
                item.className = "item";
                item.setAttribute("role", "option");
            }
            item.dataset.value = key;
            item.textContent = ratioLabelForKey(key, state.swapped);
            item.addEventListener("mousedown", function (event) {
                event.preventDefault();
                event.stopPropagation();
            });
            item.addEventListener("click", function (event) {
                event.preventDefault();
                event.stopPropagation();
                setRatioKey(state, uiRef, swapToggle, key, false);
                closeDropdown(uiRef.dropdown);
            });
            list.appendChild(item);
            items.push(item);
        }
        return items;
    }

    function wireDropdownInput(dropdown, displayInput, uiRef) {
        const clickTargets = [];
        const wrapInner = displayInput?.closest(".wrap-inner");
        if (wrapInner) clickTargets.push(wrapInner);
        if (displayInput) clickTargets.push(displayInput);
        if (!clickTargets.length) clickTargets.push(dropdown);

        const toggle = function (event) {
            event.preventDefault();
            event.stopPropagation();
            if (dropdown.classList.contains("open")) {
                closeDropdown(dropdown);
            } else {
                openDropdown(dropdown);
            }
        };

        for (const target of clickTargets) {
            target.addEventListener("mousedown", toggle);
        }
    }

    function createGradioDropdown(tab, state, swapToggle) {
        const template = getDropdownTemplate(tab);
        const optionTemplate = template ? findDropdownOptionTemplate(template) : null;

        const dropdown = document.createElement("div");
        dropdown.className = template
            ? `${template.className} gen-layout-aspect-dropdown`
            : "block gradio-dropdown gen-layout-aspect-dropdown";
        dropdown.id = `${tab}_aspect_ratio`;
        if (template?.hasAttribute("dir")) {
            dropdown.setAttribute("dir", template.getAttribute("dir"));
        }

        if (template) {
            for (const child of template.children) {
                if (shouldSkipTemplateChild(child)) continue;
                dropdown.appendChild(cloneDropdownSkeleton(child, 0));
            }
        } else {
            const label = document.createElement("label");
            const labelSpan = document.createElement("span");
            labelSpan.textContent = "Aspect Ratio";

            const wrap = document.createElement("div");
            wrap.className = "wrap wrap wrap wrap";

            const wrapInner = document.createElement("div");
            wrapInner.className = "wrap-inner wrap-inner wrap-inner";

            const fallbackInput = document.createElement("input");
            fallbackInput.type = "text";
            fallbackInput.className = "single-select";

            wrapInner.appendChild(fallbackInput);
            wrap.appendChild(wrapInner);
            label.appendChild(labelSpan);
            label.appendChild(wrap);
            dropdown.appendChild(label);
        }

        const labelSpan = findDropdownLabelSpan(dropdown);
        if (labelSpan) labelSpan.textContent = "Aspect Ratio";

        const displayInput = findDropdownDisplayInput(dropdown);
        if (displayInput) {
            displayInput.readOnly = true;
            displayInput.removeAttribute("disabled");
            displayInput.setAttribute("aria-label", "Aspect Ratio");
            if (!displayInput.value) displayInput.value = "Custom";
        }

        const wrap =
            displayInput?.closest(".wrap:not(.hide)") ||
            dropdown.querySelector(".wrap:not(.hide)");
        const optionsList = document.createElement("ul");
        const tplList = findDropdownOptionsList(template);
        optionsList.className = [tplList?.className, "options", "gen-layout-aspect-options"]
            .filter(Boolean)
            .join(" ");
        optionsList.setAttribute("role", "listbox");
        hideOptionsList(optionsList);

        if (wrap) {
            wrap.appendChild(optionsList);
        } else {
            dropdown.appendChild(optionsList);
        }

        dropdown._genLayoutAspectOptionsList = optionsList;
        dropdown._genLayoutAspectOptionsHome = wrap || dropdown;

        const uiRef = { dropdown, displayInput, optionsList, items: [] };
        uiRef.items = buildDropdownOptions(
            optionsList,
            optionTemplate,
            state,
            uiRef,
            swapToggle,
        );
        wireDropdownInput(dropdown, displayInput, uiRef);

        return uiRef;
    }

    function bindOutsideClose() {
        if (outsideCloseBound) return;
        outsideCloseBound = true;
        document.addEventListener(
            "mousedown",
            function (event) {
                if (
                    !event.target.closest(".gen-layout-aspect-dropdown") &&
                    !event.target.closest(".gen-layout-aspect-options")
                ) {
                    closeAllDropdowns();
                }
            },
            true,
        );
    }

    function createControls(tab) {
        const state = getState(tab);
        state.tab = tab;

        const root = document.createElement("div");
        root.className = "gen-layout-aspect-controls";
        root.dataset.tab = tab;
        root.dataset.genLayout = "aspect-ratio";

        const swapLabel = document.createElement("label");
        swapLabel.className = "gen-layout-swap-toggle";
        swapLabel.title = "Switch width/height";

        const swapToggle = document.createElement("input");
        swapToggle.type = "checkbox";
        swapToggle.className = "gen-layout-swap-toggle-input";

        const swapUi = document.createElement("span");
        swapUi.className = "gen-layout-swap-toggle-ui";

        swapLabel.appendChild(swapToggle);
        swapLabel.appendChild(swapUi);

        const ui = createGradioDropdown(tab, state, swapToggle);

        root.appendChild(ui.dropdown);
        root.appendChild(swapLabel);

        swapToggle.addEventListener("change", function () {
            swapDimensions(tab, state, ui, swapToggle);
        });

        bindOutsideClose();
        root._genLayoutAspect = { state, ui, swapToggle };
        return root;
    }

    function shouldRebuildAspectControls(tab, root) {
        const ui = root?._genLayoutAspect?.ui;
        if (!ui?.displayInput || !ui?.optionsList || ui.items.length === 0) return true;

        const template = getDropdownTemplate(tab);
        if (!template) return false;

        const templateUsesContainer = !!template.querySelector(".container");
        const builtUsesContainer = !!ui.dropdown.querySelector(".container");
        const builtUsesLegacyLabel =
            !!ui.dropdown.querySelector("label") && !builtUsesContainer;

        return templateUsesContainer && builtUsesLegacyLabel;
    }

    function getOrCreateControls(tab) {
        const app = gradioApp();
        if (!app) return null;

        let root = app.querySelector(`.gen-layout-aspect-controls[data-tab="${tab}"]`);
        if (root && shouldRebuildAspectControls(tab, root)) {
            root.remove();
            root = null;
        }

        if (!root) {
            root = createControls(tab);
        }
        return root;
    }

    function ensureInRow(row, tab) {
        if (!row) return null;
        if (isInteractionLocked()) {
            return gradioApp().querySelector(`.gen-layout-aspect-controls[data-tab="${tab}"]`);
        }

        const controls = getOrCreateControls(tab);
        if (!controls) return null;

        if (controls.parentElement !== row) {
            row.insertBefore(controls, row.firstChild);
        } else if (row.firstChild !== controls) {
            row.insertBefore(controls, row.firstChild);
        }

        return controls;
    }

    function bindDimensionInputs(tab, controls) {
        const widthInput = getNumberInput(tab, "width");
        const heightInput = getNumberInput(tab, "height");
        const widthRange = getRangeInput(tab, "width");
        const heightRange = getRangeInput(tab, "height");
        if (!widthInput || !heightInput || !controls) {
            return;
        }

        const { state, ui, swapToggle } = controls._genLayoutAspect;

        if (controls.dataset.genLayoutAspectBound === tab) return;
        controls.dataset.genLayoutAspectBound = tab;

        applyRatioState(
            state,
            ui,
            swapToggle,
            state.ratioKey,
            state.swapped,
            true,
        );

        bindDimControlListeners(tab, state, ui, swapToggle, [widthInput, widthRange], "width");
        bindDimControlListeners(tab, state, ui, swapToggle, [heightInput, heightRange], "height");
    }

    function wire(tab) {
        hideNativeSwapButton(tab);

        const row =
            tab === "img2img"
                ? gradioApp().querySelector(".gen-layout-img2img-resize-to-row")
                : gradioApp().querySelector(`.gen-layout-dimensions-row[data-tab="${tab}"]`);

        if (!row) return;

        const controls =
            row.querySelector(`.gen-layout-aspect-controls[data-tab="${tab}"]`) ||
            ensureInRow(row, tab);
        bindDimensionInputs(tab, controls);
    }

    function wireAll() {
        for (const tab of TABS) {
            wire(tab);
        }
    }

    window.genLayoutAspectRatio = {
        getOrCreateControls,
        ensureInRow,
        wire,
        wireAll,
        isInteractionLocked,
    };

    onUiLoaded(wireAll);
    onAfterUiUpdate(wireAll);
})();
