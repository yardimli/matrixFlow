(function () {
  const { D } = window.MF.utils;

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
        lifetime: freshStats(),
        total: freshStats()
      };
    }

    function normalizeState(next) {
      next.research ||= {};
      next.unlockedStories ||= {};
      next.legacies ||= {};
      next.lifetime = { ...freshStats(), ...(next.lifetime || {}) };
      next.total = { ...freshStats(), ...(next.total || {}) };
      next.version = config.version;
      next.cycles = D(next.cycles).toString();
      next.lifetime.cycles = D(next.lifetime.cycles).toString();
      next.total.cycles = D(next.total.cycles).toString();
      next.previousRunSourceCode = Math.max(1, Number(next.previousRunSourceCode || 1));
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
