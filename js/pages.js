(function () {
  const { D, formatNumber, formatTime } = window.MF.utils;

  function createPages(context) {
    const { config, state, researchData, storyData, backdoorData, helpData, economy, isDebugMode, getDevClickMultiplier, getShowCalculations } = context;
    const FIRST_RAM_DOWNLOAD_BYTES = 1474560;
    const WHOLE_EXPONENTIAL = { scientificDecimals: 2 };

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
            ${renderUpgrade("tap-upgrade", tapUnlocked, D(state.hashes).gte(tapCost), maxBuyUnlocked, "executions / tap", `+${formatNumber(economy.getExecutionsPerTap())} executions / tap`, `level ${state.tapLevel}`, `cost ${formatNumber(tapCost, { shortenAt: 100000 })}`)}
            ${renderUpgrade("ram-upgrade", ramUnlocked, D(state.hashes).gte(ramCost), maxBuyUnlocked, "RAM", `<span id="live-ram">${formatRamProfile(state.ramLevel)}</span>`, `level ${state.ramLevel}`, `cost ${formatNumber(ramCost, { shortenAt: 100000 })}`)}
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
      return "kung_fu.exe";
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
          <span class="research-card-footer"><small>${effectText(item.effects)}</small><small>${formatNumber(cost, WHOLE_EXPONENTIAL)}</small></span>
        </button>
      `;
    }

    function renderPurchasedResearch(item) {
      const cost = economy.getResearchCost(item);
      return `
        <article class="card can-afford">
          <span class="research-copy"><strong>${item.name}</strong><small>${item.description}</small></span>
          <span class="research-card-footer"><small>${effectText(item.effects)}</small><small>${formatNumber(cost, WHOLE_EXPONENTIAL)}</small></span>
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
          <p>EMP (Electromagnetic Pulse) resets the current run.</p>
          <p>ROM contains <span>${currentSource}</span> source lines, giving this run a CPU multiplier of <span>${currentCpu}</span>.</p>
          <p>Right after the EMP, in a nanosecond, Source Code Extraction commits <span>${runSource}</span> new source lines and gives the next run <span>${runCpuGain}</span> more CPU multiplier.</p>
          <p class="reboot-small">Source Code Extraction rate <span>${sourceRate}</span> lines / minute - difficulty ${difficulty}</p>
          <button class="reboot-button" id="reboot-button" type="button" ${state.sourceCode >= 1 ? "" : "disabled"}>EMP</button>
        </section>
      `;
    }

    function renderProgramsPage() {
      const unlockedPrograms = getUnlockedPrograms();
      const activePrograms = economy.getActivePrograms();
      const running = activePrograms.length;
      const slots = Math.max(1, Number(state.programs?.slots || config.programs?.slots || 1));
      return `
        <section class="programs-page">
          <div class="programs-status">
            <span>running programs: ${running} / ${slots}</span>
          </div>
          <div class="programs-bar" role="progressbar" aria-label="Running programs" aria-valuemin="0" aria-valuemax="${slots}" aria-valuenow="${running}">
            <div class="programs-bar-fill" style="width: ${Math.min(100, (running / slots) * 100)}%"></div>
          </div>
          <div class="program-list">
            ${unlockedPrograms.length ? unlockedPrograms.map((program) => renderProgramCard(program, activePrograms, slots)).join("") : `<article class="program-card locked"><span class="research-copy"><strong>no programs</strong><small>Research a program to load it here.</small></span></article>`}
          </div>
        </section>
      `;
    }

    function renderOperatorPage() {
      const cost = D("1e10");
      const ready = D(state.lifetime.hashes).gte(cost);
      const selected = state.operator?.choice;
      const tier2Cost = D("1e16");
      const tier2Ready = D(state.lifetime.hashes).gte(tier2Cost);
      const tier2Selected = state.operator?.tier2Choice;
      const coreValue = formatNumber(economy.getEffectiveCores(), WHOLE_EXPONENTIAL);
      const botValue = formatNumber(economy.getEffectiveBots(), WHOLE_EXPONENTIAL);
      const threadValue = formatNumber(economy.getEffectiveThreads(), WHOLE_EXPONENTIAL);
      return `
        <section class="operator-page">
          <div class="operator-choice-grid">
            ${renderOperatorCard("social", "operator line", "The Operator stays on comms and loads support processes into the Matrix. Each core brings more bots online.", `(+${coreValue})`, ready, selected)}
            ${renderOperatorCard("solitary", "redline jack", "The Operator locks you into a clean jack-in route. Each core sharpens direct taps into stronger executions.", `(x${coreValue})`, ready, selected)}
            ${renderOperatorHint(selected, tier2Selected, tier2Cost)}
            ${selected ? renderOperatorTier2Card("broadcast", "broadcast tap", "Open a noisy side channel through the Operator. Rogue programs become available beside the normal stack.", `multiply tap output by bots (x${botValue})`, tier2Ready, tier2Selected, tier2Cost) : ""}
            ${selected ? renderOperatorTier2Card("ghost", "ghost protocol", "Cut a silent route through the redline. Rogue programs become available beside the normal stack.", `multiply all hash rate by threads (x${threadValue})`, tier2Ready, tier2Selected, tier2Cost) : ""}
          </div>
        </section>
      `;
    }

    function renderOperatorHint(selected, tier2Selected, tier2Cost) {
      if (!selected || tier2Selected) return "";
      return `<p class="operator-hint">${formatNumber(tier2Cost, WHOLE_EXPONENTIAL)} lifetime hashes</p>`;
    }

    function operatorName(id) {
      const names = {
        social: "operator line",
        solitary: "redline jack"
      };
      return names[id] || id;
    }

    function operatorTier2Name(id) {
      const names = {
        broadcast: "broadcast tap",
        ghost: "ghost protocol"
      };
      return names[id] || id;
    }

    function renderOperatorCard(id, name, description, effect, ready, selected) {
      const isSelected = selected === id;
      const locked = Boolean(selected) && !isSelected;
      const disabled = !ready || Boolean(selected);
      return `
        <button class="program-card operator-card ${isSelected ? "program-running" : ""} ${locked || !ready ? "program-blocked" : ""}" type="button" data-operator-choice="${id}" ${disabled ? "disabled" : ""}>
          <strong>${name}</strong>
          <small>${description} <span class="operator-effect">${effect}</span></small>
        </button>
      `;
    }

    function renderOperatorTier2Card(id, name, description, effect, ready, selected, cost) {
      const isSelected = selected === id;
      const locked = Boolean(selected) && !isSelected;
      const disabled = !ready || Boolean(selected);
      return `
        <button class="program-card operator-card ${isSelected ? "program-running" : ""} ${locked || !ready ? "program-blocked" : ""}" type="button" data-operator-tier2-choice="${id}" ${disabled ? "disabled" : ""}>
          <strong>${name}</strong>
          <small>${description} <span class="operator-effect">${effect}</span></small>
          <span>cost ${formatNumber(cost, WHOLE_EXPONENTIAL)} lifetime hashes</span>
        </button>
      `;
    }

    function renderProgramCard(program, activePrograms, slots) {
      const isActive = activePrograms.some((activeProgram) => activeProgram.id === program.id);
      const blocked = activePrograms.length >= slots && !isActive;
      return `
        <button class="program-card ${isActive ? "program-running" : ""} ${blocked ? "program-blocked" : ""}" type="button" data-program-id="${program.id}" ${blocked ? "disabled" : ""}>
          <span class="research-copy"><strong>${program.name}</strong><small>${program.description}</small></span>
        </button>
      `;
    }

    function renderRogueProgramsPage() {
      const programs = config.roguePrograms?.items || [];
      const slots = Math.max(1, Number(state.programs?.slots || config.programs?.slots || 1));
      return `
        <section class="programs-page rogue-programs-page">
          <div class="program-list rogue-program-grid">
            ${programs.map(renderRogueProgramCard).join("")}
            ${renderProgramSlotUpgradeCard(slots)}
          </div>
        </section>
      `;
    }

    function renderRogueProgramCard(program) {
      const level = economy.getRogueProgramLevel(program.id);
      const cost = economy.getRogueProgramCost(program);
      const perLevel = Number(program.effects?.hashMultiplier || 0);
      const canAfford = D(state.hashes).gte(cost);
      return `
        <button class="program-card ${level > 0 ? "program-running" : ""} ${canAfford ? "can-afford" : ""}" type="button" data-rogue-program-id="${program.id}" ${canAfford ? "" : "disabled"}>
          <span class="research-copy"><strong>${program.name}</strong><small>${program.description}</small></span>
          <span class="research-card-footer"><small>level ${level} / x${formatMultiplier(Math.pow(1 + perLevel, level || 1))} ${level > 0 ? "total" : "next"}</small><small>${formatNumber(cost, WHOLE_EXPONENTIAL)}</small></span>
        </button>
      `;
    }

    function renderProgramSlotUpgradeCard(slots) {
      const cost = economy.getProgramSlotUpgradeCost();
      const canAfford = cost && D(state.hashes).gte(cost);
      if (!cost) {
        return `
          <article class="program-card program-running">
            <span class="research-copy"><strong>parallel loader</strong><small>Normal program stack is fully widened.</small></span>
            <span class="research-card-footer"><small>${slots} / 5 running programs</small><small>max</small></span>
          </article>
        `;
      }
      return `
        <button class="program-card ${canAfford ? "can-afford" : ""}" id="program-slot-upgrade" type="button" ${canAfford ? "" : "disabled"}>
          <span class="research-copy"><strong>parallel loader</strong><small>Increase the running program limit on the Programs page. Rogue programs keep running beside it.</small></span>
          <span class="research-card-footer"><small>${slots} / 5 running programs</small><small>${formatNumber(cost, WHOLE_EXPONENTIAL)}</small></span>
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
      const showCalculations = getShowCalculations();
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
            ${statRow("bots", formatNumber(state.lifetime.botsPeak, WHOLE_EXPONENTIAL), formatNumber(state.total.botsPeak, WHOLE_EXPONENTIAL))}
            ${statRow("cpus", formatNumber(stats.cpuMultiplier, WHOLE_EXPONENTIAL), formatNumber(stats.cpuMultiplier, WHOLE_EXPONENTIAL))}
            ${statRow("backdoors", "", formatNumber(Object.keys(state.backdoors).length, WHOLE_EXPONENTIAL))}
            ${statRow("EMPs", "", formatNumber(state.reboots, WHOLE_EXPONENTIAL))}
          </div>
          <button class="stat-calculations-toggle" id="stat-calculations-toggle" type="button" aria-expanded="${showCalculations}">
            calculations
          </button>
          <div class="stat-calculations ${showCalculations ? "" : "hidden"}">
            ${calcRow("tap", `${formatNumber(stats.tapBase, WHOLE_EXPONENTIAL)} x ${formatMultiplier(stats.cpuMultiplier)}(cpu) x ${formatNumber(stats.effectiveCores, WHOLE_EXPONENTIAL)}(core) (${formatCoreMultiplierFormula(stats.coreMultiplier)}) x ${formatMultiplier(stats.botEfficiency)}(bot efficiency) x ${formatMultiplier(stats.operatorHashMultiplier)}(operator hash) x ${formatMultiplier(stats.rogueMultiplier)}(rogue) x ${formatMultiplier(stats.tapResearch)}(tap research/programs) x ${formatMultiplier(stats.operatorTapMultiplier)}(operator tap) = ${formatNumber(stats.executionsPerTap, WHOLE_EXPONENTIAL)} executions / tap`, `+${formatNumber(stats.executionsPerTap, WHOLE_EXPONENTIAL)} / tap`)}
            ${calcRow("threads", `${formatRamAmount(state.ramLevel)} holds ${formatThreadCount(stats.ramBase)} x ${formatMultiplier(stats.cpuMultiplier)}(cpu) x ${formatNumber(stats.effectiveCores, WHOLE_EXPONENTIAL)}(core) (${formatCoreMultiplierFormula(stats.coreMultiplier)}) x ${formatMultiplier(stats.botEfficiency)}(bot efficiency) x ${formatMultiplier(stats.operatorHashMultiplier)}(operator hash) x ${formatMultiplier(stats.rogueMultiplier)}(rogue) x ${formatMultiplier(stats.ramResearch)}(RAM research/programs) = ${formatNumber(stats.ramRate, WHOLE_EXPONENTIAL)} executions / second`, `+${formatNumber(stats.ramGain8, WHOLE_EXPONENTIAL)} / 8s`)}
            ${calcRow("cores", `target ${formatNumber(stats.coreTarget, WHOLE_EXPONENTIAL)} from executions, tap level, RAM level, core research ${formatNumber(stats.coreResearch, WHOLE_EXPONENTIAL)}, bots ${formatNumber(stats.effectiveBots, WHOLE_EXPONENTIAL)} (${formatMultiplier(stats.botEfficiency)}x)`, `+${formatNumber(stats.coreGain8, WHOLE_EXPONENTIAL)} / 8s`)}
            ${calcRow("source", `productive mass from executions, cores, RAM / difficulty ${formatNumber(stats.sourceDifficulty, WHOLE_EXPONENTIAL)} x source research ${formatNumber(stats.sourceResearch, WHOLE_EXPONENTIAL)} x bot efficiency ${formatMultiplier(stats.botEfficiency)}`, `+${formatNumber(stats.sourceGain8, WHOLE_EXPONENTIAL)} / 8s`)}
          </div>
        </section>
      `;
    }

    function renderBackdoorsPage() {
      return `
        <section class="backdoor-list">
          ${backdoorData.map((backdoor) => {
            const unlocked = Boolean(state.backdoors[backdoor.id]);
            return `
              <article class="backdoor-entry ${unlocked ? "backdoor-unlocked" : "backdoor-locked"}">
                <strong>${backdoor.name}</strong>
                <p>${backdoor.description}</p>
                <small>${backdoorEffectText(backdoor)}</small>
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
          <p>The Blue Pill is a small vanilla HTML, CSS, and JavaScript incremental game about teaching a dark system to reveal its own source.</p>
          <p>This is a modern themed remake of <a href="https://dragonmegaliths.com/games/grimoire" target="_blank" rel="noopener noreferrer">Grimoire Incremental</a>.</p>
          <p class="muted">Save data is local to this browser.</p>
          <button class="reboot-button danger" id="reset-save" type="button">reset save</button>
          ${isDebugMode() ? `
            <button class="reboot-button" id="start-crash" type="button">start crash game</button>
            <div class="dev-multiplier-row" aria-label="Development tap multiplier">
              ${[1, 10, 100, 1000].map(renderDevMultiplier).join("")}
            </div>
          ` : ""}
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
      if (value < 1000) return value.toFixed(2);
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
      const bytes = D(baseKilobytes).times(1000).times(D(growth).pow(safeLevel - 1));
      const kilobytes = bytes.div(1000);
      const terabyteBytes = D("1e12");
      if (bytes.gte(terabyteBytes.times(100))) {
        return formatNumber(bytes, { scientificAt: 0, scientificDecimals: 2 });
      }
      const units = ["KB", "MB", "GB", "TB"];
      let scaled = kilobytes.toNumber();
      let unitIndex = 0;
      while (scaled >= 1000 && unitIndex < units.length - 1) {
        scaled /= 1000;
        unitIndex += 1;
      }
      return `${scaled.toFixed(2)}${units[unitIndex]}`;
    }

    function backdoorEffectText(backdoor) {
      return economy.getBackdoorEffects(backdoor)
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
          if (key === "unlockProgram") return programName(value);
          if (key === "coreFlat") return `cores +${formatNumber(value, WHOLE_EXPONENTIAL)}`;
          if (key === "botFlat") return `bots +${formatNumber(value, WHOLE_EXPONENTIAL)}`;
          if (key === "hashMultiplier") return `hash rate +${Math.round(value * 100)}%`;
          return `${effectLabel(key)} ${value >= 0 ? "+" : ""}${Math.round(value * 100)}%`;
        })
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
        coreFlat: "cores",
        botFlat: "bots"
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
        cores: "lifetime cores",
        bots: "lifetime bots"
      };
      return labels[stat] || stat;
    }

    return {
      matrix: renderMatrixPage,
      research: renderResearchPage,
      programs: renderProgramsPage,
      roguePrograms: renderRogueProgramsPage,
      operator: renderOperatorPage,
      executions: renderExecutionsPage,
      story: renderStoryPage,
      statistics: renderStatisticsPage,
      backdoors: renderBackdoorsPage,
      help: renderHelpPage,
      about: renderAboutPage
    };
  }

  window.MF.createPages = createPages;
})();
