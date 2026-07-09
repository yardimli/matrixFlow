(function () {
  const { finiteNumber, finiteDecimalString } = window.MF.utils;

  function createStateStore(config) {
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

    function freshDownloads() {
      return {
        firstFlow: {
          started: false,
          complete: false,
          bytes: 0,
          rewarded: false
        }
      };
    }

    function freshState() {
      return {
        version: config.version,
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
        downloads: freshDownloads(),
        lifetime: freshStats(),
        total: freshStats()
      };
    }

    function normalizeState(next) {
      next.research ||= {};
      next.unlockedStories ||= {};
      next.legacies ||= {};
      next.downloads = { ...freshDownloads(), ...(next.downloads || {}) };
      next.downloads.firstFlow = { ...freshDownloads().firstFlow, ...(next.downloads.firstFlow || {}) };
      next.lifetime = { ...freshStats(), ...(next.lifetime || {}) };
      next.total = { ...freshStats(), ...(next.total || {}) };
      next.version = config.version;
      next.cycles = finiteDecimalString(next.cycles);
      next.lifetime.cycles = finiteDecimalString(next.lifetime.cycles);
      next.total.cycles = finiteDecimalString(next.total.cycles);
      next.tapLevel = finiteNumber(next.tapLevel, config.startingState.tapLevel);
      next.flowLevel = finiteNumber(next.flowLevel, config.startingState.flowLevel);
      next.cores = Math.max(config.startingState.cores, finiteNumber(next.cores, config.startingState.cores));
      next.sourceCode = finiteNumber(next.sourceCode, config.startingState.sourceCode);
      next.totalSourceCode = finiteNumber(next.totalSourceCode, config.startingState.totalSourceCode);
      next.cpuMultiplier = Math.max(1, finiteNumber(next.cpuMultiplier, config.startingState.cpuMultiplier));
      next.reboots = finiteNumber(next.reboots, config.startingState.reboots);
      next.previousRunSourceCode = Math.max(1, finiteNumber(next.previousRunSourceCode, 1));
      next.downloads.firstFlow.bytes = finiteNumber(next.downloads.firstFlow.bytes);
      next.downloads.firstFlow.started = Boolean(next.downloads.firstFlow.started);
      next.downloads.firstFlow.complete = Boolean(next.downloads.firstFlow.complete);
      next.downloads.firstFlow.rewarded = Boolean(next.downloads.firstFlow.rewarded);
      next.lifetime.time = finiteNumber(next.lifetime.time);
      next.lifetime.taps = finiteNumber(next.lifetime.taps);
      next.lifetime.sourceCode = finiteNumber(next.lifetime.sourceCode);
      next.lifetime.coresPeak = finiteNumber(next.lifetime.coresPeak);
      next.lifetime.flowPeak = finiteNumber(next.lifetime.flowPeak);
      next.lifetime.researchBought = finiteNumber(next.lifetime.researchBought);
      next.total.time = finiteNumber(next.total.time);
      next.total.taps = finiteNumber(next.total.taps);
      next.total.sourceCode = finiteNumber(next.total.sourceCode);
      next.total.coresPeak = finiteNumber(next.total.coresPeak);
      next.total.flowPeak = finiteNumber(next.total.flowPeak);
      next.total.researchBought = finiteNumber(next.total.researchBought);
      return next;
    }

    function loadState() {
      const fresh = freshState();
      try {
        const saved = JSON.parse(localStorage.getItem(config.save.key));
        if (saved && saved.version === config.version) return normalizeState({ ...fresh, ...saved });
      } catch {
        // Use fresh state.
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
