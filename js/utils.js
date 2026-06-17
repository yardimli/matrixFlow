(function () {
  window.MF = window.MF || {};

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
    return Number.isFinite(number) ? number : Number.MAX_VALUE;
  }

  function formatNumber(value) {
    const decimal = D(value);
    if (!Decimal.isFinite(decimal)) return decimal.toString();
    if (decimal.gte("1e8")) {
      if (decimal.layer > 1) return decimal.toString().replace(/\.\d+/g, "");
      return `${Math.floor(decimal.mantissa)}e${decimal.exponent}`;
    }

    const number = Math.floor(Math.max(0, decimal.toNumber() || 0));
    if (number < 1000) {
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

  window.MF.utils = { loadJson, D, decimalToNumber, formatNumber, formatTime, disableContextBehavior };
})();
