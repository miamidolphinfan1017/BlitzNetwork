(function () {
  const root = document.documentElement;

  function getJson(key, fallback) {
    const value = localStorage.getItem(key);
    if (value === null) return fallback;
    try { return JSON.parse(value); } catch { return value; }
  }

  function applyThemeMode() {
    const mode = localStorage.getItem("theme") || getJson("user_settings.theme", "light-mode");
    root.classList.remove("light-mode", "dark-mode");
    root.classList.add(mode === "dark-mode" ? "dark-mode" : "light-mode");
  }

  function applyAccent() {
    const colorTheme = getJson("user_settings.color_theme", "red");
    const customColor = localStorage.getItem("user_settings.custom_color") || "#cc0000";
    const colorMap = {
      red: "#cc0000",
      blue: "#1f69d7",
      green: "#1fa654",
      purple: "#7d3ccf",
      orange: "#db7700",
      teal: "#0fa3a3",
      pink: "#d63d8f",
      gold: "#cf9f0a"
    };

    const next = colorTheme === "custom"
      ? customColor
      : (colorMap[colorTheme] || localStorage.getItem("settings_accent") || "#cc0000");

    root.style.setProperty("--accent-red", next);
  }

  function ensureFantasyNavigation() {
    const menu = document.getElementById("side-menu");
    if (!menu || menu.querySelector('a[href="Fantasy.html"]')) return;
    const fantasyLink = document.createElement("a");
    fantasyLink.href = "Fantasy.html";
    fantasyLink.textContent = "Fantasy";
    const scheduleLink = menu.querySelector('a[href="Schedule.html"], a[href="schedule.html"]');
    if (scheduleLink) scheduleLink.insertAdjacentElement("afterend", fantasyLink);
    else menu.appendChild(fantasyLink);
  }

  function mountNextGameWidget() {
    ensureFantasyNavigation();
    if (document.getElementById("next-game-widget")) return;

    const widget = document.createElement("aside");
    widget.id = "next-game-widget";
    widget.className = "next-game-widget";
    widget.setAttribute("aria-label", "Next NFL game");
    widget.hidden = true;
    widget.innerHTML = `
      <button id="next-game-launcher" class="next-game-launcher" type="button" aria-controls="next-game-panel" aria-expanded="false">
        <span class="next-game-launcher-icon" aria-hidden="true">
          <img id="next-game-launcher-away-logo" alt="">
          <img id="next-game-launcher-home-logo" alt="">
        </span>
        <span class="next-game-launcher-copy"><strong>UP NEXT</strong><span id="next-game-launcher-matchup">Next NFL game</span></span>
        <span class="next-game-launcher-arrow" aria-hidden="true">↗</span>
      </button>
      <section id="next-game-panel" class="next-game-panel" aria-label="Next NFL game details" hidden>
        <div id="next-game-drag" class="next-game-drag" role="group" tabindex="0" aria-label="Move next game card; use arrow keys to reposition">
          <span class="widget-grip" aria-hidden="true">⠿</span>
          <strong>UP NEXT</strong>
          <button id="next-game-toggle" type="button" aria-label="Close next game details">×</button>
        </div>
        <a id="next-game-widget-link" class="next-game-widget-body" href="Schedule.html">
          <span class="next-game-matchup-visual" aria-hidden="true">
            <img id="next-game-away-logo" class="next-game-away-logo" alt="">
            <img id="next-game-home-logo" class="next-game-home-logo" alt="">
          </span>
          <strong id="next-game-widget-matchup"></strong>
          <span id="next-game-widget-time"></span>
          <span id="next-game-widget-venue"></span>
          <span id="next-game-widget-week"></span>
          <time id="next-game-widget-countdown"></time>
          <small>Open schedule →</small>
        </a>
      </section>`;
    document.body.appendChild(widget);

    const dragHandle = document.getElementById("next-game-drag");
    const toggle = document.getElementById("next-game-toggle");
    const launcher = document.getElementById("next-game-launcher");
    const panel = document.getElementById("next-game-panel");
    let activePointer = null;
    let dragOffsetX = 0;
    let dragOffsetY = 0;
    let panelPositioned = false;

    function setOpen(open) {
      panel.hidden = !open;
      launcher.hidden = open;
      launcher.setAttribute("aria-expanded", String(open));
      widget.classList.toggle("is-open", open);
      if (open) {
        const bounds = panel.getBoundingClientRect();
        positionPanel(bounds.left, bounds.top);
      }
      if (!open) launcher.focus();
    }

    function positionPanel(left, top) {
      const bounds = panel.getBoundingClientRect();
      const panelWidth = bounds.width || 340;
      const panelHeight = bounds.height || 260;
      const maxLeft = Math.max(8, window.innerWidth - panelWidth - 8);
      const maxTop = Math.max(8, window.innerHeight - panelHeight - 8);
      const nextLeft = Math.max(8, Math.min(left, maxLeft));
      const nextTop = Math.max(8, Math.min(top, maxTop));
      panel.style.left = `${nextLeft}px`;
      panel.style.top = `${nextTop}px`;
      panel.style.right = "auto";
      panel.style.bottom = "auto";
      panelPositioned = true;
    }

    launcher.addEventListener("click", () => setOpen(true));
    toggle.addEventListener("click", () => setOpen(false));

    dragHandle.addEventListener("pointerdown", event => {
      if (event.button !== 0 || (event.target instanceof Element && event.target.closest("button"))) return;
      const bounds = panel.getBoundingClientRect();
      activePointer = event.pointerId;
      dragOffsetX = event.clientX - bounds.left;
      dragOffsetY = event.clientY - bounds.top;
      positionPanel(bounds.left, bounds.top);
      dragHandle.setPointerCapture(event.pointerId);
      widget.classList.add("is-dragging");
    });

    dragHandle.addEventListener("pointermove", event => {
      if (event.pointerId === activePointer) {
        positionPanel(event.clientX - dragOffsetX, event.clientY - dragOffsetY);
      }
    });

    const finishDragging = event => {
      if (event.pointerId !== activePointer) return;
      activePointer = null;
      widget.classList.remove("is-dragging");
      if (dragHandle.hasPointerCapture(event.pointerId)) dragHandle.releasePointerCapture(event.pointerId);
    };
    dragHandle.addEventListener("pointerup", finishDragging);
    dragHandle.addEventListener("pointercancel", finishDragging);

    dragHandle.addEventListener("keydown", event => {
      if (event.target instanceof Element && event.target.closest("button")) return;
      const movement = {
        ArrowUp: [0, -16],
        ArrowDown: [0, 16],
        ArrowLeft: [-16, 0],
        ArrowRight: [16, 0]
      }[event.key];
      if (!movement) return;
      event.preventDefault();
      const bounds = panel.getBoundingClientRect();
      positionPanel(bounds.left + movement[0], bounds.top + movement[1]);
    });

    window.addEventListener("resize", () => {
      if (panel.hidden || !panelPositioned) return;
      const bounds = panel.getBoundingClientRect();
      positionPanel(bounds.left, bounds.top);
    });

    loadNextGame();
  }

  async function loadNextGame() {
    const widget = document.getElementById("next-game-widget");
    const matchup = document.getElementById("next-game-widget-matchup");
    const kickoff = document.getElementById("next-game-widget-countdown");
    try {
      const response = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?limit=1000&dates=${new Date().getFullYear()}`);
      if (!response.ok) throw new Error(`Schedule request failed (${response.status})`);
      const events = (await response.json()).events || [];
      const game = events.find(event => event.status?.type?.state === "pre");
      if (!game) {
        widget.remove();
        return;
      }

      const competition = game.competitions?.[0] || {};
      const competitors = competition.competitors || [];
      const away = competitors.find(team => team.homeAway === "away")?.team || {};
      const home = competitors.find(team => team.homeAway === "home")?.team || {};
      const date = new Date(game.date);
      if (Number.isNaN(date.getTime())) throw new Error("Next game has an invalid kickoff time");

      matchup.textContent = `${away.displayName || "Away team"} at ${home.displayName || "Home team"}`;
      const awayLogo = document.getElementById("next-game-away-logo");
      const homeLogo = document.getElementById("next-game-home-logo");
      if (away.logo) {
        awayLogo.src = away.logo;
        awayLogo.alt = `${away.displayName || "Away team"} logo`;
        document.getElementById("next-game-launcher-away-logo").src = away.logo;
      }
      if (home.logo) {
        homeLogo.src = home.logo;
        homeLogo.alt = `${home.displayName || "Home team"} logo`;
        document.getElementById("next-game-launcher-home-logo").src = home.logo;
      }
      document.getElementById("next-game-widget-time").textContent = new Intl.DateTimeFormat(undefined, {
        weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short"
      }).format(date);
      document.getElementById("next-game-widget-venue").textContent = competition.venue?.fullName || "Venue details unavailable";
      document.getElementById("next-game-widget-week").textContent = competition.notes?.[0]?.headline || "Upcoming NFL game";
      document.getElementById("next-game-launcher-matchup").textContent = `${away.abbreviation || "NFL"} vs ${home.abbreviation || "NFL"}`;
      kickoff.dateTime = date.toISOString();
      kickoff.dataset.kickoff = date.toISOString();
      widget.hidden = false;

      const updateCountdown = () => {
        const remaining = date.getTime() - Date.now();
        if (remaining <= 0) {
          kickoff.textContent = "Kickoff now — open schedule for status";
          return;
        }
        const total = Math.floor(remaining / 1000);
        const days = Math.floor(total / 86400);
        const hours = Math.floor(total % 86400 / 3600);
        const minutes = Math.floor(total % 3600 / 60);
        const seconds = total % 60;
        kickoff.textContent = `Kickoff in ${days}d ${hours}h ${minutes}m ${seconds}s`;
      };
      updateCountdown();
      window.setInterval(updateCountdown, 1000);
    } catch (error) {
      console.error("Unable to load the next NFL game:", error);
      widget.remove();
    }
  }

  applyThemeMode();
  applyAccent();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountNextGameWidget, { once: true });
  } else {
    mountNextGameWidget();
  }

  window.addEventListener("storage", function (event) {
    if (event.key === null || event.key.indexOf("user_settings.") === 0 || event.key === "settings_accent" || event.key === "theme") {
      applyThemeMode();
      applyAccent();
    }
  });
})();
