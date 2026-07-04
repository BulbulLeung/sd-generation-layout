(function () {
    "use strict";

    const TABS = ["txt2img", "img2img"];
    const POLL_MS = 1500;
    const API_URL = "./sd-gen-layout/gpu-stats";

    let pollTimer = null;
    let lastPayload = null;
    let fetchInFlight = false;
    const heightObservers = new Map();

    function gradioRoot() {
        return gradioApp();
    }

    function isVisible(el) {
        if (!el) return false;
        if (!el.offsetParent && getComputedStyle(el).position !== "fixed") return false;
        return getComputedStyle(el).display !== "none" && getComputedStyle(el).visibility !== "hidden";
    }

    function formatValue(value, suffix = "") {
        if (value === null || value === undefined || Number.isNaN(value)) return "—";
        return `${value}${suffix}`;
    }

    function iconSvg(name) {
        const icons = {
            temp: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M15 13V5a3 3 0 0 0-6 0v8a5 5 0 1 0 6 0Zm-3 7a3 3 0 0 1-1.17-5.76l.17-.12V5a1 1 0 1 1 2 0v9.12l.17.12A3 3 0 0 1 12 20Z"/></svg>',
            load: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 6h16v2H4V6Zm0 5h10v2H4v-2Zm0 5h16v2H4v-2Z"/></svg>',
            memory: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 6h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Zm2 2v2h2V8H6Zm4 0v2h2V8h-2Zm4 0v2h2V8h-2Zm4 0v2h2V8h-2ZM6 14v2h2v-2H6Zm4 0v2h2v-2h-2Zm4 0v2h2v-2h-2Zm4 0v2h2v-2h-2Z"/></svg>',
            clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 1 0 10 10A10.01 10.01 0 0 0 12 2Zm1 5a1 1 0 0 0-2 0v5.59l-3.3 3.3a1 1 0 0 0 1.42 1.42l3.59-3.58A1 1 0 0 0 13 12.59V7Z"/></svg>',
            power: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M13 2 8 12h4v10l5-12h-4V2Z"/></svg>',
        };
        return icons[name] || "";
    }

    function metricBlock(label, valueHtml, iconName, extraClass = "") {
        return `
            <div class="gen-layout-gpu-metric ${extraClass}">
                <div class="gen-layout-gpu-metric-head">
                    <span class="gen-layout-gpu-icon">${iconSvg(iconName)}</span>
                    <span class="gen-layout-gpu-label">${label}</span>
                </div>
                <div class="gen-layout-gpu-value">${valueHtml}</div>
            </div>
        `;
    }

    function progressBar(pct, tone) {
        const width = pct === null || pct === undefined || Number.isNaN(pct) ? 0 : Math.max(0, Math.min(100, pct));
        return `<div class="gen-layout-gpu-bar gen-layout-gpu-bar-${tone}"><span style="width:${width}%"></span></div>`;
    }

    function createGpuCard(tab) {
        const col = document.createElement("div");
        col.className = "gen-layout-gpu-meter-col";
        col.dataset.tab = tab;
        col.innerHTML = `
            <div class="gen-layout-gpu-card" data-state="loading">
                <div class="gen-layout-gpu-header">
                    <div class="gen-layout-gpu-name">GPU</div>
                    <div class="gen-layout-gpu-index">#0</div>
                </div>
                <div class="gen-layout-gpu-body">
                    <div class="gen-layout-gpu-col-left">
                        ${metricBlock("Temp", '<span data-field="temperature">—</span>', "temp", "gen-layout-gpu-metric-temp")}
                        ${metricBlock("Clock", '<span data-field="clock">—</span>', "clock", "gen-layout-gpu-metric-clock")}
                        ${metricBlock("Power", '<span data-field="power">—</span>', "power", "gen-layout-gpu-metric-power")}
                    </div>
                    <div class="gen-layout-gpu-col-right">
                        <div class="gen-layout-gpu-metric gen-layout-gpu-metric-load">
                            <div class="gen-layout-gpu-metric-head">
                                <span class="gen-layout-gpu-icon">${iconSvg("load")}</span>
                                <span class="gen-layout-gpu-label">Load</span>
                            </div>
                            <div class="gen-layout-gpu-value"><span data-field="load">—</span></div>
                            <div data-field="load-bar">${progressBar(0, "load")}</div>
                        </div>
                        <div class="gen-layout-gpu-metric gen-layout-gpu-metric-memory">
                            <div class="gen-layout-gpu-metric-head">
                                <span class="gen-layout-gpu-icon">${iconSvg("memory")}</span>
                                <span class="gen-layout-gpu-label">Memory</span>
                            </div>
                            <div class="gen-layout-gpu-value"><span data-field="memory-pct">—</span></div>
                            <div data-field="memory-bar">${progressBar(0, "memory")}</div>
                            <div class="gen-layout-gpu-subvalue" data-field="memory-gb">—</div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        return col;
    }

    function setField(card, field, html) {
        const el = card.querySelector(`[data-field="${field}"]`);
        if (el) el.innerHTML = html;
    }

    function renderGpuCard(card, payload) {
        if (!card || !payload) return;

        if (!payload.available) {
            card.closest(".gen-layout-gpu-meter-col")?.classList.add("gen-layout-gpu-unavailable");
            card.dataset.state = "unavailable";
            return;
        }

        card.closest(".gen-layout-gpu-meter-col")?.classList.remove("gen-layout-gpu-unavailable");
        card.dataset.state = "ready";

        const active = (payload.gpus || []).find((gpu) => gpu.index === payload.active_index) || payload.gpus?.[0];
        if (!active) return;

        const nameEl = card.querySelector(".gen-layout-gpu-name");
        const indexEl = card.querySelector(".gen-layout-gpu-index");
        if (nameEl) nameEl.textContent = active.name || "GPU";
        if (indexEl) indexEl.textContent = `#${active.index ?? 0}`;

        setField(card, "temperature", `<span class="gen-layout-gpu-accent-temp">${formatValue(active.temperature_c, "°C")}</span>`);
        setField(card, "load", formatValue(active.gpu_util_pct, "%"));
        setField(card, "load-bar", progressBar(active.gpu_util_pct, "load"));
        setField(card, "memory-pct", formatValue(active.memory_pct, "%"));
        setField(card, "memory-bar", progressBar(active.memory_pct, "memory"));

        const memGb = active.memory_used_gb !== null && active.memory_total_gb !== null
            ? `${active.memory_used_gb}/${active.memory_total_gb} GB`
            : "—";
        setField(card, "memory-gb", memGb);

        const clock = active.clock_mhz !== null && active.clock_mhz !== undefined
            ? `${active.clock_mhz}MHz`
            : "—";
        setField(card, "clock", clock);

        const power = active.power_draw_w !== null && active.power_limit_w !== null
            ? `${Math.round(active.power_draw_w)}/${Math.round(active.power_limit_w)}W`
            : active.power_draw_w !== null
                ? `${Math.round(active.power_draw_w)}W`
                : "—";
        setField(card, "power", power);
    }

    function syncMeterHeight(tab) {
        const meterCol = gradioRoot().querySelector(`.gen-layout-gpu-meter-col[data-tab="${tab}"]`);
        if (!meterCol) return;

        let target = null;
        if (meterCol.dataset.mode === "classic") {
            target = gradioRoot().getElementById(`${tab}_actions_column`);
        } else if (meterCol.dataset.mode === "compact") {
            target = gradioRoot().getElementById(`${tab}_generate_box`);
        }

        if (!target || !isVisible(target)) return;

        const height = Math.max(target.offsetHeight, 0);
        if (height > 0) {
            meterCol.style.height = `${height}px`;
        }
    }

    function syncAllMeterHeights() {
        requestAnimationFrame(() => {
            for (const tab of TABS) {
                syncMeterHeight(tab);
            }
        });
    }

    function observeMeterHeight(tab, target) {
        if (!target) return;

        const key = `${tab}:${target.id}`;
        if (heightObservers.has(key)) {
            heightObservers.get(key).disconnect();
        }

        const observer = new ResizeObserver(() => syncMeterHeight(tab));
        observer.observe(target);
        heightObservers.set(key, observer);
        syncMeterHeight(tab);
    }

    function getOrCreateMeterCol(tab) {
        const existing = gradioRoot().querySelector(`.gen-layout-gpu-meter-col[data-tab="${tab}"]`);
        if (existing) return existing;
        return createGpuCard(tab);
    }

    function mountClassicMeter(tab) {
        const toprow = gradioRoot().getElementById(`${tab}_toprow`);
        const actionsCol = gradioRoot().getElementById(`${tab}_actions_column`);
        if (!toprow || !actionsCol) return false;

        let meterCol = gradioRoot().querySelector(`.gen-layout-gpu-meter-col[data-tab="${tab}"][data-mode="classic"]`);
        if (!meterCol) {
            meterCol = getOrCreateMeterCol(tab);
            meterCol.dataset.mode = "classic";
            actionsCol.insertAdjacentElement("afterend", meterCol);
        } else if (meterCol.parentElement !== toprow) {
            actionsCol.insertAdjacentElement("afterend", meterCol);
        }

        toprow.classList.add("gen-layout-toprow-with-meter");
        observeMeterHeight(tab, actionsCol);
        return true;
    }

    function mountCompactMeter(tab) {
        const toprow = gradioRoot().getElementById(`${tab}_toprow`);
        if (toprow) return false;

        const results = gradioRoot().getElementById(`${tab}_results`);
        const generateBox = gradioRoot().getElementById(`${tab}_generate_box`);
        if (!results || !generateBox || !results.contains(generateBox)) return false;

        let headerRow = results.querySelector(`.gen-layout-results-header-row[data-tab="${tab}"]`);
        if (!headerRow) {
            headerRow = document.createElement("div");
            headerRow.className = "gen-layout-results-header-row";
            headerRow.dataset.tab = tab;
            results.insertBefore(headerRow, generateBox);
            headerRow.appendChild(generateBox);
        } else if (!headerRow.contains(generateBox)) {
            headerRow.appendChild(generateBox);
        }

        let meterCol = gradioRoot().querySelector(`.gen-layout-gpu-meter-col[data-tab="${tab}"][data-mode="compact"]`);
        if (!meterCol) {
            meterCol = getOrCreateMeterCol(tab);
            meterCol.dataset.mode = "compact";
            headerRow.appendChild(meterCol);
        } else if (!headerRow.contains(meterCol)) {
            headerRow.appendChild(meterCol);
        }

        observeMeterHeight(tab, generateBox);
        return true;
    }

    function mountGpuMeter(tab) {
        const mountedClassic = mountClassicMeter(tab);
        const mountedCompact = mountCompactMeter(tab);
        return mountedClassic || mountedCompact;
    }

    function mountAllMeters() {
        let mountedAny = false;
        for (const tab of TABS) {
            if (mountGpuMeter(tab)) mountedAny = true;
        }
        return mountedAny;
    }

    function updateVisibleCards() {
        if (!lastPayload) return;
        for (const tab of TABS) {
            const meterCol = gradioRoot().querySelector(`.gen-layout-gpu-meter-col[data-tab="${tab}"]`);
            if (!meterCol) continue;
            meterCol.style.display = "";
            const card = meterCol.querySelector(".gen-layout-gpu-card");
            if (card) renderGpuCard(card, lastPayload);
        }
    }

    async function fetchGpuStats() {
        if (fetchInFlight) return;
        fetchInFlight = true;
        try {
            const response = await fetch(API_URL, { method: "GET", cache: "no-store" });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            lastPayload = await response.json();
            updateVisibleCards();
        } catch (error) {
            console.warn("sd-generation-layout: GPU stats fetch failed", error);
            for (const tab of TABS) {
                const card = gradioRoot().querySelector(`.gen-layout-gpu-meter-col[data-tab="${tab}"] .gen-layout-gpu-card`);
                if (card) card.dataset.state = "offline";
            }
        } finally {
            fetchInFlight = false;
        }
    }

    function startPolling() {
        if (pollTimer) return;
        fetchGpuStats();
        pollTimer = window.setInterval(fetchGpuStats, POLL_MS);
    }

    function applyGpuMeters() {
        if (!mountAllMeters()) return;
        syncAllMeterHeights();
        updateVisibleCards();
        startPolling();
    }

    onUiLoaded(applyGpuMeters);
    onAfterUiUpdate(applyGpuMeters);
    onUiTabChange(() => {
        syncAllMeterHeights();
        updateVisibleCards();
    });
    window.addEventListener("resize", syncAllMeterHeights);
})();
