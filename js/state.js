(function () {
  const { finiteNumber, finiteDecimalString } = window.MF.utils;

  function createStateStore(config, programDownloadData = []) {
    const legacyProgramResearch = {
      program_core_fork: "core_fork",
      program_bot_swarm: "bot_swarm",
      program_thread_daemon: "thread_daemon",
      program_core_resolver: "core_resolver",
      program_io_broker: "io_broker",
      program_wide_fork: "wide_fork",
      program_thread_swarm: "thread_swarm",
      program_tap_jit: "tap_jit",
      program_core_kernel: "core_kernel",
      program_scheduler_overdrive: "scheduler_overdrive"
    };

    function freshStats() {
      return {
        time: 0,
        taps: 0,
        hashes: "0",
        executions: "0",
        sourceCode: 0,
        coresPeak: 0,
        ramPeak: 0,
        botsPeak: 0,
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
        },
        programs: {}
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
        active: [],
        slots: config.programs?.slots || 1
      };
    }

    function freshRoguePrograms() {
      return {
        unlocked: false,
        levels: {},
        slotUpgrades: 0
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
        bots: {
          owned: 0,
          operator: 0
        },
        research: {},
        unlockedStories: {},
        backdoors: {},
        operator: {
          unlocked: false,
          choice: null,
          tier2Choice: null
        },
        programs: freshPrograms(),
        roguePrograms: freshRoguePrograms(),
        downloads: freshDownloads(),
        crashes: freshCrashes(),
        lifetime: freshStats(),
        total: freshStats()
      };
    }

    function normalizeState(next) {
      next.research ||= {};
      next.unlockedStories ||= {};
      next.backdoors ||= {};
      next.bots = { owned: 0, operator: 0, ...(next.bots || {}) };
      next.operator = { unlocked: false, choice: null, tier2Choice: null, ...(next.operator || {}) };
      next.programs = { ...freshPrograms(), ...(next.programs || {}) };
      next.programs.unlocked ||= {};
      next.roguePrograms = { ...freshRoguePrograms(), ...(next.roguePrograms || {}) };
      next.roguePrograms.levels ||= {};
      next.downloads = { ...freshDownloads(), ...(next.downloads || {}) };
      next.downloads.firstRam = { ...freshDownloads().firstRam, ...(next.downloads.firstRam || {}) };
      next.downloads.programs ||= {};
      for (const item of programDownloadData) {
        const existing = next.downloads.programs[item.id] || {};
        const fromLegacyFirst = item.id === "kung_fu" && next.downloads.firstRam.complete;
        const fromLegacyResearch = Object.entries(legacyProgramResearch).some(([researchId, programId]) => programId === item.id && next.research[researchId]);
        next.downloads.programs[item.id] = {
          started: Boolean(existing.started || existing.complete || fromLegacyFirst || fromLegacyResearch),
          complete: Boolean(existing.complete || fromLegacyFirst || fromLegacyResearch),
          bytes: finiteNumber(existing.bytes)
        };
        if (next.downloads.programs[item.id].complete) {
          next.downloads.programs[item.id].bytes = finiteNumber(item.downloadBytes);
          next.programs.unlocked[item.id] = true;
        }
      }
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
      next.bots.owned = Math.max(0, finiteNumber(next.bots.owned));
      next.bots.operator = Math.max(0, finiteNumber(next.bots.operator));
      next.operator.unlocked = Boolean(next.operator.unlocked);
      next.operator.choice = ["social", "solitary"].includes(next.operator.choice) ? next.operator.choice : null;
      next.operator.tier2Choice = ["broadcast", "ghost"].includes(next.operator.tier2Choice) ? next.operator.tier2Choice : null;
      next.roguePrograms.unlocked = Boolean(next.roguePrograms.unlocked || next.operator.tier2Choice);
      next.roguePrograms.slotUpgrades = Math.max(0, Math.min(4, Math.floor(finiteNumber(next.roguePrograms.slotUpgrades))));
      const expectedSlots = Math.min(5, (config.programs?.slots || 1) + next.roguePrograms.slotUpgrades);
      next.programs.slots = Math.max(expectedSlots, finiteNumber(next.programs.slots, expectedSlots));
      next.programs.slots = Math.min(5, next.programs.slots);
      if (!Array.isArray(next.programs.active)) next.programs.active = next.programs.active ? [next.programs.active] : [];
      next.programs.active = next.programs.active
        .filter((id, index, active) => next.programs.unlocked[id] && programDownloadData.some((program) => program.id === id) && active.indexOf(id) === index)
        .slice(0, next.programs.slots);
      for (const id of Object.keys(next.roguePrograms.levels)) {
        next.roguePrograms.levels[id] = Math.max(0, Math.floor(finiteNumber(next.roguePrograms.levels[id])));
      }
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
      next.lifetime.botsPeak = finiteNumber(next.lifetime.botsPeak);
      next.lifetime.researchBought = finiteNumber(next.lifetime.researchBought);
      next.total.time = finiteNumber(next.total.time);
      next.total.taps = finiteNumber(next.total.taps);
      next.total.sourceCode = finiteNumber(next.total.sourceCode);
      next.total.coresPeak = finiteNumber(next.total.coresPeak);
      next.total.ramPeak = finiteNumber(next.total.ramPeak);
      next.total.botsPeak = finiteNumber(next.total.botsPeak);
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
