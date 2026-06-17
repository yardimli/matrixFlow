(function () {
  const { D, formatNumber, formatTime } = window.MF.utils;

  function createPages(context) {
    const { state, researchData, storyData, legacyData, helpData, economy } = context;

    function renderMatrixPage() {
      const tapUnlocked = economy.isTapUpgradeUnlocked();
      const flowUnlocked = economy.isFlowUnlocked();
      const tapCost = economy.getTapCost();
      const flowCost = economy.getFlowCost();
      return `
        <div class="matrix-page" id="matrix-page">
          <button class="tap-zone" id="tap-zone" type="button" aria-label="Pulse matrix"></button>
          <section class="upgrade-stack" aria-label="Upgrades">
            ${renderUpgrade("tap-upgrade", tapUnlocked, D(state.cycles).gte(tapCost), "cycles / tap", `+${formatNumber(economy.getCyclesPerTap())} cycles / tap`, `level ${state.tapLevel}`, `cost ${formatNumber(tapCost)}`)}
            ${renderUpgrade("flow-upgrade", flowUnlocked, D(state.cycles).gte(flowCost), "flow", `<span id="live-flow">${formatNumber(economy.getFlowRate())} cycles / second</span>`, `level ${state.flowLevel}`, `cost ${formatNumber(flowCost)}`)}
          </section>
        </div>
      `;
    }

    function renderUpgrade(id, unlocked, canAfford, title, effect, level, cost) {
      if (!unlocked) return "";
      return `
        <button class="upgrade ${canAfford ? "can-afford" : ""}" id="${id}" type="button" ${canAfford ? "" : "disabled"}>
          <span><strong>${title}</strong><small>${effect}</small></span>
          <span class="meta"><small>${level}</small><small>${cost}</small></span>
        </button>
      `;
    }

    function renderResearchPage() {
      const available = researchData.filter((item) => !economy.isResearchBought(item.id));
      const purchased = researchData.filter((item) => economy.isResearchBought(item.id));
      return `
        <h1 class="page-title">research</h1>
        <div class="subtabs" role="tablist" aria-label="Research filters">
          <button class="subtab active" type="button" data-research-view="available">available</button>
          <button class="subtab" type="button" data-research-view="purchased">purchased</button>
        </div>
        <section class="card-grid research-panel" data-research-panel="available">
          ${available.length ? available.map(renderAvailableResearch).join("") : `<article class="card"><span><strong>no available research</strong><small>The machine has no unnamed doors left in this run.</small></span></article>`}
        </section>
        <section class="card-grid research-panel hidden" data-research-panel="purchased">
          ${purchased.length ? purchased.map(renderPurchasedResearch).join("") : `<article class="card"><span><strong>nothing purchased</strong><small>No research has crossed from rumor into memory.</small></span></article>`}
        </section>
      `;
    }

    function renderAvailableResearch(item) {
      const cost = economy.getResearchCost(item);
      const canAfford = D(state.cycles).gte(cost);
      return `
        <button class="card actionable ${canAfford ? "can-afford" : ""}" data-research-id="${item.id}" type="button" ${canAfford ? "" : "disabled"}>
          <span><strong>${item.name}</strong><small>${item.description}</small></span>
          <span class="meta"><small>cost ${formatNumber(cost)}</small></span>
        </button>
      `;
    }

    function renderPurchasedResearch(item) {
      return `
        <article class="card can-afford">
          <span><strong>${item.name}</strong><small>${item.description}</small></span>
          <span class="meta"><small>complete</small></span>
        </article>
      `;
    }

    function renderCyclesPage() {
      const difficulty = getDifficultyLabel();
      return `
        <h1 class="page-title">cycles</h1>
        <section class="reboot-card">
          <strong>reboot</strong>
          <small class="muted">Rebooting keeps total source code, legacies, and CPU growth. Current cycles, taps, flow, cores, research, and lifetime stats restart.</small>
          <div class="stat-table">
            ${statRow("source code", `${formatNumber(state.sourceCode)} lines`, `${formatNumber(state.totalSourceCode)} lines`)}
            ${statRow("cpu multiplier", `${formatNumber(state.cpuMultiplier)}x`, `${formatNumber(economy.getCpuMultiplier())}x`)}
            ${statRow("difficulty", difficulty, `reboot ${state.reboots}`)}
            ${statRow("writing rate", `${formatNumber(economy.getSourceCodeRate())}/s`, "this run")}
          </div>
          <button class="reboot-button" id="reboot-button" type="button" ${state.sourceCode >= 1 ? "" : "disabled"}>reboot</button>
        </section>
      `;
    }

    function renderStoryPage() {
      const unlocked = storyData.filter((entry) => state.unlockedStories[entry.id]);
      return `
        <h1 class="page-title">story</h1>
        <section class="card-grid">
          ${(unlocked.length ? unlocked : [{ title: "silence", text: "The first message has not crossed the glass." }]).map((entry) => `
            <article class="card story-entry"><strong>${entry.title}</strong><p>${entry.text}</p></article>
          `).join("")}
        </section>
      `;
    }

    function renderStatisticsPage() {
      return `
        <h1 class="page-title">statistics</h1>
        <section class="panel stat-table">
          <div class="stat-header"><span></span><span>lifetime</span><span>total</span></div>
          ${statRow("time", formatTime(state.lifetime.time), formatTime(state.total.time))}
          ${statRow("taps", formatNumber(state.lifetime.taps), formatNumber(state.total.taps))}
          ${statRow("cycles", formatNumber(state.lifetime.cycles), formatNumber(state.total.cycles))}
          ${statRow("source code", formatNumber(state.lifetime.sourceCode), formatNumber(state.total.sourceCode))}
          ${statRow("cores", formatNumber(state.lifetime.coresPeak), formatNumber(state.total.coresPeak))}
          ${statRow("flow", formatNumber(state.lifetime.flowPeak), formatNumber(state.total.flowPeak))}
          ${statRow("research", formatNumber(state.lifetime.researchBought), formatNumber(state.total.researchBought))}
          ${statRow("reboots", formatNumber(state.reboots), formatNumber(state.reboots))}
        </section>
      `;
    }

    function renderLegaciesPage() {
      return `
        <h1 class="page-title">legacies</h1>
        <section class="card-grid">
          ${legacyData.map((legacy) => {
            const unlocked = Boolean(state.legacies[legacy.id]);
            return `
              <article class="card ${unlocked ? "can-afford" : "locked"}">
                <span><strong>${legacy.name}</strong><small>${legacy.description}</small></span>
                <span class="meta"><small>${unlocked ? "active" : legacy.cost}</small><small>${legacyEffectText(legacy.effects)}</small></span>
              </article>
            `;
          }).join("")}
        </section>
      `;
    }

    function renderHelpPage() {
      return `
        <h1 class="page-title">help</h1>
        <section class="accordion">
          ${helpData.map((entry, index) => `
            <details class="accordion-item" ${index === 0 ? "open" : ""}>
              <summary>${entry.title}</summary>
              <p>${entry.text}</p>
            </details>
          `).join("")}
        </section>
      `;
    }

    function renderAboutPage() {
      return `
        <h1 class="page-title">about</h1>
        <section class="panel">
          <p>Matrix Flow is a small vanilla HTML, CSS, and JavaScript incremental game about teaching a dark system to reveal its own source.</p>
          <p class="muted">Save data is local to this browser.</p>
          <button class="reboot-button danger" id="reset-save" type="button">reset save</button>
        </section>
      `;
    }

    function statRow(label, lifetime, total) {
      return `<div class="stat-row"><span>${label}</span><strong>${lifetime}</strong><strong>${total}</strong></div>`;
    }

    function legacyEffectText(effects = {}) {
      return Object.entries(effects).map(([key, value]) => `${key.replace("Multiplier", "")} +${Math.round(value * 100)}%`).join(", ");
    }

    function getDifficultyLabel() {
      const ratio = state.sourceCode / Math.max(1, state.previousRunSourceCode);
      if (ratio >= 10) return "very hard";
      if (ratio >= 6) return "hard";
      if (ratio >= 2) return "tightening";
      return "soft";
    }

    return {
      matrix: renderMatrixPage,
      research: renderResearchPage,
      cycles: renderCyclesPage,
      story: renderStoryPage,
      statistics: renderStatisticsPage,
      legacies: renderLegaciesPage,
      help: renderHelpPage,
      about: renderAboutPage
    };
  }

  window.MF.createPages = createPages;
})();
