(async function () {
  const { loadJson, D, formatNumber, disableContextBehavior } = window.MF.utils;
  const [config, researchData, storyData, legacyData, helpData] = await Promise.all([
    loadJson("game-parameters.json"),
    loadJson("research.json"),
    loadJson("story.json"),
    loadJson("legacies.json"),
    loadJson("help.json")
  ]);

  const els = {
    page: document.getElementById("page"),
    cycles: document.getElementById("cycles"),
    cores: document.getElementById("cores"),
    pageName: document.getElementById("page-name"),
    menuButtons: Array.from(document.querySelectorAll(".menu-button"))
  };

  const store = window.MF.createStateStore(config);
  const state = store.loadState();
  const economy = window.MF.createEconomy(config, researchData, legacyData, state);
  const matrix = window.MF.createMatrixEngine(document.getElementById("matrix"), config.matrix);
  const pages = window.MF.createPages({ state, researchData, storyData, legacyData, helpData, economy });

  let activePage = config.ui.defaultPage;
  let holding = false;
  let holdTimer = 0;
  let lastFrame = performance.now();
  let pageDirty = true;
  let resetting = false;

  disableContextBehavior();
  bindMenu();
  document.addEventListener("pointerup", stopHolding);
  document.addEventListener("pointercancel", stopHolding);
  const saveTimer = setInterval(() => {
    if (!resetting) store.saveState(state);
  }, config.save.intervalMs);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && !resetting) store.saveState(state);
  });

  requestAnimationFrame(tick);
  render();

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
    const dt = Math.min((now - lastFrame) / 1000, config.timing.maxFrameSeconds);
    lastFrame = now;

    state.lifetime.time += dt;
    state.total.time += dt;

    const flowGain = economy.getFlowRate() * dt;
    if (flowGain > 0) economy.addCycles(flowGain);

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
    const coreTarget = economy.getCoreTarget();
    state.cores += Math.max(0, coreTarget - state.cores) * Math.min(1, dt * config.core.convergenceRate);
    state.lifetime.coresPeak = Math.max(state.lifetime.coresPeak, state.cores);
    state.total.coresPeak = Math.max(state.total.coresPeak, state.cores);
    state.lifetime.flowPeak = Math.max(state.lifetime.flowPeak, state.flowLevel);
    state.total.flowPeak = Math.max(state.total.flowPeak, state.flowLevel);

    const sourceGain = economy.getSourceCodeRate() * dt;
    if (sourceGain > config.sourceCode.minimumGain) {
      state.sourceCode += sourceGain;
      state.totalSourceCode += sourceGain;
      state.lifetime.sourceCode += sourceGain;
      state.total.sourceCode += sourceGain;
    }

    state.cpuMultiplier = economy.getCpuMultiplier();
  }

  function pulse() {
    state.lifetime.taps += 1;
    state.total.taps += 1;
    economy.addCycles(economy.getCyclesPerTap());
    matrix.pulse();
  }

  function buyTapUpgrade() {
    const cost = economy.getTapCost();
    if (D(state.cycles).lt(cost) || !economy.isTapUpgradeUnlocked()) return;
    state.cycles = D(state.cycles).minus(cost).toString();
    state.tapLevel += 1;
    matrix.addDensity(config.matrix.upgradeDensityBoost);
    pageDirty = true;
    render();
  }

  function buyFlowUpgrade() {
    const cost = economy.getFlowCost();
    if (D(state.cycles).lt(cost) || !economy.isFlowUnlocked()) return;
    state.cycles = D(state.cycles).minus(cost).toString();
    state.flowLevel += 1;
    matrix.addDensity(config.matrix.flowUpgradeDensityBoost);
    pageDirty = true;
    render();
  }

  function buyResearch(id) {
    const item = researchData.find((entry) => entry.id === id);
    if (!item || economy.isResearchBought(item.id)) return;
    const cost = economy.getResearchCost(item);
    if (D(state.cycles).lt(cost)) return;
    state.cycles = D(state.cycles).minus(cost).toString();
    state.research[item.id] = true;
    state.lifetime.researchBought += 1;
    state.total.researchBought += 1;
    pageDirty = true;
    render();
  }

  function reboot() {
    if (state.sourceCode < config.reboot.minimumSourceCode) return;
    state.reboots += 1;
    state.previousRunSourceCode = Math.max(1, state.sourceCode);
    state.cycles = "0";
    state.tapLevel = config.startingState.tapLevel;
    state.flowLevel = config.startingState.flowLevel;
    state.cores = config.startingState.cores;
    state.sourceCode = config.startingState.sourceCode;
    state.research = {};
    state.lifetime = store.freshStats();
    state.cpuMultiplier = economy.getCpuMultiplier();
    matrix.addDensity(config.matrix.rebootDensityBoost);
    activePage = "matrix";
    pageDirty = true;
    render();
    store.saveState(state);
  }

  function unlockProgress() {
    for (const entry of storyData) {
      if (!state.unlockedStories[entry.id] && economy.conditionMet(entry.condition)) {
        state.unlockedStories[entry.id] = true;
        pageDirty = true;
      }
    }

    for (const legacy of legacyData) {
      if (!state.legacies[legacy.id] && economy.conditionMet(legacy.condition)) {
        state.legacies[legacy.id] = true;
        pageDirty = true;
      }
    }
  }

  function render(updatePage = true) {
    els.cycles.textContent = formatNumber(state.cycles);
    els.cores.textContent = formatNumber(state.cores);
    els.pageName.textContent = activePage;
    els.menuButtons.forEach((button) => button.classList.toggle("active", button.dataset.page === activePage));

    if (updatePage || pageDirty) {
      els.page.innerHTML = pages[activePage]();
      bindPageEvents();
      pageDirty = false;
    } else {
      updateLiveBits();
    }
  }

  function bindPageEvents() {
    document.getElementById("matrix-page")?.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button:not(#tap-zone)")) return;
      event.preventDefault();
      holding = true;
      holdTimer = 0;
      pulse();
      render();
    }, { passive: false });

    document.getElementById("tap-upgrade")?.addEventListener("click", buyTapUpgrade);
    document.getElementById("flow-upgrade")?.addEventListener("click", buyFlowUpgrade);
    document.querySelectorAll("[data-research-id]").forEach((button) => {
      button.addEventListener("click", () => buyResearch(button.dataset.researchId));
    });
    document.querySelectorAll("[data-research-view]").forEach((button) => {
      button.addEventListener("click", () => {
        const view = button.dataset.researchView;
        document.querySelectorAll("[data-research-view]").forEach((other) => {
          other.classList.toggle("active", other === button);
        });
        document.querySelectorAll("[data-research-panel]").forEach((panel) => {
          panel.classList.toggle("hidden", panel.dataset.researchPanel !== view);
        });
      });
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
      resetting = true;
      clearInterval(saveTimer);
      store.clearSave();
      location.reload();
    });
  }

  function updateLiveBits() {
    const live = {
      "live-flow": `${formatNumber(economy.getFlowRate())} cycles / second`,
      "live-source": `${formatNumber(state.sourceCode)} lines`,
      "live-core-mult": `${formatNumber(economy.getCycleMultiplier())}x cycle gain`
    };
    Object.entries(live).forEach(([id, value]) => {
      const node = document.getElementById(id);
      if (node) node.textContent = value;
    });
  }

  function stopHolding() {
    holding = false;
  }
})();
