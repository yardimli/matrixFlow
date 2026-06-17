(function () {
  const { D, decimalToNumber } = window.MF.utils;

  function createEconomy(config, researchData, legacyData, state) {
    function isResearchBought(id) {
      return Boolean(state.research[id]);
    }

    function effectSumFromResearch(key) {
      return researchData.reduce((sum, item) => sum + (isResearchBought(item.id) ? 1 : 0) * Number(item.effects?.[key] || 0), 0);
    }

    function getLegacyPower() {
      return 1 + effectSumFromResearch("legacyMultiplier");
    }

    function effectSum(key) {
      let total = effectSumFromResearch(key);
      for (const legacy of legacyData) {
        if (state.legacies[legacy.id]) total += Number(legacy.effects?.[key] || 0) * getLegacyPower();
      }
      return total;
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
      const base = state.flowLevel * config.production.flowCyclesPerSecond * (1 + state.flowLevel * config.production.flowLevelBonus);
      return base * getCycleMultiplier() * (1 + effectSum("flowMultiplier"));
    }

    function getCoreTarget() {
      const researchBoost = 1 + effectSum("coreMultiplier");
      const tapPart = Math.pow(Math.max(1, state.tapLevel), config.core.tapLevelPower);
      const flowPart = Math.pow(Math.max(1, state.flowLevel + 1), config.core.flowLevelPower);
      const cyclePart = Math.sqrt(Math.max(0, decimalToNumber(state.lifetime.cycles)) / config.core.baseDivisor);
      return cyclePart * (tapPart + flowPart) * config.core.targetScale * researchBoost;
    }

    function getSourceDifficulty() {
      const rebootDifficulty = Math.pow(config.sourceCode.rebootDifficultyGrowth, state.reboots);
      const ratio = state.sourceCode / Math.max(1, state.previousRunSourceCode);
      const start = config.sourceCode.longRunHardeningStartRatio;
      const veryHard = config.sourceCode.veryHardRatio;
      const longRunDifficulty = ratio <= start ? 1 : 1 + Math.pow((ratio - start) / (veryHard - start), 2) * config.sourceCode.longRunDifficultyScale;
      return rebootDifficulty * longRunDifficulty;
    }

    function getSourceCodeRate() {
      const productiveMass = Math.sqrt(Math.max(0, decimalToNumber(state.lifetime.cycles))) +
        state.cores * config.sourceCode.coreWeight +
        state.flowLevel * config.sourceCode.flowWeight;
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

    function addCycles(amount) {
      state.cycles = D(state.cycles).plus(amount).toString();
      state.lifetime.cycles = D(state.lifetime.cycles).plus(amount).toString();
      state.total.cycles = D(state.total.cycles).plus(amount).toString();
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

    function conditionMet(condition) {
      if (condition.stat === "totalCycles") return D(state.total.cycles).gte(condition.gte);
      if (condition.stat === "cycles") return D(state.lifetime.cycles).gte(condition.gte);
      return getStat(condition.stat) >= Number(condition.gte || 0);
    }

    return {
      isResearchBought,
      effectSum,
      getCycleMultiplier,
      getCyclesPerTap,
      getFlowRate,
      getCoreTarget,
      getSourceDifficulty,
      getSourceCodeRate,
      getCpuMultiplier,
      getTapCost,
      getFlowCost,
      getResearchCost,
      isTapUpgradeUnlocked,
      isFlowUnlocked,
      addCycles,
      getStat,
      conditionMet
    };
  }

  window.MF.createEconomy = createEconomy;
})();
