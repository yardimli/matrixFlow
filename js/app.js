(async function () {
  const { loadJson, D, finiteNumber, formatNumber, disableContextBehavior } = window.MF.utils;
  const [config, researchData, storyData, legacyData, helpData] = await Promise.all([
    loadJson("game-parameters.json"),
    loadJson("research.json"),
    loadJson("story.json"),
    loadJson("legacies.json"),
    loadJson("help.json")
  ]);

  const els = {
    game: document.getElementById("game"),
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
  let devClickMultiplier = 1;
  const pages = window.MF.createPages({
    state,
    researchData,
    storyData,
    legacyData,
    helpData,
    economy,
    getDevClickMultiplier: () => devClickMultiplier
  });
  const FIRST_FLOW_DOWNLOAD_BYTES = 1474560;
  const FIRST_FLOW_DOWNLOAD_START_CYCLES = 1440;
  const DOWNLOAD_BYTES_PER_CYCLE = 4;
  const FIRST_FLOW_DOWNLOAD_REWARD_SOURCE = 101;
  const CRASH_RUNNER_X = 72;

  let activePage = config.ui.defaultPage;
  let holding = false;
  let holdTimer = 0;
  let lastFrame = performance.now();
  let pageDirty = true;
  let matrixUpgradeState = "";
  let storyOverlay = null;
  let storyQueue = [];
  let crashScreen = null;
  let activeCrash = null;
  let resetting = false;

  disableContextBehavior();
  createStoryOverlay();
  createCrashScreen();
  bindMenu();
  document.addEventListener("pointerdown", showButtonPressFeedback, { capture: true });
  document.addEventListener("pointerdown", startScreenPulse, { passive: false, capture: true });
  document.addEventListener("keydown", showKeyboardButtonPressFeedback, { capture: true });
  document.addEventListener("pointerup", stopHolding, { capture: true });
  document.addEventListener("pointercancel", stopHolding, { capture: true });
  if (!window.PointerEvent) {
    document.addEventListener("touchstart", showButtonPressFeedback, { capture: true });
    document.addEventListener("touchstart", startTouchPulse, { passive: false, capture: true });
    document.addEventListener("touchend", stopHolding, { capture: true });
    document.addEventListener("touchcancel", stopHolding, { capture: true });
  }
  const saveTimer = setInterval(() => {
    if (!resetting) store.saveState(state);
  }, config.save.intervalMs);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && !resetting) store.saveState(state);
  });

  requestAnimationFrame(tick);
  syncFirstFlowDownloadOnLoad();
  render();

  function bindMenu() {
    els.menuButtons.forEach((button) => {
      button.addEventListener("click", () => {
        if (button.hidden) return;
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
    maybeStartCrash();

    const flowGain = economy.getFlowRate() * dt;
    if (flowGain > 0) {
      const lifetimeCyclesBeforeGain = state.lifetime.cycles;
      economy.addCycles(flowGain);
      processFirstFlowDownloadGain(flowGain, lifetimeCyclesBeforeGain);
    }

    updateDerivedProgress(dt);

    if (holding) {
      holdTimer += dt * 1000;
      matrix.addDensity(config.matrix.holdDensityBoostPerSecond * dt);
      while (holdTimer >= config.production.holdTapIntervalMs) {
        holdTimer -= config.production.holdTapIntervalMs;
        pulse();
      }
    }

    matrix.setFlowing(state.flowLevel > 0);
    matrix.step(dt);
    updateCrash(dt);
    unlockProgress();
    refreshMatrixUpgradeState();
    render(false);
    requestAnimationFrame(tick);
  }

  function updateDerivedProgress(dt) {
    const coreTarget = economy.getCoreTarget();
    state.cores = finiteNumber(state.cores);
    state.cores = finiteNumber(state.cores + Math.max(0, coreTarget - state.cores) * Math.min(1, dt * config.core.convergenceRate));
    state.lifetime.coresPeak = Math.max(finiteNumber(state.lifetime.coresPeak), state.cores);
    state.total.coresPeak = Math.max(finiteNumber(state.total.coresPeak), state.cores);
    state.lifetime.flowPeak = Math.max(finiteNumber(state.lifetime.flowPeak), state.flowLevel);
    state.total.flowPeak = Math.max(finiteNumber(state.total.flowPeak), state.flowLevel);

    const sourceGain = economy.getSourceCodeRate() * dt;
    if (sourceGain > config.sourceCode.minimumGain) {
      state.sourceCode = finiteNumber(state.sourceCode + sourceGain);
      state.lifetime.sourceCode = finiteNumber(state.lifetime.sourceCode + sourceGain);
      state.total.sourceCode = finiteNumber(state.total.sourceCode + sourceGain);
    }

    state.cpuMultiplier = economy.getCpuMultiplier();
  }

  function pulse() {
    state.lifetime.taps += devClickMultiplier;
    state.total.taps += devClickMultiplier;
    const cycleGain = economy.getCyclesPerTap() * devClickMultiplier;
    const lifetimeCyclesBeforeGain = state.lifetime.cycles;
    economy.addCycles(cycleGain);
    processFirstFlowDownloadGain(cycleGain, lifetimeCyclesBeforeGain);
    maybeStartCrash();
    matrix.pulse();
    refreshMatrixUpgradeState();
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

  function buyMaxTapUpgrades() {
    buyMaxUpgrades({
      isUnlocked: economy.isTapUpgradeUnlocked,
      getCost: economy.getTapCost,
      apply: () => {
        state.tapLevel += 1;
        matrix.addDensity(config.matrix.upgradeDensityBoost);
      }
    });
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

  function buyMaxFlowUpgrades() {
    buyMaxUpgrades({
      isUnlocked: economy.isFlowUnlocked,
      getCost: economy.getFlowCost,
      apply: () => {
        state.flowLevel += 1;
        matrix.addDensity(config.matrix.flowUpgradeDensityBoost);
      }
    });
  }

  function buyMaxUpgrades(upgrade) {
    if (!economy.isResearchBought("max_buy") || !upgrade.isUnlocked()) return;
    let bought = 0;
    for (let guard = 0; guard < 10000; guard += 1) {
      const cost = upgrade.getCost();
      if (D(state.cycles).lt(cost)) break;
      state.cycles = D(state.cycles).minus(cost).toString();
      upgrade.apply();
      bought += 1;
    }
    if (!bought) return;
    pageDirty = true;
    render();
  }

  function startFirstFlowDownloadIfReady() {
    if (D(state.lifetime.cycles).lt(FIRST_FLOW_DOWNLOAD_START_CYCLES)) return;
    startFirstFlowDownload();
  }

  function startFirstFlowDownload() {
    const download = state.downloads.firstFlow;
    if (download.started || download.complete || download.rewarded) return;
    download.started = true;
    download.bytes = 0;
    pageDirty = true;
  }

  function processFirstFlowDownloadGain(cycleGain, lifetimeCyclesBeforeGain) {
    const before = D(lifetimeCyclesBeforeGain);
    const after = D(state.lifetime.cycles);
    if (!state.downloads.firstFlow.started) {
      if (after.lt(FIRST_FLOW_DOWNLOAD_START_CYCLES)) return;
      startFirstFlowDownload();
    }
    const eligibleCycles = before.lt(FIRST_FLOW_DOWNLOAD_START_CYCLES)
      ? after.minus(FIRST_FLOW_DOWNLOAD_START_CYCLES).toNumber()
      : cycleGain;
    if (eligibleCycles > 0) advanceFirstFlowDownload(eligibleCycles);
  }

  function syncFirstFlowDownloadOnLoad() {
    let download = state.downloads.firstFlow;
    if (D(state.lifetime.cycles).lt(FIRST_FLOW_DOWNLOAD_START_CYCLES) && !download.complete && !download.rewarded) {
      resetFirstFlowDownload();
    }
    startFirstFlowDownloadIfReady();
    download = state.downloads.firstFlow;
    if (download.bytes >= FIRST_FLOW_DOWNLOAD_BYTES || (download.complete && !download.rewarded)) {
      download.bytes = FIRST_FLOW_DOWNLOAD_BYTES;
      completeFirstFlowDownload();
    }
  }

  function advanceFirstFlowDownload(cycles) {
    const download = state.downloads.firstFlow;
    if (!download.started || download.complete) return;
    download.bytes = Math.min(FIRST_FLOW_DOWNLOAD_BYTES, finiteNumber(download.bytes + cycles * DOWNLOAD_BYTES_PER_CYCLE));
    if (download.bytes < FIRST_FLOW_DOWNLOAD_BYTES) return;
    completeFirstFlowDownload();
  }

  function completeFirstFlowDownload() {
    const download = state.downloads.firstFlow;
    if (download.complete) return;
    download.complete = true;
    if (!download.rewarded) {
      addSourceCode(FIRST_FLOW_DOWNLOAD_REWARD_SOURCE);
      download.rewarded = true;
    }
    pageDirty = true;
  }

  function addSourceCode(lines) {
    state.sourceCode = finiteNumber(state.sourceCode + lines);
    state.lifetime.sourceCode = finiteNumber(state.lifetime.sourceCode + lines);
    state.total.sourceCode = finiteNumber(state.total.sourceCode + lines);
  }

  function resetFirstFlowDownload() {
    state.downloads.firstFlow = {
      started: false,
      complete: false,
      bytes: 0,
      rewarded: false
    };
  }

  function resetCrashes() {
    state.crashes.completed = 0;
  }

  function maybeStartCrash() {
    if (activeCrash) return;
    if (state.lifetime.time < getNextCrashTime()) return;
    startCrash();
  }

  function getCrashIntervalSeconds() {
    return 600;
  }

  function getNextCrashTime() {
    return (state.crashes.completed + 1) * getCrashIntervalSeconds();
  }

  function getCrashReward() {
    return finiteNumber(Math.floor(state.sourceCode * 0.05));
  }

  function getNextCrashObstacleX(crash = activeCrash) {
    const speed = crash?.speed || 170;
    const jumps = crash?.jumps || 0;
    const gapSeconds = 0.85 + Math.random() * (1.8 + Math.min(1.4, jumps * 0.08));
    const jumpSpace = Math.min(220, jumps * 8);
    return 150 + speed * gapSeconds * 0.5 + jumpSpace * 0.5 + Math.random() * 90;
  }

  function startCrash(options = {}) {
    const scheduled = options.scheduled !== false;
    const crashNumber = state.crashes.completed + 1;
    if (scheduled) state.crashes.completed = crashNumber;
    activeCrash = {
      countdown: 3,
      countdownTimer: 0,
      running: false,
      reward: getCrashReward(),
      runnerY: 0,
      velocity: 0,
      obstacleX: 340,
      obstacleScored: false,
      jumps: 0,
      speed: 170 + Math.min(90, crashNumber * 4)
    };
    activeCrash.obstacleX = getNextCrashObstacleX(activeCrash);
    stopHolding();
    renderCrashScreen();
  }

  function updateCrash(dt) {
    if (!activeCrash) return;
    if (!activeCrash.running) {
      activeCrash.countdownTimer += dt;
      if (activeCrash.countdownTimer >= 1) {
        activeCrash.countdownTimer = 0;
        activeCrash.countdown -= 1;
        if (activeCrash.countdown <= 0) activeCrash.running = true;
      }
      renderCrashScreen();
      return;
    }

    activeCrash.velocity -= 1350 * dt;
    activeCrash.runnerY = Math.max(0, activeCrash.runnerY + activeCrash.velocity * dt);
    if (activeCrash.runnerY === 0 && activeCrash.velocity < 0) activeCrash.velocity = 0;

    activeCrash.obstacleX -= activeCrash.speed * dt;
    if (!activeCrash.obstacleScored && activeCrash.obstacleX < CRASH_RUNNER_X - 18) {
      activeCrash.obstacleScored = true;
      activeCrash.jumps += 1;
      addSourceCode(activeCrash.reward);
      activeCrash.speed *= 1.25;
    }

    if (isCrashCollision()) {
      endCrash();
      return;
    }

    if (activeCrash.obstacleX < -24) {
      activeCrash.obstacleX = getNextCrashObstacleX();
      activeCrash.obstacleScored = false;
    }

    renderCrashScreen();
  }

  function jumpCrashRunner() {
    if (!activeCrash || !activeCrash.running || activeCrash.runnerY > 0) return;
    activeCrash.velocity = 520;
    renderCrashScreen();
  }

  function isCrashCollision() {
    if (!activeCrash) return false;
    const nearObstacle = activeCrash.obstacleX > CRASH_RUNNER_X - 18 && activeCrash.obstacleX < CRASH_RUNNER_X + 24;
    return nearObstacle && activeCrash.runnerY < 34;
  }

  function endCrash() {
    activeCrash = null;
    crashScreen.classList.add("hidden");
    store.saveState(state);
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
    state.totalSourceCode = finiteNumber(state.totalSourceCode + state.sourceCode);
    state.cycles = "0";
    state.tapLevel = config.startingState.tapLevel;
    state.flowLevel = config.startingState.flowLevel;
    state.cores = config.startingState.cores;
    state.sourceCode = config.startingState.sourceCode;
    state.research = {};
    resetFirstFlowDownload();
    resetCrashes();
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
        queueStory(entry);
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

  function createStoryOverlay() {
    storyOverlay = document.createElement("section");
    storyOverlay.className = "story-overlay hidden";
    storyOverlay.setAttribute("aria-modal", "true");
    storyOverlay.setAttribute("role", "dialog");
    storyOverlay.innerHTML = `
      <div class="story-overlay-content">
        <p id="story-overlay-text"></p>
        <button class="story-continue" id="story-continue" type="button">continue</button>
      </div>
    `;
    storyOverlay.querySelector("#story-continue").addEventListener("click", closeStoryOverlay);
    els.game.appendChild(storyOverlay);
  }

  function queueStory(entry) {
    storyQueue.push(entry);
    if (storyOverlay.classList.contains("hidden")) showNextStory();
  }

  function showNextStory() {
    const entry = storyQueue[0];
    if (!entry) {
      storyOverlay.classList.add("hidden");
      return;
    }
    storyOverlay.querySelector("#story-overlay-text").textContent = entry.text;
    storyOverlay.classList.remove("hidden");
    storyOverlay.querySelector("#story-continue").focus({ preventScroll: true });
  }

  function closeStoryOverlay() {
    storyQueue.shift();
    showNextStory();
  }

  function createCrashScreen() {
    crashScreen = document.createElement("section");
    crashScreen.className = "crash-screen hidden";
    crashScreen.setAttribute("aria-label", "Crash recovery runner");
    crashScreen.innerHTML = `
      <div class="crash-game">
        <div class="crash-title">SYSTEM TRACE LOST</div>
        <div class="crash-countdown" id="crash-countdown"></div>
        <div class="crash-reward" id="crash-reward"></div>
        <div class="crash-track">
          <div class="crash-ground"></div>
          <div class="crash-runner" id="crash-runner"></div>
          <div class="crash-obstacle" id="crash-obstacle"></div>
        </div>
        <div class="crash-jumps" id="crash-jumps"></div>
      </div>
    `;
    crashScreen.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      jumpCrashRunner();
    }, { passive: false });
    crashScreen.addEventListener("touchstart", (event) => {
      event.preventDefault();
      event.stopPropagation();
      jumpCrashRunner();
    }, { passive: false });
    els.game.appendChild(crashScreen);
  }

  function renderCrashScreen() {
    if (!activeCrash) return;
    crashScreen.classList.remove("hidden");
    const countdown = crashScreen.querySelector("#crash-countdown");
    const reward = crashScreen.querySelector("#crash-reward");
    const jumps = crashScreen.querySelector("#crash-jumps");
    const track = crashScreen.querySelector(".crash-track");
    const runner = crashScreen.querySelector("#crash-runner");
    const obstacle = crashScreen.querySelector("#crash-obstacle");
    const groundDuration = Math.max(0.04, 46 / Math.max(1, activeCrash.speed));
    const trackDuration = Math.max(0.04, 28 / Math.max(1, activeCrash.speed));
    countdown.textContent = activeCrash.running ? "" : String(activeCrash.countdown);
    reward.textContent = `+${formatNumber(activeCrash.reward)} source / clean jump`;
    jumps.textContent = `${formatNumber(activeCrash.jumps)} jumps`;
    track.style.setProperty("--crash-ground-duration", `${groundDuration}s`);
    track.style.setProperty("--crash-track-duration", `${trackDuration}s`);
    runner.style.transform = `translateY(${-activeCrash.runnerY}px)`;
    obstacle.style.transform = `translateX(${activeCrash.obstacleX}px)`;
  }

  function render(updatePage = true) {
    if (activePage === "cycles" && !isCyclesPageUnlocked()) activePage = config.ui.defaultPage;
    els.cycles.textContent = formatNumber(state.cycles, { shortenAt: 100000, decimalsFromUnit: "M" });
    els.cores.textContent = formatNumber(state.cores);
    els.pageName.textContent = activePage;
    updateMenuAvailability();
    els.menuButtons.forEach((button) => button.classList.toggle("active", button.dataset.page === activePage));

    if (updatePage || pageDirty) {
      els.page.innerHTML = pages[activePage]();
      bindPageEvents();
      pageDirty = false;
      matrixUpgradeState = getMatrixUpgradeState();
    } else {
      updateLiveBits();
    }
  }

  function refreshMatrixUpgradeState() {
    if (activePage !== "matrix") return;
    const next = getMatrixUpgradeState();
    if (next === matrixUpgradeState) return;
    matrixUpgradeState = next;
    pageDirty = true;
  }

  function getMatrixUpgradeState() {
    const tapCost = economy.getTapCost();
    const flowCost = economy.getFlowCost();
    return [
      economy.isTapUpgradeUnlocked(),
      D(state.cycles).gte(tapCost),
      state.tapLevel,
      economy.isFlowUnlocked(),
      D(state.cycles).gte(flowCost),
      state.flowLevel
    ].join("|");
  }

  function bindPageEvents() {
    document.getElementById("tap-upgrade")?.addEventListener("click", buyTapUpgrade);
    document.getElementById("tap-upgrade-max")?.addEventListener("click", buyMaxTapUpgrades);
    document.getElementById("flow-upgrade")?.addEventListener("click", buyFlowUpgrade);
    document.getElementById("flow-upgrade-max")?.addEventListener("click", buyMaxFlowUpgrades);
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
    document.getElementById("start-crash")?.addEventListener("click", () => {
      if (!activeCrash) startCrash({ scheduled: false });
    });
    document.querySelectorAll("[data-dev-multiplier]").forEach((button) => {
      button.addEventListener("click", () => {
        devClickMultiplier = Number(button.dataset.devMultiplier) || 1;
        pageDirty = true;
        render();
      });
    });
  }

  function updateMenuAvailability() {
    els.menuButtons.forEach((button) => {
      if (button.dataset.page !== "cycles") return;
      button.hidden = !isCyclesPageUnlocked();
    });
  }

  function isCyclesPageUnlocked() {
    return state.total.taps >= 256;
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
    updateDownloadBits();
  }

  function updateDownloadBits() {
    const download = state.downloads.firstFlow;
    if (!download.started || download.complete) return;
    const progress = getFirstFlowDownloadProgress();
    const label = document.getElementById("download-label");
    const bar = document.getElementById("download-bar-fill");
    const percent = document.getElementById("download-percent");
    if (label) label.textContent = getFirstFlowDownloadLabel();
    if (bar) bar.style.width = `${progress}%`;
    if (percent) percent.textContent = `${Math.floor(progress)}%`;
  }

  function getFirstFlowDownloadProgress() {
    return Math.max(0, Math.min(100, (state.downloads.firstFlow.bytes / FIRST_FLOW_DOWNLOAD_BYTES) * 100));
  }

  function getFirstFlowDownloadLabel() {
    return Math.floor(state.lifetime.time / 1.2) % 2 === 0 ? "LOADING..." : formatDownloadAmount(state.downloads.firstFlow.bytes);
  }

  function formatDownloadAmount(bytes) {
    if (bytes < 100000) return `${Math.floor(bytes)} bytes`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  function showButtonPressFeedback(event) {
    const button = event.target instanceof Element ? event.target.closest("button") : null;
    pressButton(button);
  }

  function showKeyboardButtonPressFeedback(event) {
    if (event.key !== "Enter" && event.key !== " ") return;
    const button = event.target instanceof Element ? event.target.closest("button") : null;
    pressButton(button);
  }

  function pressButton(button) {
    if (!(button instanceof HTMLButtonElement) || button.disabled) return;
    button.classList.remove("button-pressed");
    void button.offsetWidth;
    button.classList.add("button-pressed");
    window.setTimeout(() => button.classList.remove("button-pressed"), 160);
  }

  function startScreenPulse(event) {
    if (event.button !== undefined && event.button !== 0) return;
    if (activeCrash) {
      event.preventDefault();
      event.stopPropagation();
      jumpCrashDino();
      return;
    }
    startPulseFromEvent(event, event.clientX, event.clientY);
  }

  function startTouchPulse(event) {
    const touch = event.changedTouches?.[0];
    if (!touch) return;
    if (activeCrash) {
      event.preventDefault();
      event.stopPropagation();
      jumpCrashDino();
      return;
    }
    startPulseFromEvent(event, touch.clientX, touch.clientY);
  }

  function startPulseFromEvent(event, x, y) {
    if (!isPulseTarget(event, x, y)) return;

    event.preventDefault();
    holding = true;
    holdTimer = 0;
    pulse();
    render();
  }

  function isPulseTarget(event, x, y) {
    const target = event.target;
    if (!(target instanceof Element)) return false;
    if (isBlockedPulseElement(target)) return false;

    const path = event.composedPath?.() || [];
    if (path.some((node) => node instanceof Element && isBlockedPulseElement(node))) return false;

    const topElement = document.elementFromPoint(x, y);
    if (!(topElement instanceof Element)) return false;
    if (topElement.closest(".story-overlay")) return false;
    if (topElement.closest("strong, small, span, p, summary")) return false;
    if (topElement.closest(".card, .legacy-entry, .story-entry, .stat-row, .accordion-item")) return false;
    return true;
  }

  function isBlockedPulseElement(element) {
    return Boolean(element.closest("button, a, input, textarea, select, label, summary"));
  }

  function stopHolding() {
    holding = false;
  }
})();
