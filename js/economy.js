(function () {
  const { D, decimalToNumber, finiteNumber, finiteDecimalString } = window.MF.utils;

  function createEconomy(config, researchData, backdoorData, state, programDownloadData = []) {
    function isResearchBought(id) {
      return Boolean(state.research[id]);
    }

    function effectSumFromResearch(key) {
      return researchData.reduce((sum, item) => sum + (isResearchBought(item.id) ? 1 : 0) * Number(item.effects?.[key] || 0), 0);
    }

    function getBackdoorPower() {
      return 1 + effectSumFromResearch("backdoorMultiplier");
    }

    function effectSum(key) {
      let total = effectSumFromResearch(key);
      for (const backdoor of backdoorData) {
        if (state.backdoors[backdoor.id]) total += getBackdoorEffectValue(backdoor, key) * getBackdoorPower();
      }
      total += programEffectSum(key);
      return finiteNumber(total);
    }

    function programEffectSum(key) {
      return getActivePrograms().reduce((sum, program) => sum + Number(program?.effects?.[key] || 0), 0);
    }

    function getActiveProgram() {
      return getActivePrograms()[0] || null;
    }

    function getActivePrograms() {
      const activeIds = Array.isArray(state.programs?.active) ? state.programs.active : state.programs?.active ? [state.programs.active] : [];
      return activeIds
        .filter((id) => state.programs?.unlocked?.[id])
        .map((id) => programDownloadData.find((program) => program.id === id))
        .filter(Boolean);
    }

    function getRogueProgramLevel(id) {
      return Math.max(0, finiteNumber(state.roguePrograms?.levels?.[id]));
    }

    function getRogueProgramMultiplier() {
      if (!state.roguePrograms?.unlocked) return 1;
      return (config.roguePrograms?.items || []).reduce((product, program) => {
        const level = getRogueProgramLevel(program.id);
        if (level <= 0) return product;
        const perLevel = Number(program.effects?.hashMultiplier || 0);
        return product * Math.pow(1 + perLevel, level);
      }, 1);
    }

    function getRogueProgramCost(program) {
      const level = getRogueProgramLevel(program.id);
      const exponentStart = finiteNumber(config.roguePrograms?.costExponentStart, 16);
      return D(`1e${exponentStart + level}`).floor();
    }

    function getProgramSlotUpgradeCost() {
      const bought = Math.max(0, Math.floor(finiteNumber(state.roguePrograms?.slotUpgrades)));
      const costs = config.programs?.slotUpgradeCosts || [];
      return costs[bought] ? D(costs[bought]).floor() : null;
    }

    function getEffectiveCores() {
      return finiteNumber(state.cores + programEffectSum("coreFlat"));
    }

    function getEffectiveBots() {
      return finiteNumber(Math.max(0, Number(state.bots?.owned || 0) + Number(state.bots?.operator || 0) + programEffectSum("botFlat")));
    }

    function getEffectiveThreads() {
      return getUpgradeIncome(config.upgradeTables?.ram, state.ramLevel, false);
    }

    function getOperatorTapMultiplier() {
      let multiplier = 1;
      if (state.operator?.choice === "solitary") multiplier *= Math.max(1, getEffectiveCores());
      if (state.operator?.tier2Choice === "broadcast") multiplier *= Math.max(1, getEffectiveBots());
      return finiteNumber(multiplier);
    }

    function getOperatorHashMultiplier() {
      if (state.operator?.tier2Choice !== "ghost") return 1;
      return finiteNumber(Math.max(1, getEffectiveThreads()));
    }

    function getBotEfficiencyMultiplier() {
      return finiteNumber(1 + getEffectiveBots() * Number(config.bots?.efficiencyPerBot || 0));
    }

    function getBackdoorEffectValue(backdoor, key) {
      const reward = Number(backdoor.effects?.[key] || 0);
      if (!reward) return 0;
      const scaling = backdoor.scaling?.[key] || backdoor.scaling;
      if (!scaling?.stat || !scaling.divisor) return reward;
      return finiteNumber(reward * getTaperedBackdoorScale(getLifetimeStat(scaling.stat), scaling.divisor));
    }

    function getTaperedBackdoorScale(value, divisor) {
      const scaled = finiteNumber(value) / Math.max(1, Number(divisor) || 1);
      return finiteNumber(Math.log1p(scaled) / Math.LN2);
    }

    function getBackdoorEffects(backdoor) {
      return Object.keys(backdoor.effects || {}).map((key) => ({
        key,
        value: getBackdoorEffectValue(backdoor, key),
        scaling: backdoor.scaling?.[key] || backdoor.scaling || null
      }));
    }

    function getExecutionMultiplier() {
      return finiteNumber(Math.max(1, state.cpuMultiplier) *
        (1 + getEffectiveCores() * config.core.multiplierPerCore) *
        getBotEfficiencyMultiplier() *
        getOperatorHashMultiplier() *
        getRogueProgramMultiplier());
    }

    function getRuntimeBreakdown() {
      const cpuMultiplier = Math.max(1, state.cpuMultiplier);
      const effectiveCores = getEffectiveCores();
      const effectiveBots = getEffectiveBots();
      const botEfficiency = getBotEfficiencyMultiplier();
      const operatorTapMultiplier = getOperatorTapMultiplier();
      const operatorHashMultiplier = getOperatorHashMultiplier();
      const coreMultiplier = 1 + effectiveCores * config.core.multiplierPerCore;
      const executionMultiplier = getExecutionMultiplier();
      const rogueMultiplier = getRogueProgramMultiplier();
      const tapBase = getUpgradeIncome(config.upgradeTables?.tap, state.tapLevel - 1, true);
      const ramBase = getUpgradeIncome(config.upgradeTables?.ram, state.ramLevel, false);
      const tapResearch = 1 + effectSum("tapMultiplier");
      const ramResearch = 1 + effectSum("ramMultiplier");
      const coreResearch = 1 + effectSum("coreMultiplier");
      const sourceResearch = 1 + effectSum("sourceMultiplier");
      const ramRate = getRamRate();
      const executionsPerTap = getExecutionsPerTap();
      const coreTarget = getCoreTarget();
      const coreGain8 = Math.max(0, coreTarget - state.cores) * Math.min(1, 8 * config.core.convergenceRate);
      const sourceRate = getSourceCodeRate();
      return {
        cpuMultiplier,
        effectiveCores,
        effectiveBots,
        botEfficiency,
        operatorTapMultiplier,
        operatorHashMultiplier,
        coreMultiplier,
        executionMultiplier,
        rogueMultiplier,
        tapBase,
        ramBase,
        tapResearch,
        ramResearch,
        coreResearch,
        sourceResearch,
        ramRate,
        executionsPerTap,
        ramGain8: ramRate * 8,
        coreTarget,
        coreGain8,
        sourceRate,
        sourceGain8: sourceRate * 8,
        sourceDifficulty: getSourceDifficulty()
      };
    }

    function getExecutionsPerTap() {
      const base = getUpgradeIncome(config.upgradeTables?.tap, state.tapLevel - 1, true);
      return finiteNumber(base * getExecutionMultiplier() * (1 + effectSum("tapMultiplier")) * getOperatorTapMultiplier());
    }

    function getRamRate() {
      const base = getUpgradeIncome(config.upgradeTables?.ram, state.ramLevel, false);
      return finiteNumber(base * getExecutionMultiplier() * (1 + effectSum("ramMultiplier")));
    }

    function getHashGainForExecutions(executions) {
      return finiteNumber(finiteNumber(executions) * (1 + effectSum("hashMultiplier")));
    }

    function getPassiveHashRate() {
      return getHashGainForExecutions(getRamRate());
    }

    function getCoreTarget() {
      const researchBoost = 1 + effectSum("coreMultiplier");
      const tapPart = Math.pow(Math.max(1, state.tapLevel), config.core.tapLevelPower);
      const ramPart = Math.pow(Math.max(1, state.ramLevel + 1), config.core.ramLevelPower);
      const executionPart = Math.log1p(Math.max(0, decimalToNumber(state.lifetime.executions)) / config.core.baseDivisor) / Math.LN2;
      return finiteNumber(executionPart * (tapPart + ramPart) * config.core.targetScale * researchBoost * getBotEfficiencyMultiplier());
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
      const productiveMass = Math.sqrt(Math.max(0, decimalToNumber(state.lifetime.executions))) +
        getEffectiveCores() * config.sourceCode.coreWeight +
        state.ramLevel * config.sourceCode.ramWeight;
      return finiteNumber((productiveMass / config.sourceCode.baseDivisor) * (1 + effectSum("sourceMultiplier")) * getBotEfficiencyMultiplier() / getSourceDifficulty());
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

    function getRamCost() {
      return getDiscountedUpgradeCost(getUpgradeTableCost(state.ramLevel + 1, config.upgradeTables?.ram), "ramCostMultiplier");
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
      return state.total.taps >= 1;
    }

    function isRamUnlocked() {
      return state.ramLevel > 0 || D(state.hashes).gte(getRamCost());
    }

    function addExecutions(amount) {
      const gain = finiteNumber(amount);
      const hashGain = getHashGainForExecutions(gain);
      state.hashes = D(finiteDecimalString(state.hashes)).plus(hashGain).toString();
      state.lifetime.hashes = D(finiteDecimalString(state.lifetime.hashes)).plus(hashGain).toString();
      state.total.hashes = D(finiteDecimalString(state.total.hashes)).plus(hashGain).toString();
      state.executions = D(finiteDecimalString(state.executions)).plus(gain).toString();
      state.lifetime.executions = D(finiteDecimalString(state.lifetime.executions)).plus(gain).toString();
      state.total.executions = D(finiteDecimalString(state.total.executions)).plus(gain).toString();
    }

    function getStat(stat) {
      const map = {
        totalTaps: state.total.taps,
        taps: state.lifetime.taps,
        hashes: decimalToNumber(state.lifetime.hashes),
        totalHashes: decimalToNumber(state.total.hashes),
        executions: decimalToNumber(state.lifetime.executions),
        totalExecutions: decimalToNumber(state.total.executions),
        ramLevel: state.ramLevel,
        bots: getEffectiveBots(),
        operator: state.operator?.unlocked ? 1 : 0,
        operatorSocial: state.operator?.choice === "social" ? 1 : 0,
        operatorSolitary: state.operator?.choice === "solitary" ? 1 : 0,
        operatorTier2: state.operator?.tier2Choice ? 1 : 0,
        roguePrograms: state.roguePrograms?.unlocked ? 1 : 0,
        botsPeak: state.lifetime.botsPeak,
        totalBotsPeak: state.total.botsPeak,
        cores: state.lifetime.coresPeak,
        sourceCode: state.lifetime.sourceCode,
        totalSourceCode: state.totalSourceCode,
        time: state.lifetime.time,
        researchBought: state.lifetime.researchBought,
        totalResearchBought: state.total.researchBought,
        firstRamDownloadStarted: state.downloads?.programs?.kung_fu?.started ? 1 : 0,
        firstRamDownloadComplete: state.downloads?.programs?.kung_fu?.complete ? 1 : 0,
        reboots: state.reboots
      };
      return finiteNumber(map[stat] || 0);
    }

    function getLifetimeStat(stat) {
      return getStat(stat);
    }

    function conditionMet(condition) {
      if (Array.isArray(condition?.all)) return condition.all.every(conditionMet);
      if (condition.stat === "totalHashes") return D(state.total.hashes).gte(condition.gte);
      if (condition.stat === "hashes") return D(state.lifetime.hashes).gte(condition.gte);
      if (condition.stat === "totalExecutions") return D(state.total.executions).gte(condition.gte);
      if (condition.stat === "executions") return D(state.lifetime.executions).gte(condition.gte);
      return getStat(condition.stat) >= Number(condition.gte || 0);
    }

    return {
      isResearchBought,
      effectSum,
      getBackdoorEffects,
      getActiveProgram,
      getActivePrograms,
      getRogueProgramLevel,
      getRogueProgramMultiplier,
      getRogueProgramCost,
      getProgramSlotUpgradeCost,
      getEffectiveCores,
      getEffectiveBots,
      getEffectiveThreads,
      getBotEfficiencyMultiplier,
      getOperatorTapMultiplier,
      getOperatorHashMultiplier,
      getExecutionMultiplier,
      getRuntimeBreakdown,
      getExecutionsPerTap,
      getRamRate,
      getPassiveHashRate,
      getHashGainForExecutions,
      getCoreTarget,
      getSourceDifficulty,
      getSourceCodeRate,
      getCpuMultiplier,
      getCpuMultiplierForSource,
      getTapCost,
      getRamCost,
      getResearchCost,
      isTapUpgradeUnlocked,
      isRamUnlocked,
      addExecutions,
      getStat,
      conditionMet
    };
  }

  window.MF.createEconomy = createEconomy;
})();
