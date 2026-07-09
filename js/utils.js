(function () {
  window.MF = window.MF || {};

  const MAX_FINITE_NUMBER = 1e100;
  const MAX_DECIMAL_STRING = "1e100";

  async function loadJson(path) {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) throw new Error(`Unable to load ${path}`);
    return response.json();
  }

  function D(value) {
    return new Decimal(value ?? 0);
  }

  function decimalToNumber(value) {
    const number = D(value).toNumber();
    if (Number.isNaN(number)) return 0;
    if (!Number.isFinite(number)) return MAX_FINITE_NUMBER;
    return Math.min(Math.max(0, number), MAX_FINITE_NUMBER);
  }

  function finiteNumber(value, fallback = 0, max = MAX_FINITE_NUMBER) {
    const number = Number(value);
    if (Number.isNaN(number)) return fallback;
    if (!Number.isFinite(number)) return Math.sign(number || 1) * max;
    return Math.min(Math.max(0, number), max);
  }

  function finiteDecimalString(value, fallback = "0", max = null) {
    const raw = String(value ?? "");
    const decimal = D(value);
    if (!Decimal.isFinite(decimal)) return /inf/i.test(raw) ? (max || MAX_DECIMAL_STRING) : fallback;
    if (decimal.lt(0)) return fallback;
    return max && decimal.gt(max) ? max : decimal.toString();
  }

  function formatNumber(value, options = {}) {
    const shortenAt = options.shortenAt ?? 1000;
    let decimal = D(value);
    if (!Decimal.isFinite(decimal)) decimal = D(finiteDecimalString(value));
    if (decimal.gte("1e8")) {
      if (decimal.layer > 1) return decimal.toString().replace(/\.\d+/g, "");
      return `${Math.floor(decimal.mantissa)}e${decimal.exponent}`;
    }

    const number = Math.floor(Math.max(0, decimal.toNumber() || 0));
    if (number <= shortenAt) {
      return String(number);
    }

    const units = ["k", "M", "B", "T", "Qa", "Qi", "Sx"];
    let scaled = number;
    let unit = "";
    for (const next of units) {
      if (scaled < 1000) break;
      scaled /= 1000;
      unit = next;
    }
    return `${Math.floor(scaled)}${unit}`;
  }

  function formatTime(seconds) {
    const totalSeconds = Math.floor(seconds);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function disableContextBehavior() {
    document.addEventListener("contextmenu", (event) => event.preventDefault());
    document.addEventListener("selectstart", (event) => event.preventDefault());
    document.addEventListener("dragstart", (event) => event.preventDefault());
  }

  window.MF.utils = {
    loadJson,
    D,
    MAX_FINITE_NUMBER,
    decimalToNumber,
    finiteNumber,
    finiteDecimalString,
    formatNumber,
    formatTime,
    disableContextBehavior
  };
})();
