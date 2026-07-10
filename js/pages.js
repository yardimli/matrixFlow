(function () {
  const { D, formatNumber, formatTime } = window.MF.utils;

  function createPages(context) {
    const { config, state, researchData, storyData, legacyData, helpData, economy, getDevClickMultiplier } = context;
    const FIRST_RAM_DOWNLOAD_BYTES = 1474560;
    const WHOLE_EXPONENTIAL = { scientificDecimals: 0 };

    function renderMatrixPage() {
      const tapUnlocked = economy.isTapUpgradeUnlocked();
      const ramUnlocked = economy.isRamUnlocked();
      const tapCost = economy.getTapCost();
      const ramCost = economy.getRamCost();
      const maxBuyUnlocked = economy.isResearchBought("max_buy");
      return `
        <div class="matrix-page" id="matrix-page">
          <section class="download-stage" aria-label="Mini upgrade download">
            ${renderFirstRamDownload()}
          </section>
          <section class="upgrade-stack" aria-label="Upgrades">
            ${renderUpgrade("tap-upgrade", tapUnlocked, D(state.hashes).gte(tapCost), maxBuyUnlocked, "executions / tap", `+${formatNumber(economy.getExecutionsPerTap())} executions / tap`, `level ${state.tapLevel}`, `cost ${formatNumber(tapCost, { shortenAt: 100000 })} hashes`)}
            ${renderUpgrade("ram-upgrade", ramUnlocked, D(state.hashes).gte(ramCost), maxBuyUnlocked, "RAM", `<span id="live-ram">${formatRamProfile(state.ramLevel)}</span>`, `level ${state.ramLevel}`, `cost ${formatNumber(ramCost, { shortenAt: 100000 })} hashes`)}
          </section>
        </div>
      `;
    }

    function renderFirstRamDownload() {
      const download = state.downloads?.firstRam;
      if (!download?.started || download.complete) return "";
      const progress = getDownloadProgress(download);
      return `
        <div class="download-panel">
          <div class="download-label" id="download-label">${getDownloadLabel(download)}</div>
          <div class="download-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.floor(progress)}">
            <div class="download-bar-fill" id="download-bar-fill" style="width: ${progress}%"></div>
          </div>
          <div class="download-percent" id="download-percent">${Math.floor(progress)}%</div>
        </div>
      `;
    }

    function getDownloadProgress(download) {
      return Math.max(0, Math.min(100, (download.bytes / FIRST_RAM_DOWNLOAD_BYTES) * 100));
    }

    function getDownloadLabel(download) {
      return Math.floor(state.lifetime.time / 1.2) % 2 === 0 ? "LOADING..." : formatDownloadAmount(download.bytes);
    }

    function formatDownloadAmount(bytes) {
      if (bytes < 100000) return `${Math.floor(bytes)} bytes`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    }

    function renderUpgrade(id, unlocked, canAfford, maxBuyUnlocked, title, effect, level, cost) {
      if (!unlocked) return "";
      const maxId = `${id}-max`;
      return `
        <div class="upgrade-row ${maxBuyUnlocked ? "has-max" : ""}">
          <button class="upgrade ${canAfford ? "can-afford" : ""}" id="${id}" type="button" ${canAfford ? "" : "disabled"}>
            <span><strong>${title}</strong><small>${effect}</small></span>
            <span class="meta"><small>${level}</small><small>${cost}</small></span>
          </button>
          ${maxBuyUnlocked ? `<button class="upgrade-max ${canAfford ? "can-afford" : ""}" id="${maxId}" type="button" ${canAfford ? "" : "disabled"}>max</button>` : ""}
        </div>
      `;
    }

    function renderResearchPage() {
      const available = researchData.filter((item) => !economy.isResearchBought(item.id));
      const purchased = researchData.filter((item) => economy.isResearchBought(item.id));
      return `
        <div class="research-page">
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
        </div>
      `;
    }

    function renderAvailableResearch(item) {
      const cost = economy.getResearchCost(item);
      const canAfford = D(state.hashes).gte(cost);
      return `
        <button class="card actionable ${canAfford ? "can-afford" : ""}" data-research-id="${item.id}" type="button" ${canAfford ? "" : "disabled"}>
          <span class="research-copy"><strong>${item.name}</strong><small>${item.description}</small></span>
          <span class="research-card-footer"><small>${effectText(item.effects)}</small><small>cost ${formatNumber(cost, WHOLE_EXPONENTIAL)} hashes</small></span>
        </button>
      `;
    }

    function renderPurchasedResearch(item) {
      const cost = economy.getResearchCost(item);
      return `
        <article class="card can-afford">
          <span class="research-copy"><strong>${item.name}</strong><small>${item.description}</small></span>
          <span class="research-card-footer"><small>${effectText(item.effects)}</small><small>cost ${formatNumber(cost, WHOLE_EXPONENTIAL)} hashes</small></span>
        </article>
      `;
    }

    function renderExecutionsPage() {
      const difficulty = getDifficultyLabel();
      const currentSource = formatNumber(state.totalSourceCode);
      const currentCpuValue = economy.getCpuMultiplierForSource(state.totalSourceCode);
      const nextCpuValue = economy.getCpuMultiplierForSource(state.totalSourceCode + state.sourceCode);
      const currentCpu = formatNumber(currentCpuValue);
      const runSource = formatNumber(state.sourceCode);
      const runCpuGain = formatNumber(Math.round(Math.max(0, nextCpuValue - currentCpuValue)));
      const sourceRate = formatNumber(economy.getSourceCodeRate() * 60);
      return `
        <section class="reboot-page">
          <p>Abandon this execution, record the fragments that survived it, and let another process wake with your errors already compiled.</p>
          <p>Memory contains <span>${currentSource}</span> source lines, multiplying this run's execution gain by <span>${currentCpu}</span>.</p>
          <p>If you reboot now, this run adds <span>${runSource}</span> lines to memory, increasing the next CPU multiplier by <span>${runCpuGain}</span>.</p>
          <p class="reboot-small">writing <span>${sourceRate}</span> lines each minute - difficulty ${difficulty}</p>
          <button class="reboot-button" id="reboot-button" type="button" ${state.sourceCode >= 1 ? "" : "disabled"}>reboot</button>
        </section>
      `;
    }

    function renderProgramsPage() {
      const unlockedPrograms = getUnlockedPrograms();
      const activeProgram = economy.getActiveProgram();
      const running = activeProgram ? 1 : 0;
      const slots = Math.max(1, Number(state.programs?.slots || config.programs?.slots || 1));
      return `
        <section class="programs-page">
          <div class="programs-status">
            <span>running programs: ${running} / ${slots}</span>
          </div>
          <div class="programs-bar" aria-hidden="true"></div>
          <div class="program-list">
            ${unlockedPrograms.length ? unlockedPrograms.map((program) => renderProgramCard(program, activeProgram, slots)).join("") : `<article class="program-card locked"><strong>no programs</strong><small>Research a program to load it here.</small></article>`}
          </div>
        </section>
      `;
    }

    function renderProgramCard(program, activeProgram, slots) {
      const isActive = activeProgram?.id === program.id;
      const blocked = activeProgram && !isActive && slots <= 1;
      const meta = isActive ? "running" : blocked ? "stop running program first" : "idle";
      return `
        <button class="program-card ${isActive ? "program-running" : ""} ${blocked ? "program-blocked" : ""}" type="button" data-program-id="${program.id}" ${blocked ? "disabled" : ""}>
          <strong>${program.name}</strong>
          <small>${program.description}</small>
          <span>${programEffectText(program.effects)} - ${meta}</span>
        </button>
      `;
    }

    function renderStoryPage() {
      const unlocked = storyData.filter((entry) => state.unlockedStories[entry.id]);
      return `
        <section class="story-list">
          ${(unlocked.length ? unlocked : [{ text: "The first message has not crossed the glass." }]).map((entry) => `
            <article class="story-entry"><p>${entry.text}</p></article>
          `).join("")}
        </section>
      `;
    }

    function renderStatisticsPage() {
      const stats = economy.getRuntimeBreakdown();
      return `
        <section class="statistics-page">
          <div class="stat-table">
            <div class="stat-header"><span></span><span>lifetime</span><span>total</span></div>
            ${statRow("time", formatTime(state.lifetime.time), formatTime(state.total.time))}
            ${statRow("taps", formatNumber(state.lifetime.taps, WHOLE_EXPONENTIAL), formatNumber(state.total.taps, WHOLE_EXPONENTIAL))}
            ${statRow("hashes", formatNumber(state.lifetime.hashes, WHOLE_EXPONENTIAL), formatNumber(state.total.hashes, WHOLE_EXPONENTIAL))}
            ${statRow("source code", formatNumber(state.lifetime.sourceCode, WHOLE_EXPONENTIAL), formatNumber(state.total.sourceCode, WHOLE_EXPONENTIAL))}
            ${statRow("cores", formatNumber(state.lifetime.coresPeak, WHOLE_EXPONENTIAL), formatNumber(state.total.coresPeak, WHOLE_EXPONENTIAL))}
            ${statRow("RAM", formatRamAmount(state.lifetime.ramPeak), formatRamAmount(state.total.ramPeak))}
            ${statRow("threads", formatNumber(getRamThreadCount(state.lifetime.ramPeak), WHOLE_EXPONENTIAL), formatNumber(getRamThreadCount(state.total.ramPeak), WHOLE_EXPONENTIAL))}
            ${statRow("cpu", `${formatNumber(stats.cpuMultiplier, WHOLE_EXPONENTIAL)}x`, `${formatNumber(stats.executionMultiplier, WHOLE_EXPONENTIAL)}x`)}
            ${statRow("cores", formatNumber(stats.effectiveCores, WHOLE_EXPONENTIAL), `${formatMultiplier(stats.coreMultiplier)}x`)}
            ${statRow("legacies", "", formatNumber(Object.keys(state.legacies).length, WHOLE_EXPONENTIAL))}
            ${statRow("reboots", "", formatNumber(state.reboots, WHOLE_EXPONENTIAL))}
          </div>
          <div class="stat-calculations">
            ${calcRow("tap", `${formatNumber(stats.tapBase, WHOLE_EXPONENTIAL)} x ${formatMultiplier(stats.cpuMultiplier)}(cpu) x ${formatNumber(stats.effectiveCores, WHOLE_EXPONENTIAL)}(core) (${formatCoreMultiplierFormula(stats.coreMultiplier)}) x ${formatMultiplier(stats.tapResearch)}(tap research/programs) = ${formatNumber(stats.executionsPerTap, WHOLE_EXPONENTIAL)} executions / tap`, `+${formatNumber(stats.executionsPerTap, WHOLE_EXPONENTIAL)} / tap`)}
            ${calcRow("threads", `${formatRamAmount(state.ramLevel)} holds ${formatThreadCount(stats.ramBase)} x ${formatMultiplier(stats.cpuMultiplier)}(cpu) x ${formatNumber(stats.effectiveCores, WHOLE_EXPONENTIAL)}(core) (${formatCoreMultiplierFormula(stats.coreMultiplier)}) x ${formatMultiplier(stats.ramResearch)}(RAM research/programs) = ${formatNumber(stats.ramRate, WHOLE_EXPONENTIAL)} executions / second`, `+${formatNumber(stats.ramGain8, WHOLE_EXPONENTIAL)} / 8s`)}
            ${calcRow("cores", `target ${formatNumber(stats.coreTarget, WHOLE_EXPONENTIAL)} from executions, tap level, RAM level, core research ${formatNumber(stats.coreResearch, WHOLE_EXPONENTIAL)}`, `+${formatNumber(stats.coreGain8, WHOLE_EXPONENTIAL)} / 8s`)}
            ${calcRow("source", `productive mass from executions, cores, RAM / difficulty ${formatNumber(stats.sourceDifficulty, WHOLE_EXPONENTIAL)} x source research ${formatNumber(stats.sourceResearch, WHOLE_EXPONENTIAL)}`, `+${formatNumber(stats.sourceGain8, WHOLE_EXPONENTIAL)} / 8s`)}
          </div>
        </section>
      `;
    }

    function renderLegaciesPage() {
      return `
        <section class="legacy-list">
          ${legacyData.map((legacy) => {
            const unlocked = Boolean(state.legacies[legacy.id]);
            return `
              <article class="legacy-entry ${unlocked ? "legacy-unlocked" : "legacy-locked"}">
                <strong>${legacy.name}</strong>
                <p>${legacy.description}</p>
                <small>${legacyEffectText(legacy)}</small>
              </article>
            `;
          }).join("")}
        </section>
      `;
    }

    function renderHelpPage() {
      return `
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
        <section class="about-page">
          <p>Matrix RAM is a small vanilla HTML, CSS, and JavaScript incremental game about teaching a dark system to reveal its own source.</p>
          <p class="muted">Save data is local to this browser.</p>
          <button class="reboot-button danger" id="reset-save" type="button">reset save</button>
          <button class="reboot-button" id="start-crash" type="button">start crash game</button>
          <div class="dev-multiplier-row" aria-label="Development tap multiplier">
            ${[1, 10, 100, 1000].map(renderDevMultiplier).join("")}
          </div>
        </section>
      `;
    }

    function renderDevMultiplier(multiplier) {
      const active = getDevClickMultiplier() === multiplier;
      return `
        <button class="dev-multiplier ${active ? "active" : ""}" type="button" data-dev-multiplier="${multiplier}">
          ${multiplier}x
        </button>
      `;
    }

    function getUnlockedPrograms() {
      return (config.programs?.items || []).filter((program) => state.programs?.unlocked?.[program.id]);
    }

    function statRow(label, lifetime, total) {
      return `<div class="stat-row"><span>${label}</span><strong>${lifetime}</strong><strong>${total}</strong></div>`;
    }

    function calcRow(label, formula, gain) {
      return `<div class="calc-row"><span>${label}</span><small>${formula}</small><strong>${gain}</strong></div>`;
    }

    function formatMultiplier(value) {
      if (value < 1000) return value.toFixed(2).replace(/\.?0+$/, "");
      return formatNumber(value, WHOLE_EXPONENTIAL);
    }

    function formatCoreMultiplierFormula(value) {
      const perCore = config.core?.multiplierPerCore || 0;
      return `${formatMultiplier(value)}x, 1 + cores x ${formatMultiplier(perCore)}`;
    }

    function formatRamProfile(level) {
      if (level <= 0) return "0 KB / 0 threads";
      return `${formatRamAmount(level)} / ${formatThreadCount(getRamThreadCount(level))}`;
    }

    function getRamThreadCount(level) {
      const safeLevel = Math.max(0, Math.floor(Number(level) || 0));
      if (safeLevel <= 0) return 0;
      const table = config.upgradeTables?.ram || {};
      return Number(table.baseIncome ?? 1) + safeLevel * Number(table.incomePerUpgrade ?? 1);
    }

    function formatThreadCount(count) {
      const threads = Math.floor(Math.max(0, Number(count) || 0));
      return `${formatNumber(threads, WHOLE_EXPONENTIAL)} ${threads === 1 ? "thread" : "threads"}`;
    }

    function formatRamAmount(level) {
      const safeLevel = Math.max(0, Math.floor(Number(level) || 0));
      if (safeLevel <= 0) return "0 KB";
      const baseKilobytes = Number(config.ramDisplay?.baseKilobytes || 64);
      const growth = Number(config.ramDisplay?.growth || 2);
      const kilobytes = baseKilobytes * Math.pow(growth, safeLevel - 1);
      const units = ["KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
      let scaled = kilobytes;
      let unitIndex = 0;
      while (scaled >= 1024 && unitIndex < units.length - 1) {
        scaled /= 1024;
        unitIndex += 1;
      }
      const shown = scaled >= 100 || Number.isInteger(scaled) ? Math.floor(scaled) : scaled.toFixed(1);
      return `${shown}${units[unitIndex]}`;
    }

    function legacyEffectText(legacy) {
      return economy.getLegacyEffects(legacy)
        .map(({ key, value, scaling }) => {
          const source = scaling?.stat ? ` (${scalingLabel(scaling.stat)} / ${formatNumber(scaling.divisor)})` : "";
          return `${effectLabel(key)} +${Math.round(value * 100)}%${source}`;
        })
        .join(", ");
    }

    function effectText(effects = {}) {
      return Object.entries(effects)
        .map(([key, value]) => {
          if (key === "maxBuy") return "max buy unlocked";
          if (key === "unlockProgram") return `program unlocked: ${programName(value)}`;
          if (key === "coreFlat") return `cores +${formatNumber(value, WHOLE_EXPONENTIAL)}`;
          return `${effectLabel(key)} ${value >= 0 ? "+" : ""}${Math.round(value * 100)}%`;
        })
        .join(", ");
    }

    function programEffectText(effects = {}) {
      return Object.entries(effects)
        .map(([key, value]) => key === "coreFlat"
          ? `+${formatNumber(value, WHOLE_EXPONENTIAL)} cores`
          : `${effectLabel(key)} +${Math.round(value * 100)}%`)
        .join(", ");
    }

    function programName(id) {
      return (config.programs?.items || []).find((program) => program.id === id)?.name || id;
    }

    function effectLabel(key) {
      const labels = {
        tapCostMultiplier: "tap upgrade cost",
        ramMultiplier: "RAM",
        ramCostMultiplier: "RAM upgrade cost",
        coreFlat: "cores"
      };
      return labels[key] || key.replace("Multiplier", "");
    }

    function getDifficultyLabel() {
      const ratio = state.sourceCode / Math.max(1, state.previousRunSourceCode);
      if (ratio >= 10) return "very hard";
      if (ratio >= 6) return "hard";
      if (ratio >= 2) return "tightening";
      return "soft";
    }

    function scalingLabel(stat) {
      const labels = {
        taps: "lifetime taps",
        time: "lifetime time",
        executions: "lifetime executions",
        sourceCode: "lifetime source",
        cores: "lifetime cores"
      };
      return labels[stat] || stat;
    }

    return {
      matrix: renderMatrixPage,
      research: renderResearchPage,
      programs: renderProgramsPage,
      executions: renderExecutionsPage,
      story: renderStoryPage,
      statistics: renderStatisticsPage,
      legacies: renderLegaciesPage,
      help: renderHelpPage,
      about: renderAboutPage
    };
  }

  window.MF.createPages = createPages;
})();
