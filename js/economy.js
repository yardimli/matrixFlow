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

    function getRuntimeBreakdown() {
      const cpuMultiplier = Math.max(1, state.cpuMultiplier);
      const coreMultiplier = 1 + state.cores * config.core.multiplierPerCore;
      const memoryMultiplier = 1 + state.totalSourceCode * config.core.sourceMultiplierPerLine;
      const cycleMultiplier = getCycleMultiplier();
      const tapBase = getUpgradeIncome(config.upgradeTables?.tap, state.tapLevel - 1, true);
      const flowBase = getUpgradeIncome(config.upgradeTables?.flow, state.flowLevel, false);
      const tapResearch = 1 + effectSum("tapMultiplier");
      const flowResearch = 1 + effectSum("flowMultiplier");
      const coreResearch = 1 + effectSum("coreMultiplier");
      const sourceResearch = 1 + effectSum("sourceMultiplier");
      const flowRate = getFlowRate();
      const cyclesPerTap = getCyclesPerTap();
      const coreTarget = getCoreTarget();
      const coreGain8 = Math.max(0, coreTarget - state.cores) * Math.min(1, 8 * config.core.convergenceRate);
      const sourceRate = getSourceCodeRate();
      return {
        cpuMultiplier,
        coreMultiplier,
        memoryMultiplier,
        cycleMultiplier,
        tapBase,
        flowBase,
        tapResearch,
        flowResearch,
        coreResearch,
        sourceResearch,
        flowRate,
        cyclesPerTap,
        flowGain8: flowRate * 8,
        coreTarget,
        coreGain8,
        sourceRate,
        sourceGain8: sourceRate * 8,
        sourceDifficulty: getSourceDifficulty()
      };
    }

    function getCyclesPerTap() {
      const base = getUpgradeIncome(config.upgradeTables?.tap, state.tapLevel - 1, true);
      return finiteNumber(base * getCycleMultiplier() * (1 + effectSum("tapMultiplier")));
    }

    function getFlowRate() {
      const base = getUpgradeIncome(config.upgradeTables?.flow, state.flowLevel, false);
      return finiteNumber(base * getCycleMultiplier() * (1 + effectSum("flowMultiplier")));
    }

    function getCoreTarget() {
      const researchBoost = 1 + effectSum("coreMultiplier");
      const tapPart = Math.pow(Math.max(1, state.tapLevel), config.core.tapLevelPower);
      const flowPart = Math.pow(Math.max(1, state.flowLevel + 1), config.core.flowLevelPower);
      const cyclePart = Math.log1p(Math.max(0, decimalToNumber(state.lifetime.cycles)) / config.core.baseDivisor) / Math.LN2;
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
      return getCpuMultiplierForSource(state.totalSourceCode);
    }

    function getCpuMultiplierForSource(sourceCode) {
      const fromSource = Math.max(1, 1 + sourceCode / config.sourceCode.cpuDivisor);
      return finiteNumber(fromSource * (1 + effectSum("cpuMultiplier")), 1);
    }

    function getTapCost() {
      return getDiscountedUpgradeCost(getUpgradeTableCost(state.tapLevel, config.upgradeTables?.tap), "tapCostMultiplier");
    }

    function getFlowCost() {
      return getDiscountedUpgradeCost(getUpgradeTableCost(state.flowLevel + 1, config.upgradeTables?.flow), "flowCostMultiplier");
    }

    function getDiscountedUpgradeCost(cost, key) {
      const discounted = cost.times(getCostMultiplier(key)).floor();
      return discounted.lt(1) ? D(1) : discounted;
    }

    function getUpgradeTableCost(targetLevel, table = {}) {
      const level = Math.max(1, Math.floor(finiteNumber(targetLevel, 1)));
      const upgradesPerTier = Math.max(1, Math.floor(finiteNumber(table.upgradesPerTier, 8)));
      const baseStep = D(table.baseStep || 8);
      const fullTiers = Math.floor(level / upgradesPerTier);
      const remainder = level % upgradesPerTier;
      let total = D(0);
      if (fullTiers > 0) {
        total = total.plus(baseStep.times(upgradesPerTier).times(D(2).pow(fullTiers).minus(1)));
      }
      if (remainder > 0) {
        total = total.plus(baseStep.times(D(2).pow(fullTiers)).times(remainder));
      }
      return total.round();
    }

    function getUpgradeIncome(table = {}, upgradesOwned, includeBaseWithoutUpgrades) {
      const owned = Math.max(0, Math.floor(finiteNumber(upgradesOwned)));
      const baseIncome = finiteNumber(table.baseIncome, 1);
      const incomePerUpgrade = finiteNumber(table.incomePerUpgrade, 1);
      if (owned <= 0 && !includeBaseWithoutUpgrades) return 0;
      return finiteNumber(baseIncome + owned * incomePerUpgrade);
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
      getRuntimeBreakdown,
      getCyclesPerTap,
      getFlowRate,
      getCoreTarget,
      getSourceDifficulty,
      getSourceCodeRate,
      getCpuMultiplier,
      getCpuMultiplierForSource,
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
