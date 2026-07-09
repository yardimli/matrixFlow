(function () {
  const { D, decimalToNumber, finiteNumber, finiteDecimalString } = window.MF.utils;

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
        if (state.legacies[legacy.id]) total += getLegacyEffectValue(legacy, key) * getLegacyPower();
      }
      return finiteNumber(total);
    }

    function getLegacyEffectValue(legacy, key) {
      const reward = Number(legacy.effects?.[key] || 0);
      if (!reward) return 0;
      const scaling = legacy.scaling?.[key] || legacy.scaling;
      if (!scaling?.stat || !scaling.divisor) return reward;
      return finiteNumber(reward * getTaperedLegacyScale(getLifetimeStat(scaling.stat), scaling.divisor));
    }

    function getTaperedLegacyScale(value, divisor) {
      const scaled = finiteNumber(value) / Math.max(1, Number(divisor) || 1);
      return finiteNumber(Math.log1p(scaled) / Math.LN2);
    }

    function getLegacyEffects(legacy) {
      return Object.keys(legacy.effects || {}).map((key) => ({
        key,
        value: getLegacyEffectValue(legacy, key),
        scaling: legacy.scaling?.[key] || legacy.scaling || null
      }));
    }

    function getCycleMultiplier() {
      return finiteNumber(Math.max(1, state.cpuMultiplier) *
        (1 + state.cores * config.core.multiplierPerCore) *
        (1 + state.totalSourceCode * config.core.sourceMultiplierPerLine));
    }

    function getCyclesPerTap() {
      const base = config.production.baseCyclesPerTap + (state.tapLevel - 1) * config.production.tapLevelBonus;
      return finiteNumber(base * getCycleMultiplier() * (1 + effectSum("tapMultiplier")));
    }

    function getFlowRate() {
      const base = state.flowLevel * config.production.flowCyclesPerSecond * (1 + state.flowLevel * config.production.flowLevelBonus);
      return finiteNumber(base * getCycleMultiplier() * (1 + effectSum("flowMultiplier")));
    }

    function getCoreTarget() {
      const researchBoost = 1 + effectSum("coreMultiplier");
      const tapPart = Math.pow(Math.max(1, state.tapLevel), config.core.tapLevelPower);
      const flowPart = Math.pow(Math.max(1, state.flowLevel + 1), config.core.flowLevelPower);
      const cyclePart = Math.sqrt(Math.max(0, decimalToNumber(state.lifetime.cycles)) / config.core.baseDivisor);
      return finiteNumber(cyclePart * (tapPart + flowPart) * config.core.targetScale * researchBoost);
    }

    function getSourceDifficulty() {
      const rebootDifficulty = Math.pow(config.sourceCode.rebootDifficultyGrowth, state.reboots);
      const ratio = state.sourceCode / Math.max(1, state.previousRunSourceCode);
      const start = config.sourceCode.longRunHardeningStartRatio;
      const veryHard = config.sourceCode.veryHardRatio;
      const longRunDifficulty = ratio <= start ? 1 : 1 + Math.pow((ratio - start) / (veryHard - start), 2) * config.sourceCode.longRunDifficultyScale;
      return finiteNumber(rebootDifficulty * longRunDifficulty, 1);
    }

    function getSourceCodeRate() {
      const productiveMass = Math.sqrt(Math.max(0, decimalToNumber(state.lifetime.cycles))) +
        state.cores * config.sourceCode.coreWeight +
        state.flowLevel * config.sourceCode.flowWeight;
      return finiteNumber((productiveMass / config.sourceCode.baseDivisor) * (1 + effectSum("sourceMultiplier")) / getSourceDifficulty());
    }

    function getCpuMultiplier() {
      const fromSource = Math.max(1, 1 + state.totalSourceCode / config.sourceCode.cpuDivisor);
      return finiteNumber(fromSource * (1 + effectSum("cpuMultiplier")), 1);
    }

    function getTapCost() {
      return D(config.costs.tapBase)
        .times(D(config.costs.tapGrowth).pow(state.tapLevel - 1))
        .times(getCostMultiplier("tapCostMultiplier"))
        .floor();
    }

    function getFlowCost() {
      return D(config.costs.flowBase)
        .times(D(config.costs.flowGrowth).pow(state.flowLevel))
        .times(getCostMultiplier("flowCostMultiplier"))
        .floor();
    }

    function getCostMultiplier(key) {
      return Math.max(0.01, 1 + effectSumFromResearch(key));
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
      const gain = finiteNumber(amount);
      state.cycles = D(finiteDecimalString(state.cycles)).plus(gain).toString();
      state.lifetime.cycles = D(finiteDecimalString(state.lifetime.cycles)).plus(gain).toString();
      state.total.cycles = D(finiteDecimalString(state.total.cycles)).plus(gain).toString();
    }

    function getStat(stat) {
      const map = {
        totalTaps: state.total.taps,
        taps: state.lifetime.taps,
        cycles: decimalToNumber(state.lifetime.cycles),
        totalCycles: decimalToNumber(state.total.cycles),
        flowLevel: state.flowLevel,
        cores: state.lifetime.coresPeak,
        sourceCode: state.lifetime.sourceCode,
        totalSourceCode: state.totalSourceCode,
        time: state.lifetime.time,
        researchBought: state.lifetime.researchBought,
        totalResearchBought: state.total.researchBought,
        firstFlowDownloadStarted: state.downloads?.firstFlow?.started ? 1 : 0,
        firstFlowDownloadComplete: state.downloads?.firstFlow?.complete ? 1 : 0,
        reboots: state.reboots
      };
      return finiteNumber(map[stat] || 0);
    }

    function getLifetimeStat(stat) {
      return getStat(stat);
    }

    function conditionMet(condition) {
      if (condition.stat === "totalCycles") return D(state.total.cycles).gte(condition.gte);
      if (condition.stat === "cycles") return D(state.lifetime.cycles).gte(condition.gte);
      return getStat(condition.stat) >= Number(condition.gte || 0);
    }

    return {
      isResearchBought,
      effectSum,
      getLegacyEffects,
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
