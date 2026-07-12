(async function () {
  const { loadJson, D, finiteNumber, formatNumber, disableContextBehavior } = window.MF.utils;
  const [config, researchData, programDownloadData, storyData, backdoorData, helpData] = await Promise.all([
    loadJson("game-parameters.json"),
    loadJson("research.json"),
    loadJson("program-downloads.json"),
    loadJson("story.json"),
    loadJson("backdoors.json"),
    loadJson("help.json")
  ]);

  const els = {
    game: document.getElementById("game"),
    page: document.getElementById("page"),
    hashes: document.getElementById("hashes"),
    botsMetric: document.getElementById("bots-metric"),
    bots: document.getElementById("bots"),
    botsLabel: document.getElementById("bots-label"),
    cores: document.getElementById("cores"),
    coresLabel: document.getElementById("cores-label"),
    pageName: document.getElementById("page-name"),
    menuButtons: Array.from(document.querySelectorAll(".menu-button"))
  };

  const store = window.MF.createStateStore(config, programDownloadData);
  const state = store.loadState();
  const economy = window.MF.createEconomy(config, researchData, backdoorData, state, programDownloadData);
  const matrix = window.MF.createMatrixEngine(document.getElementById("matrix"), config.matrix);
  const debugMode = new URLSearchParams(window.location.search).get("debug") === "true";
  let devClickMultiplier = 1;
  const pages = window.MF.createPages({
    config,
    state,
    programDownloadData,
    researchData,
    storyData,
    backdoorData,
    helpData,
    economy,
    isDebugMode: () => debugMode,
    getShowCalculations: () => showCalculations,
    getDevClickMultiplier: () => devClickMultiplier,
    getResearchForecastHashes: () => forecastHashes.research,
    getProgramForecastHashes: () => forecastHashes.programs
  });
  const DOWNLOAD_BYTES_PER_EXECUTION = 4;
  const CRASH_RUNNER_X = 72;
  const FORECAST_SECONDS = 600;
  const FORECAST_REFRESH_SECONDS = 30;

  let activePage = config.ui.defaultPage;
  let holding = false;
  let holdTimer = 0;
  let lastFrame = performance.now();
  let pageDirty = true;
  let matrixUpgradeState = "";
  let introOverlay = null;
  let introMode = state.intro?.firstRain ? "done" : state.intro?.redPillTaken ? "redTap" : "choice";
  let storyOverlay = null;
  let storyQueue = [];
  let storyContinueTimer = null;
  let crashScreen = null;
  let activeCrash = null;
  let resetting = false;
  let showCalculations = false;
  let forecastHashes = {
    research: String(state.hashes),
    programs: String(state.hashes)
  };
  let nextForecastRefreshAt = 0;

  disableContextBehavior();
  createIntroOverlay();
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
  syncProgramDownloadsOnLoad();
  render();
  renderIntroOverlay();

  function bindMenu() {
    els.menuButtons.forEach((button) => {
      button.addEventListener("click", () => {
        if (button.hidden) return;
        activePage = button.dataset.page;
        refreshForecastForPage(activePage, true);
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

    const ramGain = economy.getRamRate() * dt;
    if (ramGain > 0) {
      const lifetimeExecutionsBeforeGain = state.lifetime.executions;
      economy.addExecutions(ramGain);
      processProgramDownloadGain(ramGain, lifetimeExecutionsBeforeGain);
    }

    updateDerivedProgress(dt);
    updateOperator(dt);

    if (holding) {
      holdTimer += dt * 1000;
      matrix.addDensity(config.matrix.holdDensityBoostPerSecond * dt);
      while (holdTimer >= config.production.holdTapIntervalMs) {
        holdTimer -= config.production.holdTapIntervalMs;
        pulse();
      }
    }

    matrix.setRamActive(state.ramLevel > 0);
    matrix.step(dt);
    updateCrash(dt);
    unlockProgress();
    refreshForecastForActivePage();
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
    state.lifetime.ramPeak = Math.max(finiteNumber(state.lifetime.ramPeak), state.ramLevel);
    state.total.ramPeak = Math.max(finiteNumber(state.total.ramPeak), state.ramLevel);
    const effectiveBots = economy.getEffectiveBots();
    state.lifetime.botsPeak = Math.max(finiteNumber(state.lifetime.botsPeak), effectiveBots);
    state.total.botsPeak = Math.max(finiteNumber(state.total.botsPeak), effectiveBots);

    const sourceGain = economy.getSourceCodeRate() * dt;
    if (sourceGain > config.sourceCode.minimumGain) {
      state.sourceCode = finiteNumber(state.sourceCode + sourceGain);
      state.lifetime.sourceCode = finiteNumber(state.lifetime.sourceCode + sourceGain);
      state.total.sourceCode = finiteNumber(state.total.sourceCode + sourceGain);
    }

    state.cpuMultiplier = economy.getCpuMultiplier();
  }

  function updateOperator(dt) {
    if (!state.operator.unlocked && D(state.lifetime.hashes).gte(getOperatorUnlockCost())) {
      state.operator.unlocked = true;
      pageDirty = true;
    }
    if (state.operator.choice === "social") {
      state.bots.operator = finiteNumber(state.bots.operator + economy.getEffectiveCores() * dt / 60);
    }
  }

  function pulse() {
    state.lifetime.taps += devClickMultiplier;
    state.total.taps += devClickMultiplier;
    const executionGain = economy.getExecutionsPerTap() * devClickMultiplier;
    const lifetimeExecutionsBeforeGain = state.lifetime.executions;
    economy.addExecutions(executionGain);
    processProgramDownloadGain(executionGain, lifetimeExecutionsBeforeGain);
    maybeStartCrash();
    matrix.pulse();
    refreshMatrixUpgradeState();
  }

  function buyTapUpgrade() {
    const cost = economy.getTapCost();
    if (D(state.hashes).lt(cost) || !economy.isTapUpgradeUnlocked()) return;
    state.hashes = D(state.hashes).minus(cost).toString();
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

  function buyRamUpgrade() {
    const cost = economy.getRamCost();
    if (D(state.hashes).lt(cost) || !economy.isRamUnlocked()) return;
    state.hashes = D(state.hashes).minus(cost).toString();
    state.ramLevel += 1;
    matrix.addDensity(config.matrix.ramUpgradeDensityBoost);
    pageDirty = true;
    render();
  }

  function buyMaxRamUpgrades() {
    buyMaxUpgrades({
      isUnlocked: economy.isRamUnlocked,
      getCost: economy.getRamCost,
      apply: () => {
        state.ramLevel += 1;
        matrix.addDensity(config.matrix.ramUpgradeDensityBoost);
      }
    });
  }

  function buyMaxUpgrades(upgrade) {
    if (!economy.isResearchBought("max_buy") || !upgrade.isUnlocked()) return;
    let bought = 0;
    for (let guard = 0; guard < 10000; guard += 1) {
      const cost = upgrade.getCost();
      if (D(state.hashes).lt(cost)) break;
      state.hashes = D(state.hashes).minus(cost).toString();
      upgrade.apply();
      bought += 1;
    }
    if (!bought) return;
    pageDirty = true;
    render();
  }

  function refreshForecastForActivePage(force = false) {
    if (activePage !== "research" && activePage !== "programs") return;
    if (!force && state.lifetime.time < nextForecastRefreshAt) return;
    refreshForecastForPage(activePage, true);
  }

  function refreshForecastForPage(page, force = false) {
    if (page !== "research" && page !== "programs") return;
    if (!force && state.lifetime.time < nextForecastRefreshAt) return;
    const forecast = getProjectedHashes(FORECAST_SECONDS);
    forecastHashes[page] = forecast.toString();
    nextForecastRefreshAt = state.lifetime.time + FORECAST_REFRESH_SECONDS;
    pageDirty = true;
  }

  function getProjectedHashes(seconds) {
    return D(state.hashes).plus(D(economy.getPassiveHashRate()).times(seconds));
  }

  function syncProgramDownloadsOnLoad() {
    startEligibleProgramDownloads();
    for (const item of programDownloadData) {
      const download = getProgramDownload(item.id);
      if (download.complete) {
        state.programs.unlocked[item.id] = true;
        continue;
      }
      if (D(download.bytes).gte(item.downloadBytes)) completeProgramDownload(item);
    }
  }

  function processProgramDownloadGain(executionGain, lifetimeExecutionsBeforeGain) {
    startEligibleProgramDownloads();
    for (const item of programDownloadData) {
      const download = getProgramDownload(item.id);
      if (!download.started || download.complete) continue;
      const eligibleExecutions = getDownloadEligibleExecutions(item, executionGain, lifetimeExecutionsBeforeGain);
      if (eligibleExecutions > 0) advanceProgramDownload(item, eligibleExecutions);
    }
  }

  function startEligibleProgramDownloads() {
    for (const item of programDownloadData) {
      const download = getProgramDownload(item.id);
      if (download.started || download.complete) continue;
      if (!isProgramDownloadRequirementMet(item)) continue;
      download.started = true;
      download.bytes = 0;
      pageDirty = true;
    }
  }

  function isProgramDownloadRequirementMet(item) {
    if (D(state.hashes).lt(item.hashRequirement || 0)) return false;
    if (item.executionRequirement && D(state.lifetime.executions).lt(item.executionRequirement)) return false;
    return true;
  }

  function getDownloadEligibleExecutions(item, executionGain, lifetimeExecutionsBeforeGain) {
    if (!item.executionRequirement) return executionGain;
    const before = D(lifetimeExecutionsBeforeGain);
    const after = D(state.lifetime.executions);
    if (before.gte(item.executionRequirement)) return executionGain;
    const eligible = after.minus(item.executionRequirement);
    return eligible.gt(0) ? eligible.toNumber() : 0;
  }

  function advanceProgramDownload(item, executions) {
    const download = getProgramDownload(item.id);
    const nextBytes = D(download.bytes).plus(D(executions).times(DOWNLOAD_BYTES_PER_EXECUTION));
    download.bytes = nextBytes.gte(item.downloadBytes) ? String(item.downloadBytes) : nextBytes.toString();
    if (D(download.bytes).lt(item.downloadBytes)) return;
    completeProgramDownload(item);
  }

  function completeProgramDownload(item) {
    const download = getProgramDownload(item.id);
    if (download.complete) return;
    download.complete = true;
    download.bytes = String(item.downloadBytes);
    state.programs.unlocked[item.id] = true;
    refreshForecastForPage("programs", true);
    pageDirty = true;
  }

  function getProgramDownload(id) {
    state.downloads.programs ||= {};
    state.downloads.programs[id] ||= { started: false, complete: false, bytes: 0 };
    return state.downloads.programs[id];
  }

  function addSourceCode(lines) {
    state.sourceCode = finiteNumber(state.sourceCode + lines);
    state.lifetime.sourceCode = finiteNumber(state.lifetime.sourceCode + lines);
    state.total.sourceCode = finiteNumber(state.total.sourceCode + lines);
  }

  function resetProgramDownloads() {
    state.downloads.programs = {};
    for (const item of programDownloadData) {
      state.downloads.programs[item.id] = {
        started: false,
        complete: false,
        bytes: 0
      };
    }
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
    return Math.max(1, finiteNumber(Math.floor(state.sourceCode * 0.05)));
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
      obstacleX: getCrashStartObstacleX(),
      obstacleScored: false,
      jumps: 0,
      speed: 170 + Math.min(90, crashNumber * 4)
    };
    stopHolding();
    renderCrashScreen();
  }

  function getCrashStartObstacleX() {
    return 620;
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
    if (D(state.hashes).lt(cost)) return;
    state.hashes = D(state.hashes).minus(cost).toString();
    state.research[item.id] = true;
    state.lifetime.researchBought += 1;
    state.total.researchBought += 1;
    refreshForecastForPage("research", true);
    pageDirty = true;
    render();
  }

  function toggleProgram(id) {
    if (!state.programs?.unlocked?.[id]) return;
    const active = Array.isArray(state.programs.active) ? state.programs.active : state.programs.active ? [state.programs.active] : [];
    if (active.includes(id)) {
      state.programs.active = active.filter((activeId) => activeId !== id);
    } else if (active.length < state.programs.slots) {
      state.programs.active = [...active, id];
    }
    pageDirty = true;
    render();
  }

  function chooseOperator(choice) {
    if (!state.operator.unlocked || state.operator.choice) return;
    if (!["social", "solitary"].includes(choice)) return;
    if (D(state.lifetime.hashes).lt(getOperatorCost())) return;
    state.operator.choice = choice;
    pageDirty = true;
    render();
  }

  function chooseOperatorTier2(choice) {
    if (!state.operator.unlocked || !state.operator.choice || state.operator.tier2Choice) return;
    if (!["broadcast", "ghost"].includes(choice)) return;
    const cost = getOperatorTier2Cost();
    if (D(state.lifetime.hashes).lt(cost)) return;
    state.operator.tier2Choice = choice;
    state.roguePrograms.unlocked = true;
    pageDirty = true;
    render();
  }

  function upgradeRogueProgram(id) {
    if (!state.roguePrograms?.unlocked) return;
    const program = (config.roguePrograms?.items || []).find((entry) => entry.id === id);
    if (!program) return;
    const cost = economy.getRogueProgramCost(program);
    if (D(state.hashes).lt(cost)) return;
    state.hashes = D(state.hashes).minus(cost).toString();
    state.roguePrograms.levels[id] = (state.roguePrograms.levels[id] || 0) + 1;
    pageDirty = true;
    render();
  }

  function upgradeProgramSlots() {
    if (!state.roguePrograms?.unlocked) return;
    const cost = economy.getProgramSlotUpgradeCost();
    if (!cost || D(state.hashes).lt(cost)) return;
    state.hashes = D(state.hashes).minus(cost).toString();
    state.roguePrograms.slotUpgrades += 1;
    state.programs.slots = Math.min(5, (config.programs?.slots || 1) + state.roguePrograms.slotUpgrades);
    pageDirty = true;
    render();
  }

  function reboot() {
    if (state.sourceCode < config.reboot.minimumSourceCode) return;
    state.reboots += 1;
    state.previousRunSourceCode = Math.max(1, state.sourceCode);
    state.totalSourceCode = finiteNumber(state.totalSourceCode + state.sourceCode);
    state.hashes = "0";
    state.executions = "0";
    state.tapLevel = config.startingState.tapLevel;
    state.ramLevel = config.startingState.ramLevel;
    state.cores = config.startingState.cores;
    state.sourceCode = config.startingState.sourceCode;
    state.research = {};
    state.bots.operator = 0;
    state.operator = {
      unlocked: false,
      choice: null,
      tier2Choice: null
    };
    state.programs = {
      unlocked: {},
      active: [],
      slots: config.programs?.slots || 1
    };
    state.roguePrograms = {
      unlocked: false,
      levels: {},
      slotUpgrades: 0
    };
    resetProgramDownloads();
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

    for (const backdoor of backdoorData) {
      if (!state.backdoors[backdoor.id] && economy.conditionMet(backdoor.condition)) {
        state.backdoors[backdoor.id] = true;
        pageDirty = true;
      }
    }
  }

  function createIntroOverlay() {
    introOverlay = document.createElement("section");
    introOverlay.className = "intro-overlay p-safe-overlay hidden";
    introOverlay.setAttribute("aria-modal", "true");
    introOverlay.setAttribute("role", "dialog");
    introOverlay.setAttribute("aria-label", "Pill choice");
    introOverlay.innerHTML = `
      <div class="intro-overlay-content" id="intro-overlay-content"></div>
    `;
    introOverlay.addEventListener("click", (event) => {
      const button = event.target instanceof Element ? event.target.closest("[data-pill-choice]") : null;
      if (button) {
        choosePill(button.dataset.pillChoice);
        return;
      }
      if (introMode === "redTap") finishRedIntroTap(event);
    });
    els.game.appendChild(introOverlay);
  }

  function renderIntroOverlay() {
    if (!introOverlay || introMode === "done") {
      introOverlay?.classList.add("hidden");
      return;
    }
    introOverlay.classList.remove("hidden", "intro-fade-black", "intro-tv-off", "intro-rebooting");
    const content = introOverlay.querySelector("#intro-overlay-content");
    if (introMode === "choice") {
      content.innerHTML = `
        <p class="intro-question m-0">Which pill do you take?</p>
        <div class="intro-pill-row">
          <button class="intro-pill intro-pill-blue" type="button" data-pill-choice="blue">blue pill</button>
          <button class="intro-pill intro-pill-red" type="button" data-pill-choice="red">red pill</button>
        </div>
      `;
      return;
    }
    if (introMode === "redTap") {
      content.innerHTML = `<p class="intro-question m-0">tap for next</p>`;
    }
  }

  function choosePill(choice) {
    if (choice === "blue") {
      playBluePillSequence();
      return;
    }
    if (choice !== "red") return;
    state.intro.redPillTaken = true;
    state.intro.firstRain = false;
    introMode = "redTap";
    renderIntroOverlay();
    store.saveState(state);
  }

  function playBluePillSequence() {
    if (!introOverlay) return;
    introMode = "blue";
    const content = introOverlay.querySelector("#intro-overlay-content");
    content.innerHTML = `
      <p class="intro-message m-0">The story ends. You wake in your bed and believe whatever you want to believe.</p>
    `;
    window.setTimeout(() => introOverlay.classList.add("intro-fade-black"), 1900);
    window.setTimeout(() => introOverlay.classList.add("intro-tv-off"), 3200);
    window.setTimeout(() => {
      introMode = "reboot";
      introOverlay.classList.remove("intro-tv-off");
      introOverlay.classList.add("intro-rebooting");
      content.innerHTML = `<p class="intro-question m-0">rebooting..</p>`;
    }, 4600);
    window.setTimeout(() => {
      introMode = "choice";
      renderIntroOverlay();
    }, 5800);
  }

  function finishRedIntroTap(event) {
    event?.preventDefault();
    event?.stopPropagation();
    state.intro.firstRain = true;
    introMode = "done";
    introOverlay.classList.add("hidden");
    matrix.addDensity(config.matrix.maxDensity || 0.95);
    for (let i = 0; i < 8; i += 1) matrix.pulse();
    pulse();
    render(false);
    store.saveState(state);
  }

  function createStoryOverlay() {
    storyOverlay = document.createElement("section");
    storyOverlay.className = "story-overlay p-safe-overlay hidden";
    storyOverlay.setAttribute("aria-modal", "true");
    storyOverlay.setAttribute("role", "dialog");
    storyOverlay.innerHTML = `
      <div class="story-overlay-content">
        <p class="m-0" id="story-overlay-text"></p>
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
    const continueButton = storyOverlay.querySelector("#story-continue");
    window.clearTimeout(storyContinueTimer);
    continueButton.disabled = true;
    continueButton.classList.remove("visible");
    storyOverlay.classList.remove("hidden");
    storyContinueTimer = window.setTimeout(() => {
      continueButton.disabled = false;
      continueButton.classList.add("visible");
      continueButton.focus({ preventScroll: true });
    }, 1000);
  }

  function closeStoryOverlay() {
    storyQueue.shift();
    showNextStory();
  }

  function createCrashScreen() {
    crashScreen = document.createElement("section");
    crashScreen.className = "crash-screen p-1 hidden";
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
    crashScreen.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      jumpCrashRunner();
    });
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
    obstacle.hidden = !activeCrash.running;
    obstacle.style.transform = `translateX(${activeCrash.obstacleX}px)`;
  }

  function render(updatePage = true) {
    if (activePage === "EMP" && !isEMPPageUnlocked()) activePage = config.ui.defaultPage;
    if (activePage === "programs" && !isProgramsPageUnlocked()) activePage = config.ui.defaultPage;
    if (activePage === "roguePrograms" && !isRogueProgramsPageUnlocked()) activePage = config.ui.defaultPage;
    if (activePage === "operator" && !isOperatorPageUnlocked()) activePage = config.ui.defaultPage;
    els.hashes.textContent = formatNumber(state.hashes, { shortenAt: 100000 });
    const effectiveBots = economy.getEffectiveBots();
    els.botsMetric.hidden = effectiveBots <= 0;
    els.bots.textContent = formatNumber(effectiveBots);
    els.botsLabel.textContent = Math.floor(effectiveBots) === 1 ? "bot" : "bots";
    const effectiveCores = economy.getEffectiveCores();
    els.cores.textContent = formatNumber(effectiveCores);
    els.coresLabel.textContent = Math.floor(effectiveCores) === 1 ? "core" : "cores";
    els.pageName.textContent = getPageName(activePage);
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
    const ramCost = economy.getRamCost();
    return [
      economy.isTapUpgradeUnlocked(),
      D(state.hashes).gte(tapCost),
      state.tapLevel,
      economy.isRamUnlocked(),
      D(state.hashes).gte(ramCost),
      state.ramLevel
    ].join("|");
  }

  function bindPageEvents() {
    document.getElementById("tap-upgrade")?.addEventListener("click", buyTapUpgrade);
    document.getElementById("tap-upgrade-max")?.addEventListener("click", buyMaxTapUpgrades);
    document.getElementById("ram-upgrade")?.addEventListener("click", buyRamUpgrade);
    document.getElementById("ram-upgrade-max")?.addEventListener("click", buyMaxRamUpgrades);
    document.querySelectorAll("[data-research-id]").forEach((button) => {
      button.addEventListener("click", () => buyResearch(button.dataset.researchId));
    });
    document.querySelectorAll("[data-program-id]").forEach((button) => {
      button.addEventListener("click", () => toggleProgram(button.dataset.programId));
    });
    bindProgramPageScroll();
    document.querySelectorAll("[data-operator-choice]").forEach((button) => {
      button.addEventListener("click", () => chooseOperator(button.dataset.operatorChoice));
    });
    document.querySelectorAll("[data-operator-tier2-choice]").forEach((button) => {
      button.addEventListener("click", () => chooseOperatorTier2(button.dataset.operatorTier2Choice));
    });
    document.querySelectorAll("[data-rogue-program-id]").forEach((button) => {
      button.addEventListener("click", () => upgradeRogueProgram(button.dataset.rogueProgramId));
    });
    document.getElementById("program-slot-upgrade")?.addEventListener("click", upgradeProgramSlots);
    document.getElementById("stat-calculations-toggle")?.addEventListener("click", () => {
      showCalculations = !showCalculations;
      pageDirty = true;
      render();
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
    if (debugMode) {
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
  }

  function bindProgramPageScroll() {
    const programPage = document.querySelector(".programs-page");
    const programList = programPage?.querySelector(".program-list");
    if (!programPage || !programList) return;
    programPage.addEventListener("wheel", (event) => {
      if (event.target instanceof Element && event.target.closest(".program-list")) return;
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      programList.scrollTop += event.deltaY;
      event.preventDefault();
    }, { passive: false });
  }

  function updateMenuAvailability() {
    els.menuButtons.forEach((button) => {
      if (button.dataset.page === "EMP") {
        button.hidden = !isEMPPageUnlocked();
      }
      if (button.dataset.page === "programs") {
        button.hidden = !isProgramsPageUnlocked();
      }
      if (button.dataset.page === "roguePrograms") {
        button.hidden = !isRogueProgramsPageUnlocked();
      }
      if (button.dataset.page === "operator") {
        button.hidden = !isOperatorPageUnlocked();
      }
    });
  }

  function isEMPPageUnlocked() {
    return state.total.taps >= 256;
  }

  function isProgramsPageUnlocked() {
    return Object.keys(state.programs?.unlocked || {}).length > 0;
  }

  function isRogueProgramsPageUnlocked() {
    return Boolean(state.roguePrograms?.unlocked || state.operator?.tier2Choice);
  }

  function isOperatorPageUnlocked() {
    return Boolean(state.operator?.unlocked);
  }

  function getOperatorUnlockCost() {
    return D("6e9");
  }

  function getOperatorCost() {
    return D("1e10");
  }

  function getOperatorTier2Cost() {
    return D("1e16");
  }

  function getPageName(page) {
    const labels = {
      programs: "program",
      roguePrograms: "rogue programs"
    };
    return labels[page] || page;
  }

  function updateLiveBits() {
    const live = {
      "live-ram": formatRamProfile(state.ramLevel),
      "live-source": `${formatNumber(state.sourceCode)} lines`,
      "live-core-mult": `${formatNumber(economy.getExecutionMultiplier())}x execution gain`
    };
    Object.entries(live).forEach(([id, value]) => {
      const node = document.getElementById(id);
      if (node) node.textContent = value;
    });
    updateDownloadBits();
    updateActionAvailability();
  }

  function updateActionAvailability() {
    document.querySelectorAll("[data-research-id]").forEach((button) => {
      const item = researchData.find((entry) => entry.id === button.dataset.researchId);
      const canAfford = item && !economy.isResearchBought(item.id) && D(state.hashes).gte(economy.getResearchCost(item));
      setButtonAvailable(button, canAfford);
    });

    document.querySelectorAll("[data-rogue-program-id]").forEach((button) => {
      const program = (config.roguePrograms?.items || []).find((entry) => entry.id === button.dataset.rogueProgramId);
      const canAfford = program && state.roguePrograms?.unlocked && D(state.hashes).gte(economy.getRogueProgramCost(program));
      setButtonAvailable(button, canAfford);
    });

    const slotButton = document.getElementById("program-slot-upgrade");
    if (slotButton) {
      const cost = economy.getProgramSlotUpgradeCost();
      setButtonAvailable(slotButton, Boolean(cost) && D(state.hashes).gte(cost));
    }

    if (!state.operator.choice) {
      document.querySelectorAll("[data-operator-choice]").forEach((button) => {
        const canChoose = state.operator.unlocked && D(state.lifetime.hashes).gte(getOperatorCost());
        setButtonAvailable(button, canChoose, "program-blocked");
      });
    }

    if (!state.operator.tier2Choice) {
      document.querySelectorAll("[data-operator-tier2-choice]").forEach((button) => {
        const canChoose = state.operator.unlocked && Boolean(state.operator.choice) && D(state.lifetime.hashes).gte(getOperatorTier2Cost());
        setButtonAvailable(button, canChoose, "program-blocked");
      });
    }

    const rebootButton = document.getElementById("reboot-button");
    if (rebootButton) setButtonAvailable(rebootButton, state.sourceCode >= 1);
  }

  function setButtonAvailable(button, available, blockedClass = null) {
    if (!(button instanceof HTMLButtonElement)) return;
    button.disabled = !available;
    button.classList.toggle("can-afford", Boolean(available));
    if (blockedClass) button.classList.toggle(blockedClass, !available);
  }

  function updateDownloadBits() {
    document.querySelectorAll("[data-download-label-id]").forEach((label) => {
      const program = programDownloadData.find((entry) => entry.id === label.dataset.downloadLabelId);
      if (!program) return;
      label.textContent = getProgramDownloadLabel(program);
    });
    document.querySelectorAll("[data-download-bar-id]").forEach((bar) => {
      const program = programDownloadData.find((entry) => entry.id === bar.dataset.downloadBarId);
      if (!program) return;
      bar.style.width = `${getProgramDownloadProgress(program)}%`;
    });
    document.querySelectorAll("[data-download-percent-id]").forEach((percent) => {
      const program = programDownloadData.find((entry) => entry.id === percent.dataset.downloadPercentId);
      if (!program) return;
      percent.textContent = `${Math.floor(getProgramDownloadProgress(program))}%`;
    });
  }

  function getProgramDownloadProgress(item) {
    const download = getProgramDownload(item.id);
    return Math.max(0, Math.min(100, D(download.bytes).div(item.downloadBytes).times(100).toNumber()));
  }

  function getProgramDownloadLabel(item) {
    const download = getProgramDownload(item.id);
    if (shouldShowDownloadBytes()) return `${formatDownloadAmount(download.bytes || 0)} downloaded`;
    return item.name;
  }

  function shouldShowDownloadBytes() {
    return Math.floor((state.lifetime?.time || 0) / 2) % 2 === 1;
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
    return `${formatNumber(threads)} ${threads === 1 ? "thread" : "threads"}`;
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

  function formatDownloadAmount(bytes) {
    const amount = D(bytes);
    if (amount.lt(100000)) return `${Math.floor(amount.toNumber())} bytes`;
    if (amount.lt(1024 * 1024)) return `${amount.div(1024).toNumber().toFixed(1)} KB`;
    if (amount.lt("1e12")) return `${amount.div(1024 * 1024).toNumber().toFixed(2)} MB`;
    return `${formatNumber(amount, { scientificAt: 0, scientificDecimals: 2 })} bytes`;
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
    if (handleIntroPointer(event)) return;
    if (activeCrash) {
      event.preventDefault();
      event.stopPropagation();
      jumpCrashRunner();
      return;
    }
    startPulseFromEvent(event, event.clientX, event.clientY);
  }

  function startTouchPulse(event) {
    const touch = event.changedTouches?.[0];
    if (!touch) return;
    if (handleIntroPointer(event)) return;
    if (activeCrash) {
      event.preventDefault();
      event.stopPropagation();
      jumpCrashRunner();
      return;
    }
    startPulseFromEvent(event, touch.clientX, touch.clientY);
  }

  function handleIntroPointer(event) {
    if (!introOverlay || introMode === "done" || introOverlay.classList.contains("hidden")) return false;
    const target = event.target;
    if (!(target instanceof Element) || !target.closest(".intro-overlay")) return false;
    if (target.closest("[data-pill-choice]")) return false;
    if (introMode === "redTap") {
      finishRedIntroTap(event);
      return true;
    }
    event.preventDefault();
    event.stopPropagation();
    return true;
  }

  function startPulseFromEvent(event, x, y) {
    if (!isPulseTarget(event, x, y)) return;

    event.preventDefault();
    holding = true;
    holdTimer = 0;
    pulse();
    render(false);
  }

  function isPulseTarget(event, x, y) {
    const target = event.target;
    if (!(target instanceof Element)) return false;
    if (isBlockedPulseElement(target)) return false;

    const path = event.composedPath?.() || [];
    if (path.some((node) => node instanceof Element && isBlockedPulseElement(node))) return false;

    const topElement = document.elementFromPoint(x, y);
    if (!(topElement instanceof Element)) return false;
    if (topElement.closest(".intro-overlay")) return false;
    if (topElement.closest(".story-overlay")) return false;
    if (topElement.closest("strong, small, span, p, summary")) return false;
    if (topElement.closest(".card, .backdoor-entry, .story-entry, .stat-row, .accordion-item")) return false;
    return true;
  }

  function isBlockedPulseElement(element) {
    return Boolean(element.closest("button, a, input, textarea, select, label, summary"));
  }

  function stopHolding() {
    holding = false;
  }
})();
