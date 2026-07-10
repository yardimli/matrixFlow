(function () {
  function createMatrixEngine(canvas, settings) {
    const ctx = canvas.getContext("2d");
    const glyphs = Array.from(settings.glyphs);
    const columns = [];
    const bursts = [];
    let width = 0;
    let height = 0;
    let cell = settings.desktopCellSize;
    let density = 0;
    let speedBoost = 0;
    let ramActive = false;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, settings.maxDevicePixelRatio);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cell = width < settings.mobileBreakpoint ? settings.mobileCellSize : settings.desktopCellSize;
      seedColumns();
    };

    const seedColumns = () => {
      columns.length = 0;
      const count = Math.ceil(width / cell);
      for (let i = 0; i < count; i += 1) {
        const column = {
          x: i * cell,
          threshold: Math.random(),
          active: false
        };
        resetColumn(column, Math.random() * -height);
        column.active = column.threshold <= settings.baseDensity;
        columns.push(column);
      }
    };

    const resetColumn = (column, y = Math.random() * -height * settings.columnResetHeightRatio) => {
      column.y = y;
      column.speed = (settings.columnMinSpeed + Math.random() * settings.columnSpeedRange) * settings.baseSpeed;
      column.ramSpeedMultiplier = settings.ramSpeedMultiplierMin + Math.random() * settings.ramSpeedMultiplierRange;
      column.ramBrightness = settings.ramBrightnessMin + Math.random() * settings.ramBrightnessRange;
      column.trailOffset = Math.floor(Math.random() * settings.columnTrailRange);
      column.spawnDensity = Math.max(settings.baseDensity, density);
      column.active = true;
    };

    const drawGlyph = (text, x, y, alpha, bright, bold) => {
      ctx.fillStyle = bright ? `rgba(${settings.burstColor}, ${alpha})` : `rgba(${settings.bufferColor}, ${alpha})`;
      ctx.font = `${bold ? "700 " : ""}${cell}px "Courier New", monospace`;
      ctx.fillText(text, x, y);
    };

    window.addEventListener("resize", resize);
    resize();

    return {
      setRamActive(value) {
        ramActive = value;
      },
      pulse() {
        density = Math.min(settings.maxDensity, density + settings.tapDensityBoost);
        speedBoost = Math.min(settings.maxTapSpeedBoost, speedBoost + settings.tapSpeedBoost);
        if (Math.random() > settings.tapBrightBufferChance) return;
        for (let i = 0; i < settings.burstCount; i += 1) {
          const trail = settings.burstMinTrail + Math.floor(Math.random() * settings.burstTrailRange);
          bursts.push({
            x: Math.floor(Math.random() * Math.ceil(width / cell)) * cell,
            y: -trail * cell - Math.random() * height * settings.burstStartHeightRatio,
            speed: settings.burstMinSpeed + Math.random() * settings.burstSpeedRange,
            age: 0,
            maxAge: settings.burstLifetime,
            trail,
            seed: Math.floor(Math.random() * glyphs.length)
          });
        }
      },
      addDensity(amount) {
        density = Math.min(settings.maxDensity, density + amount);
      },
      step(dt) {
        const idleDensity = ramActive ? settings.ramIdleDensity : 0;
        density = Math.max(idleDensity, density - settings.densityDecayPerSecond * dt);
        speedBoost = Math.max(0, speedBoost - settings.speedDecayPerSecond * dt);

        ctx.fillStyle = `rgba(${settings.backgroundColor}, ${ramActive || density > settings.visibleDensityThreshold ? settings.activeFadeAlpha : settings.idleFadeAlpha})`;
        ctx.fillRect(0, 0, width, height);
        if (!ramActive && density <= settings.hiddenDensityThreshold && bursts.length === 0) return;

        ctx.textAlign = "center";
        ctx.textBaseline = "top";

        columns.forEach((column, index) => {
          const activeDensity = Math.max(settings.baseDensity, density);
          const shouldBeActive = ramActive
            ? column.threshold <= activeDensity * settings.ramColumnMultiplier
            : column.threshold <= activeDensity;

          if (!column.active) {
            if (!shouldBeActive) return;
            resetColumn(column);
          }

          const ramSpeed = ramActive ? settings.ramSpeed * column.ramSpeedMultiplier : 0;
          column.y += column.speed * (settings.baseSpeed + ramSpeed + column.spawnDensity) * dt;
          if (column.y > height + cell * settings.columnResetRows) {
            column.active = false;
            if (!shouldBeActive) return;
            resetColumn(column);
          }

          const trail = settings.baseTrail + column.trailOffset + Math.floor(column.spawnDensity * settings.densityTrailScale);
          for (let row = 0; row < trail; row += 1) {
            const y = column.y - row * cell;
            if (y < -cell || y > height) continue;
            const glyph = glyphs[(index * settings.columnGlyphStride + row * settings.rowGlyphStride + Math.floor(performance.now() / settings.glyphChangeMs)) % glyphs.length];
            const floor = ramActive ? settings.ramAlphaFloor : settings.tapAlphaFloor;
            const baseAlpha = Math.max(floor, (1 - row / trail) * (floor + column.spawnDensity * settings.densityAlphaScale));
            const alpha = Math.min(1, ramActive ? baseAlpha * column.ramBrightness : baseAlpha);
            drawGlyph(glyph, column.x, y, alpha, row === 0, false);
          }
        });

        for (let i = bursts.length - 1; i >= 0; i -= 1) {
          const burst = bursts[i];
          burst.age += dt;
          burst.y += burst.speed * dt * (1 + speedBoost * settings.burstSpeedBoostScale);
          if (burst.y - burst.trail * cell > height || burst.age > burst.maxAge) {
            bursts.splice(i, 1);
            continue;
          }

          const travel = Math.min(1, Math.max(0, burst.y / Math.max(1, height)));
          const fadeT = travel <= settings.burstFadeStart ? 0 : Math.min(1, (travel - settings.burstFadeStart) / (1 - settings.burstFadeStart));
          const fade = 1 - (fadeT * fadeT * (3 - 2 * fadeT));
          for (let row = 0; row < burst.trail; row += 1) {
            const y = burst.y - row * cell;
            if (y < -cell || y > height + cell) continue;
            const alpha = Math.max(0, fade * (1 - row / burst.trail) * settings.burstAlpha);
            if (alpha < settings.burstAlphaCutoff) continue;
            const glyph = glyphs[(burst.seed + row * settings.burstGlyphStride) % glyphs.length];
            drawGlyph(glyph, burst.x, y, alpha, row < settings.burstBrightRows, true);
          }
        }
      }
    };
  }

  window.MF.createMatrixEngine = createMatrixEngine;
})();
