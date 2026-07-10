(function () {
  const { finiteNumber, finiteDecimalString } = window.MF.utils;

  function createStateStore(config) {
    function freshStats() {
      return {
        time: 0,
        taps: 0,
        hashes: "0",
        executions: "0",
        sourceCode: 0,
        coresPeak: 0,
        ramPeak: 0,
        researchBought: 0
      };
    }

    function freshDownloads() {
      return {
        firstRam: {
          started: false,
          complete: false,
          bytes: 0,
          rewarded: false
        }
      };
    }

    function freshCrashes() {
      return {
        completed: 0
      };
    }

    function freshPrograms() {
      return {
        unlocked: {},
        active: null,
        slots: config.programs?.slots || 1
      };
    }

    function freshState() {
      return {
        version: config.version,
        hashes: String(config.startingState.hashes),
        executions: String(config.startingState.executions),
        tapLevel: config.startingState.tapLevel,
        ramLevel: config.startingState.ramLevel,
        cores: config.startingState.cores,
        sourceCode: config.startingState.sourceCode,
        totalSourceCode: config.startingState.totalSourceCode,
        cpuMultiplier: config.startingState.cpuMultiplier,
        reboots: config.startingState.reboots,
        previousRunSourceCode: config.startingState.previousRunSourceCode,
        research: {},
        unlockedStories: {},
        legacies: {},
        programs: freshPrograms(),
        downloads: freshDownloads(),
        crashes: freshCrashes(),
        lifetime: freshStats(),
        total: freshStats()
      };
    }

    function normalizeState(next) {
      next.research ||= {};
      next.unlockedStories ||= {};
      next.legacies ||= {};
      next.programs = { ...freshPrograms(), ...(next.programs || {}) };
      next.programs.unlocked ||= {};
      next.downloads = { ...freshDownloads(), ...(next.downloads || {}) };
      next.downloads.firstRam = { ...freshDownloads().firstRam, ...(next.downloads.firstRam || {}) };
      next.crashes = { ...freshCrashes(), ...(next.crashes || {}) };
      next.lifetime = { ...freshStats(), ...(next.lifetime || {}) };
      next.total = { ...freshStats(), ...(next.total || {}) };
      next.version = config.version;
      next.hashes = finiteDecimalString(next.hashes);
      next.lifetime.hashes = finiteDecimalString(next.lifetime.hashes);
      next.total.hashes = finiteDecimalString(next.total.hashes);
      next.executions = finiteDecimalString(next.executions);
      next.lifetime.executions = finiteDecimalString(next.lifetime.executions);
      next.total.executions = finiteDecimalString(next.total.executions);
      next.tapLevel = finiteNumber(next.tapLevel, config.startingState.tapLevel);
      next.ramLevel = finiteNumber(next.ramLevel, config.startingState.ramLevel);
      next.cores = Math.max(config.startingState.cores, finiteNumber(next.cores, config.startingState.cores));
      next.sourceCode = finiteNumber(next.sourceCode, config.startingState.sourceCode);
      next.totalSourceCode = finiteNumber(next.totalSourceCode, config.startingState.totalSourceCode);
      next.cpuMultiplier = Math.max(1, finiteNumber(next.cpuMultiplier, config.startingState.cpuMultiplier));
      next.reboots = finiteNumber(next.reboots, config.startingState.reboots);
      next.previousRunSourceCode = Math.max(1, finiteNumber(next.previousRunSourceCode, 1));
      next.programs.slots = Math.max(1, finiteNumber(next.programs.slots, config.programs?.slots || 1));
      next.programs.active = next.programs.active && next.programs.unlocked[next.programs.active] ? next.programs.active : null;
      next.downloads.firstRam.bytes = finiteNumber(next.downloads.firstRam.bytes);
      next.downloads.firstRam.started = Boolean(next.downloads.firstRam.started);
      next.downloads.firstRam.complete = Boolean(next.downloads.firstRam.complete);
      next.downloads.firstRam.rewarded = Boolean(next.downloads.firstRam.rewarded);
      next.crashes.completed = finiteNumber(next.crashes.completed);
      next.lifetime.time = finiteNumber(next.lifetime.time);
      next.lifetime.taps = finiteNumber(next.lifetime.taps);
      next.lifetime.sourceCode = finiteNumber(next.lifetime.sourceCode);
      next.lifetime.coresPeak = finiteNumber(next.lifetime.coresPeak);
      next.lifetime.ramPeak = finiteNumber(next.lifetime.ramPeak);
      next.lifetime.researchBought = finiteNumber(next.lifetime.researchBought);
      next.total.time = finiteNumber(next.total.time);
      next.total.taps = finiteNumber(next.total.taps);
      next.total.sourceCode = finiteNumber(next.total.sourceCode);
      next.total.coresPeak = finiteNumber(next.total.coresPeak);
      next.total.ramPeak = finiteNumber(next.total.ramPeak);
      next.total.researchBought = finiteNumber(next.total.researchBought);
      return next;
    }

    function loadState() {
      const fresh = freshState();
      try {
        const saved = JSON.parse(localStorage.getItem(config.save.key));
        if (saved && saved.version === config.version) {
          return normalizeState({ ...fresh, ...saved });
        }
      } catch {
        // Use fresh state.
      }

      return fresh;
    }

    function saveState(state) {
      localStorage.setItem(config.save.key, JSON.stringify(state));
    }

    function clearSave() {
      localStorage.clear();
    }

    return { freshStats, freshState, loadState, saveState, clearSave };
  }

  window.MF.createStateStore = createStateStore;
})();
