(function () {
  "use strict";

  const SCOREBOARD_URL = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?limit=1000&dates=${new Date().getFullYear()}`;
  const LIVE_PREFIX = "blitz_nfl_";
  const POLL_INTERVAL = 60000;
  let games = [];
  let selectedGameId = "";
  let detailCache = new Map();
  let channel = null;
  let isLeader = false;
  let pollingTimer = 0;
  let scoreboardRefreshInFlight = false;
  let notificationsMemory = null;
  let seenScoringEventKeys = new Set();
  let summaryBaselineIds = new Set();
  let gameStateMemory = {};
  let successfulScoreboardPolls = 0;
  const toastTimers = new Map();

  function readJson(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch (error) {
      console.error(`Unable to read ${key}:`, error);
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.error(`Unable to save ${key}:`, error);
    }
  }

  function text(tag, className, value) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (value !== undefined && value !== null) element.textContent = value;
    return element;
  }

  function getGameParts(event) {
    const competition = event && event.competitions && event.competitions[0];
    const competitors = competition && competition.competitors || [];
    const away = competitors.find(team => team.homeAway === "away");
    const home = competitors.find(team => team.homeAway === "home");
    return { competition, away, home };
  }

  function gameStatus(event) {
    const { competition } = getGameParts(event);
    const status = competition && competition.status || event.status || {};
    const type = status.type || {};
    let label = type.shortDetail || type.detail || type.description || "Status unavailable";
    const clock = status.displayClock || "";
    if (type.state === "in") {
      const hasPeriod = /quarter|half|overtime|OT|Q\d/i.test(label);
      const periodLabel = !hasPeriod && status.period ? `Q${status.period}` : "";
      label = [periodLabel, label, clock && !label.includes(clock) ? clock : ""].filter(Boolean).join(" · ");
    }
    return {
      state: type.state || "pre",
      label,
      clock,
      period: status.period || null,
      name: type.name || "",
      postponed: /postpon/i.test(`${type.name || ""} ${label}`)
    };
  }

  function eventId(event) {
    return String(event && (event.id || event.uid) || "");
  }

  function teamName(team) {
    return team && team.team && (team.team.displayName || team.team.name || team.team.abbreviation) || "TBD";
  }

  function scoreText(event) {
    if (gameStatus(event).state === "pre") return "";
    const { away, home } = getGameParts(event);
    if (!away || !home || away.score === undefined || away.score === null || home.score === undefined || home.score === null) return "";
    return `${away.score}–${home.score}`;
  }

  function eventHref(id) {
    return `Schedule.html?game=${encodeURIComponent(id)}`;
  }

  function normalizeGames(scoreboard) {
    return (scoreboard.events || []).filter(event => {
      const { away, home } = getGameParts(event);
      return eventId(event) && away && home;
    });
  }

  function preferredGame(events) {
    const now = Date.now();
    const live = events.filter(event => gameStatus(event).state === "in");
    if (live.length) return live.sort((a, b) => new Date(a.date) - new Date(b.date));
    const upcoming = events.filter(event => gameStatus(event).state === "pre" && !gameStatus(event).postponed && new Date(event.date).getTime() >= now)
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    if (upcoming.length) return [upcoming[0]];
    const completed = events.filter(event => gameStatus(event).state === "post")
      .sort((a, b) => new Date(b.date) - new Date(a.date));
    if (completed.length) return [completed[0]];
    const postponed = events.filter(event => gameStatus(event).postponed)
      .sort((a, b) => new Date(b.date) - new Date(a.date));
    return postponed.length ? [postponed[0]] : [];
  }

  function compactEvents(events) {
    return events.map(event => {
      const source = event.competitions[0];
      const competitors = (source.competitors || []).map(entry => ({
        homeAway: entry.homeAway,
        score: entry.score,
        records: entry.records && entry.records.map(record => ({ summary: record.summary })),
        team: {
          id: entry.team && entry.team.id,
          abbreviation: entry.team && entry.team.abbreviation,
          displayName: entry.team && entry.team.displayName,
          name: entry.team && entry.team.name,
          logo: entry.team && entry.team.logo
        }
      }));
      return {
        id: eventId(event),
        date: event.date,
        name: event.name,
        week: event.week || source.week,
        season: event.season && {
          name: event.season.name,
          type: event.season.type && { name: event.season.type.name }
        },
        competitions: [{
          status: source.status,
          competitors,
          week: source.week,
          broadcasts: (source.broadcasts || []).map(broadcast => ({ names: broadcast.names || [] })),
          venue: source.venue && {
            fullName: source.venue.fullName,
            address: source.venue.address && { city: source.venue.address.city }
          }
        }]
      };
    });
  }

  function mountWidget() {
    if (document.getElementById("next-game-widget")) return;
    const widget = document.createElement("aside");
    widget.id = "next-game-widget";
    widget.className = "next-game-widget";
    widget.setAttribute("aria-label", "NFL game center");
    widget.innerHTML = `
      <button id="next-game-launcher" class="next-game-launcher" type="button" aria-controls="next-game-panel" aria-expanded="false">
        <span class="next-game-launcher-icon" aria-hidden="true"><span>🏈</span></span>
        <span class="next-game-launcher-copy"><strong id="next-game-launcher-label">NFL GAME CENTER</strong><span id="next-game-launcher-matchup">Loading NFL schedule…</span></span>
        <span class="next-game-launcher-arrow" aria-hidden="true">↗</span>
      </button>
      <section id="next-game-panel" class="next-game-panel" aria-label="NFL game center" hidden>
        <div id="next-game-drag" class="next-game-drag" role="group" tabindex="0" aria-label="Move game center; use arrow keys to reposition">
          <span class="widget-grip" aria-hidden="true">⠿</span>
          <strong id="next-game-panel-label">NFL GAME CENTER</strong>
          <button id="next-game-toggle" type="button" aria-label="Minimize game center">−</button>
        </div>
        <a id="next-game-widget-link" class="next-game-widget-body" href="Schedule.html">
          <span class="next-game-matchup-visual" aria-hidden="true">
            <img id="next-game-away-logo" class="next-game-away-logo" alt="">
            <span id="next-game-widget-score" class="next-game-score"></span>
            <img id="next-game-home-logo" class="next-game-home-logo" alt="">
          </span>
          <strong id="next-game-widget-matchup"></strong>
          <span id="next-game-widget-time"></span>
          <span id="next-game-widget-venue"></span>
          <span id="next-game-widget-week"></span>
          <span id="next-game-widget-stats" class="next-game-widget-stats" hidden></span>
          <small>Open this matchup’s game details →</small>
        </a>
        <div id="next-game-selector" class="next-game-selector" aria-label="Live NFL games" hidden></div>
        <p id="next-game-widget-error" class="next-game-widget-error" role="status" hidden></p>
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

    function positionPanel(left, top) {
      const bounds = panel.getBoundingClientRect();
      const maxLeft = Math.max(8, window.innerWidth - (bounds.width || 360) - 8);
      const maxTop = Math.max(8, window.innerHeight - (bounds.height || 360) - 8);
      panel.style.left = `${Math.max(8, Math.min(left, maxLeft))}px`;
      panel.style.top = `${Math.max(8, Math.min(top, maxTop))}px`;
      panel.style.right = "auto";
      panel.style.bottom = "auto";
      panelPositioned = true;
    }

    function setOpen(open) {
      panel.hidden = !open;
      launcher.hidden = open;
      launcher.setAttribute("aria-expanded", String(open));
      widget.classList.toggle("is-open", open);
      if (open) {
        const bounds = panel.getBoundingClientRect();
        positionPanel(bounds.left, bounds.top);
      } else {
        launcher.focus();
      }
    }

    launcher.addEventListener("click", () => setOpen(true));
    toggle.addEventListener("click", () => setOpen(false));
    dragHandle.addEventListener("pointerdown", event => {
      if (event.button !== 0 || event.target.closest("button")) return;
      const bounds = panel.getBoundingClientRect();
      activePointer = event.pointerId;
      dragOffsetX = event.clientX - bounds.left;
      dragOffsetY = event.clientY - bounds.top;
      positionPanel(bounds.left, bounds.top);
      dragHandle.setPointerCapture(event.pointerId);
      widget.classList.add("is-dragging");
    });
    dragHandle.addEventListener("pointermove", event => {
      if (event.pointerId === activePointer) positionPanel(event.clientX - dragOffsetX, event.clientY - dragOffsetY);
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
      const movement = { ArrowUp: [0, -16], ArrowDown: [0, 16], ArrowLeft: [-16, 0], ArrowRight: [16, 0] }[event.key];
      if (!movement || event.target.closest("button")) return;
      event.preventDefault();
      const bounds = panel.getBoundingClientRect();
      positionPanel(bounds.left + movement[0], bounds.top + movement[1]);
    });
    window.addEventListener("resize", () => {
      if (!panel.hidden && panelPositioned) {
        const bounds = panel.getBoundingClientRect();
        positionPanel(bounds.left, bounds.top);
      }
    });
  }

  function mountNotifications() {
    const header = document.querySelector(".main-header .header-right");
    if (!header || document.getElementById("nfl-notification-control")) return;
    const control = document.createElement("div");
    control.className = "nfl-notification-control";
    control.innerHTML = `
      <button id="nfl-notification-bell" class="nfl-notification-bell" type="button" aria-label="Game notifications" aria-controls="nfl-notification-panel" aria-expanded="false">
        <span aria-hidden="true">🔔</span><span id="nfl-notification-badge" class="nfl-notification-badge" hidden></span>
      </button>
      <section id="nfl-notification-panel" class="nfl-notification-panel" aria-label="NFL game notifications" hidden>
        <header><div><strong>Game updates</strong><span>In-site notifications</span></div><button id="nfl-notification-close" type="button" aria-label="Close notifications">×</button></header>
        <div class="nfl-notification-actions"><button id="nfl-notification-read-all" type="button">Mark all read</button><button id="nfl-notification-clear" type="button">Clear all</button></div>
        <div id="nfl-notification-list" class="nfl-notification-list" aria-live="polite"></div>
      </section>`;
    header.insertBefore(control, header.querySelector("#themeToggle") || header.firstChild);
    const toastRegion = document.createElement("div");
    toastRegion.id = "nfl-game-toast-region";
    toastRegion.className = "nfl-game-toast-region";
    toastRegion.setAttribute("role", "log");
    toastRegion.setAttribute("aria-live", "polite");
    toastRegion.setAttribute("aria-relevant", "additions");
    document.body.appendChild(toastRegion);
    const button = document.getElementById("nfl-notification-bell");
    const panel = document.getElementById("nfl-notification-panel");
    const close = document.getElementById("nfl-notification-close");
    button.addEventListener("click", () => {
      panel.hidden = !panel.hidden;
      button.setAttribute("aria-expanded", String(!panel.hidden));
      if (!panel.hidden) renderNotifications();
    });
    close.addEventListener("click", () => {
      panel.hidden = true;
      button.setAttribute("aria-expanded", "false");
      button.focus();
    });
    document.getElementById("nfl-notification-read-all").addEventListener("click", () => {
      const items = readNotifications();
      saveNotifications(items.map(item => ({ ...item, read: true })));
      renderNotifications();
    });
    document.getElementById("nfl-notification-clear").addEventListener("click", () => {
      saveNotifications([]);
      renderNotifications();
    });
    document.addEventListener("click", event => {
      if (!panel.hidden && !control.contains(event.target)) {
        panel.hidden = true;
        button.setAttribute("aria-expanded", "false");
      }
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && !panel.hidden) close.click();
    });
    document.getElementById("nfl-notification-list").addEventListener("click", event => {
      const action = event.target.closest("[data-notification-action]");
      if (!action) return;
      const items = readNotifications();
      const id = action.dataset.notificationId;
      if (action.dataset.notificationAction === "dismiss") {
        saveNotifications(items.filter(item => item.id !== id));
        renderNotifications();
        return;
      }
      const item = items.find(entry => entry.id === id);
      if (item) {
        saveNotifications(items.map(entry => entry.id === id ? { ...entry, read: true } : entry));
        window.location.href = eventHref(item.gameId);
      }
    });
  }

  function renderNotifications() {
    const list = document.getElementById("nfl-notification-list");
    if (!list) return;
    const items = readNotifications();
    const unread = items.filter(item => !item.read).length;
    const badge = document.getElementById("nfl-notification-badge");
    badge.hidden = unread === 0;
    badge.textContent = unread > 99 ? "99+" : String(unread);
    list.replaceChildren();
    if (!items.length) {
      list.appendChild(text("p", "nfl-notification-empty", "No game updates yet. Scoring plays and game status changes will appear here."));
      return;
    }
    items.forEach(item => {
      const row = text("div", `nfl-notification-item${item.read ? "" : " is-unread"}`);
      const open = text("button", "nfl-notification-open");
      open.type = "button";
      open.dataset.notificationAction = "open";
      open.dataset.notificationId = item.id;
      open.append(text("strong", "", item.title), text("span", "", item.message), text("small", "", item.when || ""));
      const dismiss = text("button", "nfl-notification-dismiss", "×");
      dismiss.type = "button";
      dismiss.setAttribute("aria-label", "Dismiss notification");
      dismiss.dataset.notificationAction = "dismiss";
      dismiss.dataset.notificationId = item.id;
      row.append(open, dismiss);
      list.appendChild(row);
    });
  }

  function readNotifications() {
    if (!notificationsMemory) {
      const stored = readJson(`${LIVE_PREFIX}notifications`, []);
      if (!Array.isArray(stored)) console.error("Saved NFL notifications are not a list; ignoring the invalid value.");
      notificationsMemory = Array.isArray(stored) ? stored : [];
    }
    return notificationsMemory;
  }

  function saveNotifications(items) {
    notificationsMemory = items;
    writeJson(`${LIVE_PREFIX}notifications`, items);
  }

  function appendNotification(notification) {
    const items = readNotifications();
    if (items.some(item => item.id === notification.id)) return false;
    items.unshift({ ...notification, read: false, createdAt: Date.now() });
    saveNotifications(items.slice(0, 40));
    renderNotifications();
    if (channel && isLeader) channel.postMessage({ type: "notifications", items: items.slice(0, 40) });
    return true;
  }

  function showGameStartToast(event, id) {
    const region = document.getElementById("nfl-game-toast-region");
    if (!region) return;
    const { away, home } = getGameParts(event);
    const awayName = teamName(away);
    const homeName = teamName(home);
    const toast = text("article", "nfl-game-toast");
    const link = document.createElement("a");
    link.className = "nfl-game-toast-link";
    link.href = eventHref(id);
    const logos = text("span", "nfl-game-toast-logos");
    [away, home].forEach(team => {
      const image = document.createElement("img");
      image.alt = "";
      image.src = team && team.team && (team.team.logo ||
        (team.team.abbreviation && `https://a.espncdn.com/i/teamlogos/nfl/500/${team.team.abbreviation.toLowerCase()}.png`)) || "";
      image.onerror = () => image.remove();
      logos.appendChild(image);
    });
    const copy = text("span", "nfl-game-toast-copy");
    copy.append(text("strong", "", `${awayName} vs. ${homeName} is now LIVE!`),
      text("span", "", "Game kickoff · Open matchup details"));
    link.append(logos, copy);
    const dismiss = text("button", "nfl-game-toast-dismiss", "×");
    dismiss.type = "button";
    dismiss.setAttribute("aria-label", `Dismiss ${awayName} versus ${homeName} game-start notification`);
    dismiss.addEventListener("click", () => removeToast(toast));
    toast.append(link, dismiss);
    region.appendChild(toast);
    while (region.children.length > 3) removeToast(region.firstElementChild);
    toastTimers.set(toast, window.setTimeout(() => removeToast(toast), 6500));
  }

  function removeToast(toast) {
    const timer = toastTimers.get(toast);
    if (timer) window.clearTimeout(timer);
    toastTimers.delete(toast);
    toast.remove();
  }

  function formatGameTime(event) {
    const status = gameStatus(event);
    if (status.state === "in") return status.label;
    if (status.state === "post") return status.label || "Final";
    if (status.postponed) return status.label;
    const date = new Date(event.date);
    if (Number.isNaN(date.getTime())) return "Kickoff time unavailable";
    return new Intl.DateTimeFormat(undefined, {
      weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
    }).format(date);
  }

  function renderGameSelector(selection) {
    const selector = document.getElementById("next-game-selector");
    const liveEvents = games.filter(event => gameStatus(event).state === "in");
    selector.replaceChildren();
    selector.hidden = liveEvents.length < 2;
    if (liveEvents.length < 2) return;
    liveEvents.forEach(event => {
      const { away, home } = getGameParts(event);
      const button = text("button", "next-game-selector-item");
      button.type = "button";
      button.setAttribute("aria-pressed", String(eventId(event) === selection));
      button.dataset.gameId = eventId(event);
      const names = text("strong", "", `${away.team.abbreviation || teamName(away)} @ ${home.team.abbreviation || teamName(home)}`);
      const status = text("span", "", `${scoreText(event) || "LIVE"} · ${gameStatus(event).label}`);
      button.append(names, status);
      button.addEventListener("click", () => {
        selectedGameId = eventId(event);
        renderWidget();
      });
      selector.appendChild(button);
    });
  }

  function renderWidget() {
    const allEvents = games;
    const priority = preferredGame(allEvents);
    if (!priority.length) {
      document.getElementById("next-game-launcher-label").textContent = "NFL GAME CENTER";
      document.getElementById("next-game-launcher-matchup").textContent = "No schedule information available";
      document.getElementById("next-game-widget-error").hidden = false;
      document.getElementById("next-game-widget-error").textContent = "ESPN's NFL schedule is unavailable. Try again later.";
      return;
    }
    const liveGames = allEvents.filter(event => gameStatus(event).state === "in");
    const available = liveGames.length ? liveGames : priority;
    if (!available.some(event => eventId(event) === selectedGameId)) selectedGameId = eventId(available[0]);
    const event = available.find(item => eventId(item) === selectedGameId) || available[0];
    const { competition, away, home } = getGameParts(event);
    const status = gameStatus(event);
    const isLive = status.state === "in";
    const isFinal = status.state === "post";
    const isPostponed = status.postponed;
    const awayName = teamName(away);
    const homeName = teamName(home);
    const label = isLive ? "LIVE NOW" : isFinal ? "LATEST FINAL" : isPostponed ? "SCHEDULE UPDATE" : "UP NEXT";
    document.getElementById("next-game-launcher-label").textContent = label;
    document.getElementById("next-game-panel-label").textContent = `${label} · ${status.label}`;
    document.getElementById("next-game-launcher-matchup").textContent = `${away.team.abbreviation || awayName} @ ${home.team.abbreviation || homeName}${scoreText(event) ? ` · ${scoreText(event)}` : ""}`;
    document.getElementById("next-game-widget-matchup").textContent = `${awayName} @ ${homeName}`;
    document.getElementById("next-game-widget-time").textContent = `${isLive ? "LIVE" : isFinal ? "FINAL" : isPostponed ? "Schedule update" : "Kickoff"} · ${formatGameTime(event)}`;
    const venue = competition && competition.venue;
    document.getElementById("next-game-widget-venue").textContent = venue ? [venue.fullName, venue.address && venue.address.city].filter(Boolean).join(" · ") : "";
    const week = event.week && (event.week.text || event.week.number);
    const seasonName = event.season && event.season.name;
    document.getElementById("next-game-widget-week").textContent = [week ? `Week ${week}` : "", seasonName || ""].filter(Boolean).join(" · ");
    document.getElementById("next-game-widget-score").textContent =
      scoreText(event) || (isPostponed ? "POSTPONED" : isLive ? status.label : isFinal ? status.label : "UP NEXT");
    document.getElementById("next-game-away-logo").src = away.team.logo || "";
    document.getElementById("next-game-home-logo").src = home.team.logo || "";
    document.getElementById("next-game-away-logo").alt = `${awayName} logo`;
    document.getElementById("next-game-home-logo").alt = `${homeName} logo`;
    const launcherIcon = document.querySelector(".next-game-launcher-icon");
    if (launcherIcon) {
      const awayLogo = away.team.logo || (away.team.abbreviation &&
        `https://a.espncdn.com/i/teamlogos/nfl/500/${away.team.abbreviation.toLowerCase()}.png`);
      const homeLogo = home.team.logo || (home.team.abbreviation &&
        `https://a.espncdn.com/i/teamlogos/nfl/500/${home.team.abbreviation.toLowerCase()}.png`);
      launcherIcon.classList.toggle("has-matchup", Boolean(awayLogo && homeLogo));
      launcherIcon.replaceChildren();
      if (awayLogo && homeLogo) {
        [awayLogo, homeLogo].forEach((source, index) => {
          const half = document.createElement("span");
          half.className = `next-game-launcher-team next-game-launcher-team-${index === 0 ? "away" : "home"}`;
          const logo = document.createElement("img");
          logo.src = source;
          logo.alt = "";
          logo.onerror = () => half.remove();
          half.appendChild(logo);
          launcherIcon.appendChild(half);
        });
      } else {
        launcherIcon.classList.remove("has-matchup");
        launcherIcon.appendChild(text("span", "", "🏈"));
      }
    }
    document.getElementById("next-game-widget-link").href = eventHref(eventId(event));
    document.getElementById("next-game-widget-error").hidden = true;
    renderGameSelector(eventId(event));
    const stats = detailCache.get(eventId(event));
    const statsElement = document.getElementById("next-game-widget-stats");
    if (stats) {
      const topStats = teamStatsForWidget(stats, away, home);
      statsElement.textContent = topStats;
      statsElement.hidden = !topStats;
    } else {
      statsElement.hidden = true;
    }
  }

  function teamStatsForWidget(summary, away, home) {
    const teams = summary.boxscore && summary.boxscore.teams || [];
    if (teams.length < 2) return "";
    const awayStats = statsForTeam(teams, away.team.id);
    const homeStats = statsForTeam(teams, home.team.id);
    if (!awayStats.length && !homeStats.length) return "";
    return `${away.team.abbreviation || teamName(away)} ${awayStats.join(" · ") || "Stats unavailable"}  |  ${home.team.abbreviation || teamName(home)} ${homeStats.join(" · ") || "Stats unavailable"}`;
  }

  function statsForTeam(teams, teamId) {
    const team = teams.find(entry => String(entry.team && entry.team.id) === String(teamId));
    return (team && team.statistics || [])
      .filter(stat => /totalYards|firstDowns/i.test(stat.name || ""))
      .map(stat => `${stat.name.toLowerCase().includes("first") ? "1st downs" : "Yds"} ${stat.displayValue}`)
      .slice(0, 2);
  }

  function normalizeScoreboard(data) {
    return {
      updatedAt: Date.now(),
      events: compactEvents(normalizeGames(data))
    };
  }

  function handleStatusChanges(events) {
    const stored = readJson(`${LIVE_PREFIX}game_states`, {});
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
      console.error("Saved NFL game states are invalid; starting with an empty status map.");
    }
    const previous = {
      ...(stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {}),
      ...gameStateMemory
    };
    const next = { ...previous };
    const allowToast = successfulScoreboardPolls > 0;
    events.forEach(event => {
      const id = eventId(event);
      const currentStatus = gameStatus(event);
      const previousEntry = previous[id];
      const previousState = typeof previousEntry === "string" ? previousEntry : previousEntry && previousEntry.state;
      const previousLabel = typeof previousEntry === "object" && previousEntry ? previousEntry.label || "" : "";
      if (previousState && previousState !== currentStatus.state && (currentStatus.state === "in" || currentStatus.state === "post")) {
        const { away, home } = getGameParts(event);
        const finalText = currentStatus.state === "post" ? ` Final score ${scoreText(event) || "unavailable"}.` : "";
        const gameStarted = currentStatus.state === "in" && previousState === "pre";
        const notification = {
          id: `status-${id}-${currentStatus.state}`,
          gameId: id,
          title: gameStarted ? "Game started" : currentStatus.state === "in" ? "Game is live" : "Game final",
          message: gameStarted ? `${teamName(away)} vs. ${teamName(home)} is now LIVE!` :
            `${teamName(away)} @ ${teamName(home)}${finalText}`,
          when: currentStatus.label
        };
        const added = appendNotification(notification);
        if (gameStarted && allowToast && added) showGameStartToast(event, id);
      } else if (previousState === "in" && currentStatus.state === "in") {
        const previousLabelLower = previousLabel.toLowerCase();
        const currentLabelLower = currentStatus.label.toLowerCase();
        const halftime = /half[\s-]?time|halftime|end of 2nd/i.test(currentLabelLower) &&
          !/half[\s-]?time|halftime|end of 2nd/i.test(previousLabelLower);
        const overtime = /overtime|\bot\b/i.test(currentLabelLower) &&
          !/overtime|\bot\b/i.test(previousLabelLower);
        if (halftime || overtime) {
          const { away, home } = getGameParts(event);
          appendNotification({
            id: `status-${id}-${halftime ? "halftime" : "overtime"}`,
            gameId: id,
            title: halftime ? "Halftime" : "Overtime",
            message: `${teamName(away)} @ ${teamName(home)}${scoreText(event) ? ` · ${scoreText(event)}` : ""}`,
            when: currentStatus.label
          });
        }
      }
      next[id] = { state: currentStatus.state, label: currentStatus.label };
    });
    gameStateMemory = next;
    writeJson(`${LIVE_PREFIX}game_states`, next);
  }

  async function fetchSummary(event) {
    const id = eventId(event);
    const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${encodeURIComponent(id)}`;
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`ESPN game summary request failed (${response.status}).`);
    return response.json();
  }

  async function processScoringPlays(event, summary) {
    const savedSeen = readJson(`${LIVE_PREFIX}seen_scoring_events`, []);
    const savedBaselines = readJson(`${LIVE_PREFIX}summary_baselines`, []);
    if (!Array.isArray(savedSeen) || !Array.isArray(savedBaselines)) {
      console.error("Saved NFL scoring-event history is invalid; rebuilding deduplication state.");
    }
    const seen = new Set([...(Array.isArray(savedSeen) ? savedSeen : []), ...seenScoringEventKeys]);
    const baselines = new Set([...(Array.isArray(savedBaselines) ? savedBaselines : []), ...summaryBaselineIds]);
    const baselinePending = !baselines.has(eventId(event));
    const plays = summary.scoringPlays || [];
    let changed = false;
    for (const play of plays) {
      const key = String(play.id || `${eventId(event)}-${play.period && play.period.number}-${play.clock && play.clock.displayValue}-${play.awayScore}-${play.homeScore}-${play.text}`);
      if (seen.has(key)) continue;
      seen.add(key);
      changed = true;
      if (baselinePending) continue;
      const { away, home } = getGameParts(event);
      const awayScore = Number(play.awayScore);
      const homeScore = Number(play.homeScore);
      let scoringTeam = play.team && String(play.team.id) === String(away.team.id) ? teamName(away) :
        play.team && String(play.team.id) === String(home.team.id) ? teamName(home) : "A team";
      if (Number.isFinite(awayScore) && Number.isFinite(homeScore)) {
        const prior = plays.find(candidate => candidate === play);
        const currentScore = awayScore + homeScore;
        const previousPlay = plays[plays.indexOf(prior) - 1];
        const oldScore = previousPlay ? Number(previousPlay.awayScore) + Number(previousPlay.homeScore) : 0;
        if (currentScore > oldScore) {
          const awayDelta = awayScore - Number(previousPlay && previousPlay.awayScore || 0);
          const homeDelta = homeScore - Number(previousPlay && previousPlay.homeScore || 0);
          if (scoringTeam === "A team") scoringTeam = awayDelta > homeDelta ? teamName(away) : teamName(home);
        }
      }
      const clock = [play.period && play.period.number ? `Q${play.period.number}` : "", play.clock && play.clock.displayValue || ""].filter(Boolean).join(" ");
      const playScore = Number.isFinite(awayScore) && Number.isFinite(homeScore) ? `${awayScore}–${homeScore}` : scoreText(event);
      appendNotification({
        id: `score-${eventId(event)}-${key}`,
        gameId: eventId(event),
        title: play.type && (play.type.text || play.type.name) || "Scoring play",
        message: `${scoringTeam} scored in ${teamName(away)} @ ${teamName(home)}${playScore ? ` · ${playScore}` : ""}. ${play.text || ""}`.trim(),
        when: clock
      });
    }
    seenScoringEventKeys = seen;
    if (changed) writeJson(`${LIVE_PREFIX}seen_scoring_events`, Array.from(seen).slice(-1500));
    baselines.add(eventId(event));
    summaryBaselineIds = baselines;
    writeJson(`${LIVE_PREFIX}summary_baselines`, Array.from(baselines).slice(-100));
  }

  async function refreshLiveSummaries(events) {
    const liveEvents = events.filter(event => gameStatus(event).state === "in");
    const results = await Promise.allSettled(liveEvents.map(async event => {
      const summary = await fetchSummary(event);
      detailCache.set(eventId(event), summary);
      await processScoringPlays(event, summary);
    }));
    results.forEach(result => {
      if (result.status === "rejected") console.error("Unable to refresh an NFL game summary:", result.reason);
    });
  }

  async function refreshScoreboard() {
    if (scoreboardRefreshInFlight) return;
    scoreboardRefreshInFlight = true;
    try {
      const response = await fetch(SCOREBOARD_URL, { cache: "no-store" });
      if (!response.ok) throw new Error(`ESPN NFL scoreboard request failed (${response.status}).`);
      const data = await response.json();
      games = normalizeGames(data);
      if (!games.length) throw new Error("ESPN returned no usable NFL games.");
      handleStatusChanges(games);
      successfulScoreboardPolls += 1;
      renderWidget();
      const cachedScoreboard = normalizeScoreboard(data);
      writeJson(`${LIVE_PREFIX}scoreboard`, cachedScoreboard);
      if (channel && isLeader) channel.postMessage({ type: "scoreboard", value: cachedScoreboard });
      window.dispatchEvent(new CustomEvent("blitz-nfl-scoreboard", {
        detail: { events: games, updatedAt: cachedScoreboard.updatedAt }
      }));
      await refreshLiveSummaries(games);
      renderWidget();
      const error = document.getElementById("next-game-widget-error");
      error.hidden = true;
    } catch (error) {
      console.error("Unable to refresh NFL game data:", error);
      window.dispatchEvent(new CustomEvent("blitz-nfl-scoreboard-error", {
        detail: { message: "NFL schedule data could not be refreshed; displayed scores may be out of date." }
      }));
      const cached = readJson(`${LIVE_PREFIX}scoreboard`, null);
      if (cached && Date.now() - cached.updatedAt < 6 * 60 * 60 * 1000) {
        games = cached.events;
        renderWidget();
        const message = document.getElementById("next-game-widget-error");
        message.hidden = false;
        message.textContent = `Showing the last available schedule data from ${new Date(cached.updatedAt).toLocaleTimeString()}; live updates are unavailable.`;
      } else {
        const message = document.getElementById("next-game-widget-error");
        if (message && games.length) {
          renderWidget();
          message.hidden = false;
          message.textContent = "NFL data could not be refreshed. The scores shown may be out of date.";
        } else if (message) {
          message.hidden = false;
          message.textContent = "Live NFL data is unavailable right now. Please try again later.";
        }
      }
    } finally {
      scoreboardRefreshInFlight = false;
    }
  }

  function applyBroadcastScoreboard(value) {
    if (!value || !Array.isArray(value.events)) return;
    games = value.events;
    renderWidget();
    window.dispatchEvent(new CustomEvent("blitz-nfl-scoreboard", {
      detail: { events: games, updatedAt: value.updatedAt || Date.now() }
    }));
  }

  function pollAsLeader() {
    if (pollingTimer) return;
    isLeader = true;
    refreshScoreboard();
    pollingTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") refreshScoreboard();
    }, POLL_INTERVAL);
  }

  function tryBecomeLeader() {
    if (!navigator.locks || !channel || isLeader) {
      if (!navigator.locks && !pollingTimer) pollAsLeader();
      return;
    }
    navigator.locks.request("blitz-nfl-live-polling", { ifAvailable: true }, async lock => {
      if (!lock || isLeader) return;
      pollAsLeader();
      await new Promise(resolve => window.addEventListener("pagehide", resolve, { once: true }));
      window.clearInterval(pollingTimer);
      pollingTimer = 0;
      isLeader = false;
    }).catch(error => console.error("Unable to coordinate NFL data polling:", error));
  }

  function initializeSharedExperience() {
    mountWidget();
    mountNotifications();
    renderNotifications();
    const cached = readJson(`${LIVE_PREFIX}scoreboard`, null);
    if (cached && Array.isArray(cached.events)) {
      games = cached.events;
      renderWidget();
    }
    if ("BroadcastChannel" in window) {
      channel = new BroadcastChannel("blitz-nfl-live");
      channel.addEventListener("message", event => {
        if (event.data && event.data.type === "scoreboard") applyBroadcastScoreboard(event.data.value);
        if (event.data && event.data.type === "notifications") {
          saveNotifications(Array.isArray(event.data.items) ? event.data.items : []);
          renderNotifications();
        }
      });
    }
    if (navigator.locks && channel) {
      tryBecomeLeader();
      window.setInterval(tryBecomeLeader, 15000);
    } else {
      pollAsLeader();
    }
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && isLeader) refreshScoreboard();
    });
    window.addEventListener("pagehide", () => {
      toastTimers.forEach(timer => window.clearTimeout(timer));
      toastTimers.clear();
    }, { once: true });
    window.addEventListener("storage", event => {
      if (event.key === `${LIVE_PREFIX}notifications`) {
        try {
          const stored = event.newValue ? JSON.parse(event.newValue) : [];
          notificationsMemory = Array.isArray(stored) ? stored : [];
        } catch (error) {
          console.error("Unable to apply saved NFL notifications:", error);
          notificationsMemory = [];
        }
        renderNotifications();
      }
      if (event.key === `${LIVE_PREFIX}scoreboard` && event.newValue) {
        try {
          applyBroadcastScoreboard(JSON.parse(event.newValue));
        } catch (error) {
          console.error("Unable to apply cached NFL schedule data:", error);
        }
      }
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initializeSharedExperience, { once: true });
  else initializeSharedExperience();
})();
