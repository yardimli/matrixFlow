(async () => {
  const defaults = {
    config: {
      version: 2,
      startingState: {
        cycles: 0,
        tapLevel: 1,
        flowLevel: 0,
        cores: 0,
        sourceCode: 0,
        totalSourceCode: 0,
        cpuMultiplier: 1,
        reboots: 0,
        previousRunSourceCode: 1
      },
      unlocks: { tapUpgradeClicks: 5, flowCycles: 100, flowTapLevel: 10 },
      production: { baseCyclesPerTap: 1, tapLevelBonus: 0.42, flowCyclesPerSecond: 1.2, holdTapIntervalMs: 145 },
      costs: { tapBase: 10, tapGrowth: 1.38, flowBase: 125, flowGrowth: 1.82 },
      core: { baseDivisor: 180, tapLevelPower: 0.65, flowLevelPower: 1.2, multiplierPerCore: 0.045, sourceMultiplierPerLine: 0.002 },
      sourceCode: { baseDivisor: 300, cpuDivisor: 11, rebootDifficultyGrowth: 1.32, longRunHardeningStartRatio: 2, veryHardRatio: 10, minimumGain: 0 },
      matrix: {
        baseDensity: 0.05,
        flowIdleDensity: 0.12,
        tapDensityBoost: 0.04,
        maxDensity: 0.95,
        densityDecayPerSecond: 0.12,
        baseSpeed: 0.85,
        flowSpeed: 1.1,
        tapSpeedBoost: 0.18,
        speedDecayPerSecond: 0.7,
        holdDensityBoostPerSecond: 0.2,
        burstChance: 0.015,
        burstCount: 1,
        burstLifetime: 4.5,
        glyphs: "01<>[]{}#/\\|+-=SYSFLOWCORENODECYCLECPUROOT"
      },
      save: { key: "matrix-flow-save-v2", legacyKey: "matrix-flow-save-v1", intervalMs: 2500 }
    },
    research: [],
    story: [],
    legacies: []
  };

  const [config, researchData, storyData, legacyData] = await Promise.all([
    loadJson("game-parameters.json", defaults.config),
    loadJson("research.json", defaults.research),
    loadJson("story.json", defaults.story),
    loadJson("legacies.json", defaults.legacies)
  ]);

  const els = bindElements();
  const matrix = createMatrixEngine(document.getElementById("matrix"), config.matrix);
  const state = loadState();

  let activePage = "matrix";
  let holding = false;
  let holdTimer = 0;
  let lastFrame = performance.now();
  let pageDirty = true;

  disableContextBehavior();
  bindMenu();
  document.addEventListener("pointerup", stopHolding);
  document.addEventListener("pointercancel", stopHolding);
  setInterval(saveState, config.save.intervalMs);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) saveState();
  });

  requestAnimationFrame(tick);
  render();

  async function loadJson(path, fallback) {
    try {
      const response = await fetch(path, { cache: "no-store" });
      if (!response.ok) throw new Error(path);
      return await response.json();
    } catch {
      return fallback;
    }
  }

  function bindElements() {
    return {
      page: document.getElementById("page"),
      cycles: document.getElementById("cycles"),
      cores: document.getElementById("cores"),
      pageName: document.getElementById("page-name"),
      menuButtons: Array.from(document.querySelectorAll(".menu-button"))
    };
  }

  function freshStats() {
    return {
      time: 0,
      taps: 0,
      cycles: "0",
      sourceCode: 0,
      coresPeak: 0,
      flowPeak: 0,
      researchBought: 0
    };
  }

  function freshState() {
    return {
      version: 2,
      cycles: String(config.startingState.cycles),
      tapLevel: config.startingState.tapLevel,
      flowLevel: config.startingState.flowLevel,
      cores: config.startingState.cores,
      sourceCode: config.startingState.sourceCode,
      totalSourceCode: config.startingState.totalSourceCode,
      cpuMultiplier: config.startingState.cpuMultiplier,
      reboots: config.startingState.reboots,
      previousRunSourceCode: config.startingState.previousRunSourceCode,
      research: {},
      unlockedStories: {},
      legacies: {},
      lifetime: freshStats(),
      total: freshStats()
    };
  }

  function loadState() {
    const fresh = freshState();
    try {
      const saved = JSON.parse(localStorage.getItem(config.save.key));
      if (saved && saved.version === 2) return normalizeState({ ...fresh, ...saved });
    } catch {
      // Keep fresh state.
    }

    try {
      const legacy = JSON.parse(localStorage.getItem(config.save.legacyKey));
      if (legacy) {
        fresh.cycles = String(legacy.cycles || 0);
        fresh.tapLevel = Number(legacy.tapLevel || 1);
        fresh.flowLevel = Number(legacy.flowLevel || 0);
        fresh.total.cycles = String(legacy.totalCycles || 0);
        fresh.total.taps = Number(legacy.tapCount || 0);
        return normalizeState(fresh);
      }
    } catch {
      // Keep fresh state.
    }

    return fresh;
  }

  function normalizeState(next) {
    next.research ||= {};
    next.unlockedStories ||= {};
    next.legacies ||= {};
    next.lifetime = { ...freshStats(), ...(next.lifetime || {}) };
    next.total = { ...freshStats(), ...(next.total || {}) };
    next.version = 2;
    next.cycles = D(next.cycles).toString();
    next.lifetime.cycles = D(next.lifetime.cycles).toString();
    next.total.cycles = D(next.total.cycles).toString();
    next.previousRunSourceCode = Math.max(1, Number(next.previousRunSourceCode || 1));
    return next;
  }

  function saveState() {
    localStorage.setItem(config.save.key, JSON.stringify(state));
  }

  function disableContextBehavior() {
    document.addEventListener("contextmenu", (event) => event.preventDefault());
    document.addEventListener("selectstart", (event) => event.preventDefault());
    document.addEventListener("dragstart", (event) => event.preventDefault());
  }

  function bindMenu() {
    els.menuButtons.forEach((button) => {
      button.addEventListener("click", () => {
        activePage = button.dataset.page;
        pageDirty = true;
        stopHolding();
        render();
      });
    });
  }

  function tick(now) {
    const dt = Math.min((now - lastFrame) / 1000, 0.08);
    lastFrame = now;

    state.lifetime.time += dt;
    state.total.time += dt;

    const flowGain = getFlowRate() * dt;
    if (flowGain > 0) addCycles(flowGain);

    updateDerivedProgress(dt);

    if (holding && activePage === "matrix") {
      holdTimer += dt * 1000;
      matrix.addDensity(config.matrix.holdDensityBoostPerSecond * dt);
      while (holdTimer >= config.production.holdTapIntervalMs) {
        holdTimer -= config.production.holdTapIntervalMs;
        pulse();
      }
    }

    matrix.setFlowing(state.flowLevel > 0);
    matrix.step(dt);
    unlockProgress();
    render(false);
    requestAnimationFrame(tick);
  }

  function updateDerivedProgress(dt) {
    const coreTarget = getCoreTarget();
    state.cores += Math.max(0, coreTarget - state.cores) * Math.min(1, dt * 0.035);
    state.lifetime.coresPeak = Math.max(state.lifetime.coresPeak, state.cores);
    state.total.coresPeak = Math.max(state.total.coresPeak, state.cores);
    state.lifetime.flowPeak = Math.max(state.lifetime.flowPeak, state.flowLevel);
    state.total.flowPeak = Math.max(state.total.flowPeak, state.flowLevel);

    const sourceGain = getSourceCodeRate() * dt;
    if (sourceGain > config.sourceCode.minimumGain) {
      state.sourceCode += sourceGain;
      state.totalSourceCode += sourceGain;
      state.lifetime.sourceCode += sourceGain;
      state.total.sourceCode += sourceGain;
    }

    state.cpuMultiplier = getCpuMultiplier();
  }

  function pulse() {
    const gain = getCyclesPerTap();
    state.lifetime.taps += 1;
    state.total.taps += 1;
    addCycles(gain);
    matrix.pulse();
  }

  function addCycles(amount) {
    state.cycles = D(state.cycles).plus(amount).toString();
    state.lifetime.cycles = D(state.lifetime.cycles).plus(amount).toString();
    state.total.cycles = D(state.total.cycles).plus(amount).toString();
  }

  function isResearchBought(id) {
    return Boolean(state.research[id]);
  }

  function effectSum(key) {
    let total = 0;
    for (const item of researchData) {
      total += (isResearchBought(item.id) ? 1 : 0) * Number(item.effects?.[key] || 0);
    }
    for (const legacy of legacyData) {
      if (state.legacies[legacy.id]) total += Number(legacy.effects?.[key] || 0) * getLegacyPower();
    }
    return total;
  }

  function getLegacyPower() {
    return 1 + effectSumFromResearch("legacyMultiplier");
  }

  function effectSumFromResearch(key) {
    return researchData.reduce((sum, item) => sum + (isResearchBought(item.id) ? 1 : 0) * Number(item.effects?.[key] || 0), 0);
  }

  function getCycleMultiplier() {
    return Math.max(1, state.cpuMultiplier) *
      (1 + state.cores * config.core.multiplierPerCore) *
      (1 + state.totalSourceCode * config.core.sourceMultiplierPerLine);
  }

  function getCyclesPerTap() {
    const base = config.production.baseCyclesPerTap + (state.tapLevel - 1) * config.production.tapLevelBonus;
    return base * getCycleMultiplier() * (1 + effectSum("tapMultiplier"));
  }

  function getFlowRate() {
    const base = state.flowLevel * config.production.flowCyclesPerSecond * (1 + state.flowLevel * 0.055);
    return base * getCycleMultiplier() * (1 + effectSum("flowMultiplier"));
  }

  function getCoreTarget() {
    const researchBoost = 1 + effectSum("coreMultiplier");
    const tapPart = Math.pow(Math.max(1, state.tapLevel), config.core.tapLevelPower);
    const flowPart = Math.pow(Math.max(1, state.flowLevel + 1), config.core.flowLevelPower);
    const cyclePart = Math.sqrt(Math.max(0, decimalToNumber(state.lifetime.cycles)) / config.core.baseDivisor);
    return cyclePart * (tapPart + flowPart) * 0.08 * researchBoost;
  }

  function getSourceDifficulty() {
    const rebootDifficulty = Math.pow(config.sourceCode.rebootDifficultyGrowth, state.reboots);
    const ratio = state.sourceCode / Math.max(1, state.previousRunSourceCode);
    const start = config.sourceCode.longRunHardeningStartRatio;
    const veryHard = config.sourceCode.veryHardRatio;
    const longRunDifficulty = ratio <= start ? 1 : 1 + Math.pow((ratio - start) / (veryHard - start), 2) * 12;
    return rebootDifficulty * longRunDifficulty;
  }

  function getSourceCodeRate() {
    const productiveMass = Math.sqrt(Math.max(0, decimalToNumber(state.lifetime.cycles))) + state.cores * 4 + state.flowLevel * 2;
    return (productiveMass / config.sourceCode.baseDivisor) * (1 + effectSum("sourceMultiplier")) / getSourceDifficulty();
  }

  function getCpuMultiplier() {
    const fromSource = Math.max(1, 1 + state.totalSourceCode / config.sourceCode.cpuDivisor);
    return fromSource * (1 + effectSum("cpuMultiplier"));
  }

  function getTapCost() {
    return D(config.costs.tapBase).times(D(config.costs.tapGrowth).pow(state.tapLevel - 1)).floor();
  }

  function getFlowCost() {
    return D(config.costs.flowBase).times(D(config.costs.flowGrowth).pow(state.flowLevel)).floor();
  }

  function getResearchCost(item) {
    return D(item.cost).floor();
  }

  function isTapUpgradeUnlocked() {
    return state.total.taps >= config.unlocks.tapUpgradeClicks;
  }

  function isFlowUnlocked() {
    return D(state.total.cycles).gte(config.unlocks.flowCycles) && state.tapLevel >= config.unlocks.flowTapLevel;
  }

  function buyTapUpgrade() {
    const cost = getTapCost();
    if (D(state.cycles).lt(cost) || !isTapUpgradeUnlocked()) return;
    state.cycles = D(state.cycles).minus(cost).toString();
    state.tapLevel += 1;
    matrix.addDensity(0.08);
    pageDirty = true;
    render();
  }

  function buyFlowUpgrade() {
    const cost = getFlowCost();
    if (D(state.cycles).lt(cost) || !isFlowUnlocked()) return;
    state.cycles = D(state.cycles).minus(cost).toString();
    state.flowLevel += 1;
    matrix.addDensity(0.16);
    pageDirty = true;
    render();
  }

  function buyResearch(id) {
    const item = researchData.find((entry) => entry.id === id);
    if (!item) return;
    if (isResearchBought(item.id)) return;
    const cost = getResearchCost(item);
    if (D(state.cycles).lt(cost)) return;
    state.cycles = D(state.cycles).minus(cost).toString();
    state.research[item.id] = true;
    state.lifetime.researchBought += 1;
    state.total.researchBought += 1;
    pageDirty = true;
    render();
  }

  function reboot() {
    if (state.sourceCode < 1) return;
    state.reboots += 1;
    state.previousRunSourceCode = Math.max(1, state.sourceCode);
    state.cycles = "0";
    state.tapLevel = 1;
    state.flowLevel = 0;
    state.cores = 0;
    state.sourceCode = 0;
    state.lifetime = freshStats();
    state.cpuMultiplier = getCpuMultiplier();
    matrix.addDensity(0.35);
    pageDirty = true;
    activePage = "matrix";
    render();
    saveState();
  }

  function unlockProgress() {
    for (const entry of storyData) {
      if (!state.unlockedStories[entry.id] && conditionMet(entry.condition)) {
        state.unlockedStories[entry.id] = true;
        pageDirty = true;
      }
    }

    for (const legacy of legacyData) {
      if (!state.legacies[legacy.id] && conditionMet(legacy.condition)) {
        state.legacies[legacy.id] = true;
        pageDirty = true;
      }
    }
  }

  function conditionMet(condition) {
    return getStat(condition.stat) >= Number(condition.gte || 0);
  }

  function getStat(stat) {
    const map = {
      totalTaps: state.total.taps,
      taps: state.lifetime.taps,
      cycles: decimalToNumber(state.lifetime.cycles),
      totalCycles: decimalToNumber(state.total.cycles),
      flowLevel: state.flowLevel,
      cores: state.cores,
      sourceCode: state.sourceCode,
      totalSourceCode: state.totalSourceCode,
      researchBought: state.total.researchBought,
      reboots: state.reboots
    };
    return Number(map[stat] || 0);
  }

  function render(updatePage = true) {
    els.cycles.textContent = formatNumber(state.cycles);
    els.cores.textContent = formatNumber(state.cores);
    els.pageName.textContent = activePage;
    els.menuButtons.forEach((button) => button.classList.toggle("active", button.dataset.page === activePage));

    if (updatePage || pageDirty) {
      renderPage();
      pageDirty = false;
    } else {
      updateLiveBits();
    }
  }

  function renderPage() {
    const pages = {
      matrix: renderMatrixPage,
      research: renderResearchPage,
      cycles: renderCyclesPage,
      story: renderStoryPage,
      statistics: renderStatisticsPage,
      legacies: renderLegaciesPage,
      help: renderHelpPage,
      about: renderAboutPage
    };
    els.page.innerHTML = pages[activePage]();
    bindPageEvents();
  }

  function bindPageEvents() {
    const matrixPage = document.getElementById("matrix-page");
    if (matrixPage) {
      matrixPage.addEventListener("pointerdown", (event) => {
        if (event.target.closest("button:not(#tap-zone)")) return;
        event.preventDefault();
        holding = true;
        holdTimer = 0;
        pulse();
        render();
      }, { passive: false });
    }

    document.getElementById("tap-upgrade")?.addEventListener("click", buyTapUpgrade);
    document.getElementById("flow-upgrade")?.addEventListener("click", buyFlowUpgrade);
    document.querySelectorAll("[data-research-id]").forEach((button) => {
      button.addEventListener("click", () => buyResearch(button.dataset.researchId));
    });
    document.querySelectorAll(".accordion-item").forEach((item) => {
      item.addEventListener("toggle", () => {
        if (!item.open) return;
        document.querySelectorAll(".accordion-item").forEach((other) => {
          if (other !== item) other.open = false;
        });
      });
    });
    document.getElementById("reboot-button")?.addEventListener("click", reboot);
    document.getElementById("reset-save")?.addEventListener("click", () => {
      localStorage.removeItem(config.save.key);
      location.reload();
    });
  }

  function stopHolding() {
    holding = false;
  }

  function updateLiveBits() {
    const live = {
      "live-flow": `${formatNumber(getFlowRate())} cycles / second`,
      "live-source": `${formatNumber(state.sourceCode)} lines`,
      "live-core-mult": `${formatNumber(getCycleMultiplier())}x cycle gain`
    };
    Object.entries(live).forEach(([id, value]) => {
      const node = document.getElementById(id);
      if (node) node.textContent = value;
    });
  }

  function renderMatrixPage() {
    const tapUnlocked = isTapUpgradeUnlocked();
    const flowUnlocked = isFlowUnlocked();
    const tapCost = getTapCost();
    const flowCost = getFlowCost();
    return `
      <div class="matrix-page" id="matrix-page">
        <button class="tap-zone" id="tap-zone" type="button" aria-label="Pulse matrix"></button>
        <section class="upgrade-stack" aria-label="Upgrades">
          ${renderUpgrade("tap-upgrade", tapUnlocked, D(state.cycles).gte(tapCost), "cycles / tap", `+${formatNumber(getCyclesPerTap())} cycles / tap`, `level ${state.tapLevel}`, `cost ${formatNumber(tapCost)}`)}
          ${renderUpgrade("flow-upgrade", flowUnlocked, D(state.cycles).gte(flowCost), "flow", `<span id="live-flow">${formatNumber(getFlowRate())} cycles / second</span>`, `level ${state.flowLevel}`, `cost ${formatNumber(flowCost)}`)}
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
    return `
      <h1 class="page-title">research</h1>
      <section class="card-grid">
        ${researchData.map((item) => {
          const bought = isResearchBought(item.id);
          const cost = getResearchCost(item);
          const canAfford = D(state.cycles).gte(cost) && !bought;
          return `
            <button class="card actionable ${canAfford ? "can-afford" : ""}" data-research-id="${item.id}" type="button" ${canAfford ? "" : "disabled"}>
              <span>
                <strong>${item.name}</strong>
                <small>${item.description}</small>
              </span>
              <span class="meta">
                <small>${bought ? "known" : "unknown"}</small>
                <small>${bought ? "complete" : `cost ${formatNumber(cost)}`}</small>
              </span>
            </button>
          `;
        }).join("")}
      </section>
    `;
  }

  function renderCyclesPage() {
    const newCpu = getCpuMultiplier();
    const difficulty = getDifficultyLabel();
    return `
      <h1 class="page-title">cycles</h1>
      <section class="reboot-card">
        <strong>reboot</strong>
        <small class="muted">Rebooting keeps total source code, research, legacies, and CPU growth. Current cycles, taps, flow, cores, and lifetime stats restart.</small>
        <div class="stat-table">
          ${statRow("source code", `${formatNumber(state.sourceCode)} lines`, `${formatNumber(state.totalSourceCode)} lines`)}
          ${statRow("cpu multiplier", `${formatNumber(state.cpuMultiplier)}x`, `${formatNumber(newCpu)}x`)}
          ${statRow("difficulty", difficulty, `reboot ${state.reboots}`)}
          ${statRow("writing rate", `${formatNumber(getSourceCodeRate())}/s`, "this run")}
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
          <article class="card story-entry">
            <strong>${entry.title}</strong>
            <p>${entry.text}</p>
          </article>
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
              <span class="meta"><small>${unlocked ? "active" : "locked"}</small><small>${legacyEffectText(legacy.effects)}</small></span>
            </article>
          `;
        }).join("")}
      </section>
    `;
  }

  function renderHelpPage() {
    const entries = [
      ["what is the matrix", "The matrix is the visible surface of a hidden computation. It falls because the system is leaking meaning. When you tap it, you are not pressing a button; you are convincing the dark to admit that it can be changed."],
      ["cycles", "Cycles are the first currency of motion. They are small acts of processor time, gathered by touch and later by flow. Every cycle says: something happened, and the machine had to spend itself to make it true."],
      ["taps", "A tap is direct contact with the simulation. Early on, the matrix only moves when you disturb it. Later, the tap becomes less important as a gesture and more important as a signal that other systems learn to amplify."],
      ["flow", "Flow is work that continues after the hand leaves the glass. Once flow exists, the rain keeps falling. The system has learned a rhythm and no longer needs permission for every drop."],
      ["cores", "Cores are dense knots of progress. They form slowly, almost reluctantly, from cycles, flow, and repeated upgrades. A core does not merely add more cycles; it teaches all future cycle gain to arrive heavier."],
      ["research", "Research is the act of naming a mechanism before it fully belongs to you. Each discovery is bought once. The early names are cheap; the later ones ask for numbers large enough to feel less like prices and more like coordinates."],
      ["source code", "Source code lines are fragments of the world behind the world. They appear slowly at first. After every reboot, writing them becomes harder, as though the machine recognizes your handwriting and starts hiding the margins."],
      ["cpu multiplier", "The CPU multiplier is the pressure of all written source code against the next run. It begins at one. It rises from source code, research, and legacy, quietly making each new beginning less innocent than the last."],
      ["reboot", "A reboot is not death. It is a bargain with memory. You surrender the current run's cycles, taps, flow, and cores, but the source code remains, and the next version wakes with a deeper processor under it."],
      ["legacies", "Legacies are achievements the machine cannot forget. Once unlocked, they survive every reboot and return as multipliers. They are not trophies; they are scars that learned mathematics."],
      ["statistics", "Statistics are the mirror that refuses poetry. Lifetime means this run. Total means every run. Between the two columns, you can see what was reset, what survived, and what was never really yours to lose."]
    ];
    return `
      <h1 class="page-title">help</h1>
      <section class="accordion">
        ${entries.map(([title, text], index) => `
          <details class="accordion-item" ${index === 0 ? "open" : ""}>
            <summary>${title}</summary>
            <p>${text}</p>
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

  function formatTime(seconds) {
    const totalSeconds = Math.floor(seconds);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function D(value) {
    return new Decimal(value ?? 0);
  }

  function decimalToNumber(value) {
    const number = D(value).toNumber();
    return Number.isFinite(number) ? number : Number.MAX_VALUE;
  }

  function formatNumber(value) {
    const decimal = D(value);
    if (!Decimal.isFinite(decimal)) return decimal.toString();
    if (decimal.gte("1e8")) {
      if (decimal.layer > 1) return decimal.toStringWithDecimalPlaces(2);
      return `${decimal.mantissaWithDecimalPlaces(2)}e${decimal.exponent}`;
    }
    const number = Math.max(0, decimal.toNumber() || 0);
    if (number < 1000) {
      const rounded = Math.floor(number * 10) / 10;
      return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
    }
    const units = ["k", "M", "B", "T", "Qa", "Qi", "Sx"];
    let scaled = number;
    let unit = "";
    for (const next of units) {
      if (scaled < 1000) break;
      scaled /= 1000;
      unit = next;
    }
    return `${scaled >= 100 ? scaled.toFixed(0) : scaled.toFixed(2)}${unit}`;
  }

  function createMatrixEngine(canvas, settings) {
    const ctx = canvas.getContext("2d");
    const glyphs = Array.from(settings.glyphs);
    const columns = [];
    const bursts = [];
    let width = 0;
    let height = 0;
    let cell = 18;
    let density = 0;
    let speedBoost = 0;
    let flowing = false;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cell = width < 520 ? 15 : 20;
      seedColumns();
    };

    const seedColumns = () => {
      columns.length = 0;
      const count = Math.ceil(width / cell);
      for (let i = 0; i < count; i += 1) {
        columns.push({
          x: i * cell,
          y: Math.random() * -height,
          speed: (48 + Math.random() * 72) * settings.baseSpeed,
          phase: Math.random() * 100,
          threshold: Math.random()
        });
      }
    };

    const drawGlyph = (text, x, y, alpha, bright, bold) => {
      ctx.fillStyle = bright ? `rgba(232, 255, 239, ${alpha})` : `rgba(49, 255, 143, ${alpha})`;
      ctx.font = `${bold ? "700 " : ""}${cell}px "Courier New", monospace`;
      ctx.fillText(text, x, y);
    };

    window.addEventListener("resize", resize);
    resize();

    return {
      setFlowing(value) {
        flowing = value;
      },
      pulse() {
        density = Math.min(settings.maxDensity, density + settings.tapDensityBoost);
        speedBoost = Math.min(2.4, speedBoost + settings.tapSpeedBoost);
        if (Math.random() > settings.burstChance) return;
        for (let i = 0; i < settings.burstCount; i += 1) {
          const trail = 8 + Math.floor(Math.random() * 6);
          bursts.push({
            x: Math.floor(Math.random() * Math.ceil(width / cell)) * cell,
            y: -trail * cell - Math.random() * height * 0.25,
            speed: 190 + Math.random() * 170,
            age: 0,
            maxAge: settings.burstLifetime,
            trail,
            seed: Math.floor(Math.random() * glyphs.length)
          });
        }
      },
      addDensity(amount) {
        density = Math.min(settings.maxDensity, density + amount);
      },
      step(dt) {
        const idleDensity = flowing ? settings.flowIdleDensity : 0;
        density = Math.max(idleDensity, density - settings.densityDecayPerSecond * dt);
        speedBoost = Math.max(0, speedBoost - settings.speedDecayPerSecond * dt);

        ctx.fillStyle = `rgba(7, 9, 9, ${flowing || density > 0.02 ? 0.22 : 0.58})`;
        ctx.fillRect(0, 0, width, height);
        if (!flowing && density <= 0.004 && bursts.length === 0) return;

        ctx.textAlign = "center";
        ctx.textBaseline = "top";

        columns.forEach((column, index) => {
          const activeDensity = Math.max(settings.baseDensity, density);
          if (!flowing && column.threshold > activeDensity) return;
          if (flowing && column.threshold > activeDensity * 1.6) return;

          column.y += column.speed * (settings.baseSpeed + (flowing ? settings.flowSpeed : 0) + speedBoost + density) * dt;
          if (column.y > height + cell * 8) {
            column.y = Math.random() * -height * 0.5;
            column.speed = (48 + Math.random() * 72) * settings.baseSpeed;
          }

          const trail = 6 + Math.floor(density * 18);
          for (let row = 0; row < trail; row += 1) {
            const y = column.y - row * cell;
            if (y < -cell || y > height) continue;
            const glyph = glyphs[(index * 13 + row * 7 + Math.floor(performance.now() / 90)) % glyphs.length];
            const floor = flowing ? 0.4 : 0.18;
            const alpha = Math.max(floor, (1 - row / trail) * (floor + density * 0.6));
            drawGlyph(glyph, column.x, y, alpha, row === 0, false);
          }
        });

        for (let i = bursts.length - 1; i >= 0; i -= 1) {
          const burst = bursts[i];
          burst.age += dt;
          burst.y += burst.speed * dt * (1 + speedBoost * 0.4);
          if (burst.y - burst.trail * cell > height || burst.age > burst.maxAge) {
            bursts.splice(i, 1);
            continue;
          }
          const travel = Math.min(1, Math.max(0, burst.y / Math.max(1, height)));
          const fadeStart = 0.72;
          const fadeT = travel <= fadeStart ? 0 : Math.min(1, (travel - fadeStart) / (1 - fadeStart));
          const fade = 1 - (fadeT * fadeT * (3 - 2 * fadeT));
          for (let row = 0; row < burst.trail; row += 1) {
            const y = burst.y - row * cell;
            if (y < -cell || y > height + cell) continue;
            const trailFade = 1 - row / burst.trail;
            const alpha = Math.max(0, fade * trailFade * 0.92);
            if (alpha < 0.025) continue;
            const glyph = glyphs[(burst.seed + row * 11) % glyphs.length];
            drawGlyph(glyph, burst.x, y, alpha, row < 2, true);
          }
        }
      }
    };
  }
})();
