(function () {
    "use strict";

    const TABS = ["txt2img", "img2img"];
    const lockedPromptTextareas = [];

    function getBlock(elemId) {
        const el = gradioApp().getElementById(elemId);
        if (!el) return null;
        return el.classList.contains("block") ? el : el.closest(".block") || el;
    }

    function isVisible(el) {
        if (!el) return false;
        if (!el.offsetParent && getComputedStyle(el).position !== "fixed") return false;
        return getComputedStyle(el).display !== "none" && getComputedStyle(el).visibility !== "hidden";
    }

    function hidePlaceholderColumn(col) {
        if (!col || col.dataset.genLayoutHidden === "1") return;
        col.style.display = "none";
        col.style.flex = "0 0 0";
        col.style.width = "0";
        col.style.minWidth = "0";
        col.style.maxWidth = "0";
        col.style.padding = "0";
        col.style.margin = "0";
        col.style.overflow = "hidden";
        col.setAttribute("aria-hidden", "true");
        col.dataset.genLayoutHidden = "1";
    }

    function tightenDimensionsRow(row) {
        if (!row) return;
        row.style.flex = "1 1 100%";
        row.style.width = "100%";
        row.style.minWidth = "100%";
        row.style.maxWidth = "100%";
    }

    function layoutTxt2imgDimensions(settings) {
        const tab = "txt2img";
        const sizeCol = gradioApp().getElementById(`${tab}_column_size`);
        const batchCol = gradioApp().getElementById(`${tab}_column_batch`);
        let row = settings.querySelector(`.gen-layout-dimensions-row[data-tab="${tab}"]`);

        if (!row) {
            const widthBlock = getBlock(`${tab}_width`);
            const heightBlock = getBlock(`${tab}_height`);
            const toolsCol = gradioApp().getElementById(`${tab}_dimensions_row`);

            if (!widthBlock || !heightBlock || !toolsCol) return;

            const parent = sizeCol?.parentElement || toolsCol.parentElement;
            if (!parent || !settings.contains(parent)) return;

            row = document.createElement("div");
            row.className = "gen-layout-dimensions-row";
            row.dataset.tab = tab;
            row.dataset.genLayout = "dimensions";

            parent.insertBefore(row, sizeCol || widthBlock.parentElement);

            row.appendChild(widthBlock);
            row.appendChild(toolsCol);
            row.appendChild(heightBlock);
        }

        hidePlaceholderColumn(sizeCol);
        hidePlaceholderColumn(batchCol);
        tightenDimensionsRow(row);
    }

    function getImg2imgResizeToHost() {
        const tabsEl = gradioApp().getElementById("img2img_tabs_resize");
        const widthEl = gradioApp().getElementById("img2img_width");
        if (tabsEl && widthEl) {
            const host = widthEl.closest(".form, .row");
            if (host && tabsEl.contains(host)) return host;
        }

        const resizeToTab = gradioApp().getElementById("img2img_tab_resize_to");
        if (!resizeToTab || !tabsEl?.contains(resizeToTab)) return null;

        return (
            resizeToTab.querySelector(":scope > .form") ||
            resizeToTab.querySelector(":scope > .row") ||
            resizeToTab.querySelector(".form, .row")
        );
    }

    function getOrCreateImg2imgResizeToRow(host) {
        let resizeRow = host.querySelector(":scope > .gen-layout-img2img-resize-to-row");
        if (!resizeRow) {
            resizeRow = document.createElement("div");
            resizeRow.className = "gen-layout-img2img-resize-to-row";
            resizeRow.dataset.genLayout = "img2img-resize-to";
            host.appendChild(resizeRow);
        }
        return resizeRow;
    }

    function hideEmptyImg2imgResizeColumns(host) {
        if (!host) return;
        for (const col of host.querySelectorAll('[id="img2img_column_size"]')) {
            if (col.querySelector("#img2img_width, #img2img_height")) continue;
            hidePlaceholderColumn(col);
        }
    }

    function layoutImg2imgResizeToHorizontal() {
        const tabsEl = gradioApp().getElementById("img2img_tabs_resize");
        const widthBlock = getBlock("img2img_width");
        const heightBlock = getBlock("img2img_height");
        const toolsCol = gradioApp().getElementById("img2img_dimensions_row");
        if (!tabsEl || !widthBlock || !heightBlock || !toolsCol) return;

        const host = getImg2imgResizeToHost();
        if (!host) return;

        const resizeRow = getOrCreateImg2imgResizeToRow(host);

        for (const el of [widthBlock, toolsCol, heightBlock]) {
            if (el && el.parentElement !== resizeRow) resizeRow.appendChild(el);
        }

        hideEmptyImg2imgResizeColumns(host);
    }

    function repairImg2imgDetachedControls(row) {
        const tabsEl = gradioApp().getElementById("img2img_tabs_resize");
        const widthBlock = getBlock("img2img_width");
        const heightBlock = getBlock("img2img_height");
        const toolsCol = gradioApp().getElementById("img2img_dimensions_row");
        if (!tabsEl || !widthBlock) return;

        if (row) {
            for (const el of [widthBlock, heightBlock, toolsCol]) {
                if (el && row.contains(el)) row.removeChild(el);
            }
        }

        if (!tabsEl.contains(widthBlock)) return;

        layoutImg2imgResizeToHorizontal();
    }

    function layoutImg2imgDimensions(settings) {
        const tab = "img2img";
        const outerCol = gradioApp().getElementById("img2img_column_size");
        const batchCol = gradioApp().getElementById("img2img_column_batch");
        const tabsEl = gradioApp().getElementById("img2img_tabs_resize");
        if (!tabsEl) return;

        let row = settings.querySelector(`.gen-layout-dimensions-row[data-tab="${tab}"]`);

        repairImg2imgDetachedControls(row);

        if (!row) {
            const parent = outerCol?.parentElement || tabsEl.parentElement;
            if (!parent || !settings.contains(parent)) return;

            row = document.createElement("div");
            row.className = "gen-layout-dimensions-row gen-layout-dimensions-row--img2img";
            row.dataset.tab = tab;
            row.dataset.genLayout = "dimensions";

            parent.insertBefore(row, outerCol || tabsEl);
        } else {
            row.classList.add("gen-layout-dimensions-row--img2img");
        }

        if (!row.contains(tabsEl)) {
            row.appendChild(tabsEl);
        }

        repairImg2imgDetachedControls(row);
        layoutImg2imgResizeToHorizontal();

        hidePlaceholderColumn(outerCol);
        hidePlaceholderColumn(batchCol);
        tightenDimensionsRow(row);
    }

    function findCfgBatchHost(tab, settings) {
        const cfgBlock = getBlock(`${tab}_cfg_scale`);
        if (!cfgBlock) return null;

        for (let el = cfgBlock.parentElement; el && el !== settings; el = el.parentElement) {
            if (el.matches?.(".row, .form") && el.querySelector(`#${tab}_cfg_scale`)) {
                return el;
            }
        }

        return null;
    }

    function tightenCfgBatchRow(host) {
        if (!host) return;
        host.style.flex = "1 1 100%";
        host.style.width = "100%";
        host.style.minWidth = "100%";
        host.style.maxWidth = "100%";
    }

    function hideEmptyBatchColumns(tab, settings) {
        const batchCount = getBlock(`${tab}_batch_count`);
        for (const col of settings.querySelectorAll(`#${tab}_column_batch`)) {
            if (batchCount && col.contains(batchCount)) continue;
            hidePlaceholderColumn(col);
        }
        hidePlaceholderColumn(gradioApp().getElementById(`${tab}_column_batch`));
    }

    function layoutCfgBatch(tab, settings) {
        const host = findCfgBatchHost(tab, settings);
        if (!host || !settings.contains(host)) return;

        const cfgBlock = getBlock(`${tab}_cfg_scale`);
        const batchCount = getBlock(`${tab}_batch_count`);
        const batchSize = getBlock(`${tab}_batch_size`);
        const distilled = getBlock(`${tab}_distilled_cfg_scale`);

        const needsLayout =
            !host.classList.contains("gen-layout-cfg-batch-row") ||
            (batchCount && !host.contains(batchCount));

        if (!needsLayout) return;

        host.classList.add("gen-layout-cfg-batch-row");
        host.dataset.tab = tab;
        host.dataset.genLayout = "cfg-batch";

        const ordered = [];
        if (distilled && isVisible(distilled)) ordered.push(distilled);
        if (cfgBlock) ordered.push(cfgBlock);
        if (batchCount) ordered.push(batchCount);
        if (batchSize) ordered.push(batchSize);

        for (const block of ordered) {
            if (block && block.parentElement !== host) host.appendChild(block);
        }

        tightenCfgBatchRow(host);
        hideEmptyBatchColumns(tab, settings);
    }

    function getSeedInsertPoint(tab, settings) {
        const extras = gradioApp().getElementById(`${tab}_seed_extras`);
        const seedRow = gradioApp().getElementById(`${tab}_seed_row`);
        if (!seedRow) return null;

        const extrasBlock = extras ? extras.closest(".block") || extras : null;
        const seedBlock = seedRow.closest(".block") || seedRow;

        let last = extrasBlock && settings.contains(extrasBlock) ? extrasBlock : seedBlock;
        if (!settings.contains(last)) last = seedBlock;

        return last;
    }

    function getAccordionBlock(el) {
        if (!el) return null;
        return el.classList.contains("input-accordion") ? el : el.closest(".input-accordion");
    }

    function layoutHiresTxt2img(settings) {
        const hr = gradioApp().getElementById("txt2img_hr");
        if (!hr) return;

        const seedAnchor = getSeedInsertPoint("txt2img", settings);
        if (!seedAnchor) return;

        const hrBlock = getAccordionBlock(hr) || hr;
        const accordions = gradioApp().getElementById("txt2img_accordions");

        if (accordions?.contains(hrBlock)) {
            accordions.removeChild(hrBlock);
        }

        const adetailerEl =
            accordions?.querySelector('[id*="adetailer" i]') ||
            settings.querySelector('[id*="adetailer" i]');
        const adBlock = getAccordionBlock(adetailerEl);

        if (adBlock && accordions?.contains(adBlock)) {
            accordions.removeChild(adBlock);
        }

        const insertAfter = (node, block) => {
            if (node.nextSibling) {
                settings.insertBefore(block, node.nextSibling);
            } else {
                settings.appendChild(block);
            }
        };

        if (seedAnchor.nextElementSibling !== hrBlock) {
            insertAfter(seedAnchor, hrBlock);
        }

        if (adBlock && hrBlock.nextElementSibling !== adBlock) {
            insertAfter(hrBlock, adBlock);
        }

        hrBlock.dataset.genLayoutHires = "placed";
        if (adBlock) adBlock.dataset.genLayoutAdetailer = "placed";
    }

    function getPromptLayoutHost(container, promptRow, negRow) {
        const accordion =
            promptRow.closest(".input-accordion") ||
            negRow.closest(".input-accordion") ||
            promptRow.closest("details") ||
            negRow.closest("details");

        if (accordion && container.contains(accordion)) {
            return (
                accordion.querySelector(":scope > .form") ||
                accordion.querySelector(":scope > .wrap") ||
                accordion
            );
        }

        return container;
    }

    function layoutPrompts(tab) {
        const container = gradioApp().getElementById(`${tab}_prompt_container`);
        const promptRow = gradioApp().getElementById(`${tab}_prompt_row`);
        const negRow = gradioApp().getElementById(`${tab}_neg_prompt_row`);
        if (!container || !promptRow || !negRow) return;

        const host = getPromptLayoutHost(container, promptRow, negRow);
        if (!host) return;

        let row = host.querySelector(`:scope > .gen-layout-prompts-row[data-tab="${tab}"]`);
        if (!row) {
            row = document.createElement("div");
            row.className = "gen-layout-prompts-row";
            row.dataset.tab = tab;
            row.dataset.genLayout = "prompts";
            host.insertBefore(row, promptRow);
        }

        if (!row.contains(promptRow)) row.appendChild(promptRow);
        if (!row.contains(negRow)) row.appendChild(negRow);

        tightenDimensionsRow(row);
    }

    function lockPromptAutoGrow(tab) {
        const row = gradioApp().querySelector(`.gen-layout-prompts-row[data-tab="${tab}"]`);
        if (!row) return;

        for (let i = lockedPromptTextareas.length - 1; i >= 0; i--) {
            const entry = lockedPromptTextareas[i];
            if (!entry.textarea.isConnected) {
                entry.textarea.removeEventListener("input", entry.onInputCapture, true);
                entry.textarea.removeEventListener("input", entry.onInput);
                entry.textarea.removeEventListener("scroll", entry.onScroll);
                entry.textarea.removeEventListener("mousedown", entry.onMouseDown);
                entry.textarea.removeEventListener("mouseup", entry.onMouseUp);
                document.removeEventListener("mouseup", entry.onMouseUp);
                entry.resizeObserver?.disconnect();
                entry.styleObserver?.disconnect();
                lockedPromptTextareas.splice(i, 1);
            }
        }

        for (const textarea of row.querySelectorAll("textarea")) {
            if (textarea.dataset.genLayoutAutoGrowLocked === "1") continue;

            let stableHeight = textarea.getBoundingClientRect().height;
            if (stableHeight <= 0) {
                const minH = parseFloat(getComputedStyle(textarea).minHeight);
                if (!isNaN(minH) && minH > 0) stableHeight = minH;
            }
            if (
                stableHeight <= 0 ||
                (textarea.offsetHeight <= 0 && textarea.getBoundingClientRect().height <= 0)
            ) {
                continue;
            }

            textarea.dataset.genLayoutAutoGrowLocked = "1";
            let clamping = false;
            let inputPending = false;
            let userResizing = false;
            let pendingWasNearBottom = true;
            let userHasScrolledUp = false;
            let previousScrollTop = textarea.scrollTop;

            const syncHighlightLayer = function () {
                const layer = textarea.closest(".gen-layout-prompt-highlight-layer");
                if (!layer) return;
                layer.style.height = stableHeight + "px";
                layer.style.removeProperty("max-height");
            };

            const enforcePromptHeight = function () {
                clamping = true;
                textarea.style.setProperty("height", stableHeight + "px", "important");
                textarea.style.removeProperty("max-height");
                textarea.style.setProperty("overflow-y", "scroll", "important");
                syncHighlightLayer();
                clamping = false;
            };

            const updateOverflowAndScroll = function (wasNearBottom) {
                textarea.style.setProperty("overflow-y", "scroll", "important");

                if (!userHasScrolledUp && wasNearBottom) {
                    textarea.scrollTop = textarea.scrollHeight;
                }
            };

            const onScroll = function () {
                const currentScrollTop = textarea.scrollTop;
                if (currentScrollTop < previousScrollTop) {
                    userHasScrolledUp = true;
                }
                previousScrollTop = currentScrollTop;

                const maxScrollTop = textarea.scrollHeight - textarea.clientHeight;
                if (currentScrollTop >= maxScrollTop) {
                    userHasScrolledUp = false;
                }
            };

            const runInputLock = function () {
                const lockHeight = stableHeight;
                pendingWasNearBottom =
                    textarea.offsetHeight + textarea.scrollTop > textarea.scrollHeight - 100;
                stableHeight = lockHeight;
                enforcePromptHeight();
                updateOverflowAndScroll(pendingWasNearBottom);
            };

            const onInputCapture = function () {
                inputPending = true;
                runInputLock();
            };

            const onInput = function () {
                inputPending = true;

                runInputLock();
                queueMicrotask(function () {
                    if (!inputPending) return;
                    runInputLock();
                });
                requestAnimationFrame(function () {
                    runInputLock();
                    inputPending = false;
                });
            };

            const onMouseDown = function (e) {
                const rect = textarea.getBoundingClientRect();
                if (
                    e.clientX >= rect.right - 20 &&
                    e.clientY >= rect.bottom - 20 &&
                    e.clientX <= rect.right &&
                    e.clientY <= rect.bottom
                ) {
                    userResizing = true;
                }
            };

            const onMouseUp = function () {
                if (!userResizing) return;
                userResizing = false;
                const h = textarea.getBoundingClientRect().height;
                if (h > 0) stableHeight = h;
                enforcePromptHeight();
                updateOverflowAndScroll(true);
            };

            textarea.addEventListener("input", onInputCapture, true);
            textarea.addEventListener("input", onInput);
            textarea.addEventListener("scroll", onScroll);
            textarea.addEventListener("mousedown", onMouseDown);
            textarea.addEventListener("mouseup", onMouseUp);
            document.addEventListener("mouseup", onMouseUp);
            enforcePromptHeight();
            updateOverflowAndScroll(true);

            let styleObserver = null;
            if (typeof MutationObserver !== "undefined") {
                styleObserver = new MutationObserver(function () {
                    if (!inputPending || clamping || userResizing) return;
                    if (textarea.offsetHeight <= stableHeight + 1) return;
                    runInputLock();
                });
                styleObserver.observe(textarea, {
                    attributes: true,
                    attributeFilter: ["style"],
                });
            }

            let resizeObserver = null;
            if (typeof ResizeObserver !== "undefined") {
                resizeObserver = new ResizeObserver(function () {
                    if (clamping || inputPending) return;
                    const h = textarea.getBoundingClientRect().height;
                    if (userResizing) {
                        if (h > 0) {
                            stableHeight = h;
                            syncHighlightLayer();
                        }
                        return;
                    }
                    if (h > stableHeight + 1) {
                        enforcePromptHeight();
                    }
                });
                resizeObserver.observe(textarea);
            }

            lockedPromptTextareas.push({
                textarea,
                onInput,
                onInputCapture,
                onScroll,
                onMouseDown,
                onMouseUp,
                resizeObserver,
                styleObserver,
            });
        }
    }

    function applyLayout(tab) {
        const settings = gradioApp().getElementById(`${tab}_settings`);
        if (!settings) return;

        if (tab === "img2img") {
            layoutCfgBatch(tab, settings);
            layoutImg2imgDimensions(settings);
        } else {
            layoutTxt2imgDimensions(settings);
            layoutCfgBatch(tab, settings);
        }

        if (tab === "txt2img") {
            layoutHiresTxt2img(settings);
        }

        settings.dataset.genLayoutApplied = "1";
    }

    function applyAllLayouts() {
        for (const tab of TABS) {
            layoutPrompts(tab);
            lockPromptAutoGrow(tab);
            applyLayout(tab);
        }
    }

    onUiLoaded(applyAllLayouts);
    onAfterUiUpdate(applyAllLayouts);
})();
