(function () {
  "use strict";

  const root = document.documentElement;
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthLabel = document.getElementById("current-month-label");
  const monthPicker = document.getElementById("month-picker");
  const pickerYearLabel = document.getElementById("picker-year-label");
  const pickerMonthGrid = document.getElementById("picker-month-grid");
  const calendarGrid = document.getElementById("calendar-grid");
  const monthCalendarGrid = document.getElementById("month-calendar-grid");
  const selectedDateHeading = document.getElementById("calendar-selected-date");
  const selectedDateGames = document.getElementById("calendar-day-games");
  const teamFilter = document.getElementById("team-filter");
  const scheduleListView = document.getElementById("schedule-list-view");
  const fullCalendarView = document.getElementById("full-calendar-view");
  const heroMessage = document.querySelector(".schedule-hero .muted");
  const todayKey = getDateKey(new Date());
  let games = [];
  let scheduleCountdownInterval = null;
  let gameSummaryTimer = null;
  let activeGame = null;
  let userChangedMonth = false;
  let userSelectedCalendarDate = false;
  let selectedDateKey = todayKey;
  const loadedScheduleYears = new Set();
  const scheduleYearRequests = new Map();
  const gameSummaryCache = new Map();
  let displayMonth = new Date(Number(todayKey.slice(0, 4)), Number(todayKey.slice(5, 7)) - 1, 1);
  let pickerYear = displayMonth.getFullYear();

  function readJson(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value === null ? fallback : JSON.parse(value);
    } catch (error) {
      return fallback;
    }
  }

  function syncTheme() {
    const mode = localStorage.getItem("theme") || readJson("user_settings.theme", "light-mode");
    root.classList.toggle("dark-mode", mode === "dark-mode");
    root.classList.toggle("light-mode", mode !== "dark-mode");

    const themeButton = document.getElementById("themeToggle");
    if (themeButton) themeButton.textContent = root.classList.contains("dark-mode") ? "Light" : "Dark";
  }

  function toggleTheme() {
    const next = root.classList.contains("dark-mode") ? "light-mode" : "dark-mode";
    localStorage.setItem("theme", next);
    localStorage.setItem("user_settings.theme", JSON.stringify(next));
    syncTheme();
  }

  function getDateKey(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function parseDateKey(dateKey) {
    const [year, month, day] = dateKey.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  function formatDate(dateKey, options) {
    return new Intl.DateTimeFormat(undefined, options).format(parseDateKey(dateKey));
  }

  function compareKickoff(left, right) {
    if (!left.kickoff) return right.kickoff ? 1 : 0;
    if (!right.kickoff) return -1;
    return left.kickoff - right.kickoff;
  }

  function matchesSelectedTeam(game) {
    const selected = teamFilter.value;
    return !selected || selected === "all" || game.homeId === selected || game.awayId === selected;
  }

  function relevantScheduleGames() {
    const selectedGames = games.filter(matchesSelectedTeam);
    return selectedGames.length ? selectedGames : games;
  }

  function findLink(event, competition, relation) {
    const links = []
      .concat(event.links || [], competition.links || [], (competition.tickets || []).flatMap(ticket => ticket.links || []));
    const match = links.find(link => (link.rel || []).map(value => value.toLowerCase()).includes(relation));
    return match && match.href ? match.href : "";
  }

  function getLogo(team) {
    return team.logo || (team.abbreviation ? `https://a.espncdn.com/i/teamlogos/nfl/500/${team.abbreviation.toLowerCase()}.png` : "nfl logo.jfif");
  }

  function normalizeEvent(event) {
    const competition = (event.competitions || [])[0] || {};
    const competitors = competition.competitors || [];
    const home = competitors.find(team => team.homeAway === "home") || {};
    const away = competitors.find(team => team.homeAway === "away") || {};
    const status = competition.status || event.status || {};
    const state = status.type && status.type.state || "pre";
    const start = new Date(event.date);
    let displayStatus = status.type && (status.type.shortDetail || status.type.detail) || "";
    const postponed = /postpon/i.test(`${status.type && status.type.name || ""} ${displayStatus}`);
    if (state === "in") {
      const hasPeriod = /quarter|half|overtime|OT|Q\d/i.test(displayStatus);
      const periodLabel = !hasPeriod && status.period ? `Q${status.period}` : "";
      displayStatus = [periodLabel, displayStatus, status.displayClock && !displayStatus.includes(status.displayClock) ? status.displayClock : ""]
        .filter(Boolean).join(" · ");
    }
    const seasonType = event.season && event.season.type && event.season.type.name;
    const venue = competition.venue || {};
    const address = venue.address || {};
    const homeTeam = home.team || {};
    const awayTeam = away.team || {};
    const week = competition.week && competition.week.number || event.week && event.week.number || "";
    const broadcasts = (competition.broadcasts || []).flatMap(item => item.names || []).filter(Boolean);

    return {
      id: event.id,
      espnEvent: event,
      kickoff: Number.isNaN(start.getTime()) ? null : start,
      dateKey: getDateKey(start),
      away: awayTeam.displayName || "TBD",
      home: homeTeam.displayName || "TBD",
      awayId: (awayTeam.abbreviation || "").toLowerCase(),
      homeId: (homeTeam.abbreviation || "").toLowerCase(),
      awayLogo: getLogo(awayTeam),
      homeLogo: getLogo(homeTeam),
      time: state === "in" ? displayStatus || "LIVE" : displayStatus || (Number.isNaN(start.getTime())
        ? "Kickoff time unavailable"
        : new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(start)),
      status: state === "post" ? "final" : state === "in" ? "live" : postponed ? "postponed" : "upcoming",
      score: state === "pre" ? "" : `${away.score ?? "—"}-${home.score ?? "—"}`,
      awayScore: state === "pre" ? "" : away.score ?? "—",
      homeScore: state === "pre" ? "" : home.score ?? "—",
      venue: venue.fullName || "Venue information unavailable",
      city: address.city || "",
      state: address.state || "",
      week: week ? `WEEK ${week}` : "SCHEDULE",
      type: seasonType || "NFL game",
      broadcasts: broadcasts.join(", "),
      records: [away.records && away.records[0] && away.records[0].summary, home.records && home.records[0] && home.records[0].summary].filter(Boolean).join(" | "),
      tickets: getSeatGeekDestination(),
      highlights: findLink(event, competition, "video")
    };
  }

  function buildTeamFilter() {
    const current = teamFilter.value;
    teamFilter.innerHTML = "<option value=\"all\">All Teams</option>";
    const teams = new Map();
    games.forEach(game => {
      if (game.awayId) teams.set(game.awayId, game.away);
      if (game.homeId) teams.set(game.homeId, game.home);
    });
    [...teams.entries()].sort((a, b) => a[1].localeCompare(b[1])).forEach(([id, name]) => {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = name;
      teamFilter.appendChild(option);
    });
    const user = localStorage.getItem("currentUser") || sessionStorage.getItem("currentUser");
    const favorite = user && localStorage.getItem(`favoriteTeamId_${user}`);
    teamFilter.value = teams.has(current) ? current : (favorite && teams.has(favorite) ? favorite : "all");
  }

  function createTeamRow(game, side, name, logo) {
    const row = document.createElement("span");
    row.className = `game-team game-team-${side}`;
    const image = document.createElement("img");
    image.src = logo;
    image.alt = `${name} logo`;
    image.loading = "lazy";
    image.onerror = function () { this.src = "nfl logo.jfif"; };
    const label = document.createElement("span");
    label.textContent = name;
    row.append(image, label);
    return row;
  }

  function createGameCard(game) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = `schedule-game-card ${game.status}`;
    card.dataset.gameId = game.id;
    card.setAttribute("aria-label", `View details for ${game.away} at ${game.home}`);
    const meta = document.createElement("span");
    meta.className = "game-card-meta";
    meta.textContent = `${game.status === "final" ? "FINAL" : game.time}  ·  ${game.venue}`;
    const matchup = document.createElement("span");
    matchup.className = "game-card-matchup";
    [["away", game.away, game.awayLogo, game.awayScore], ["home", game.home, game.homeLogo, game.homeScore]].forEach(([side, name, logo, score]) => {
      const row = document.createElement("span");
      row.className = `game-card-team-score game-card-team-score-${side}`;
      row.append(createTeamRow(game, side, name, logo));
      const scoreElement = document.createElement("strong");
      scoreElement.className = "game-card-score";
      scoreElement.textContent = score === "" ? "—" : String(score);
      row.appendChild(scoreElement);
      matchup.appendChild(row);
    });
    const footer = document.createElement("span");
    footer.className = "game-card-footer";
    footer.textContent = game.city && game.state ? `${game.city}, ${game.state}` : game.type;
    card.append(meta, matchup, footer);

    if (game.status === "upcoming") {
      const countdown = document.createElement("span");
      countdown.className = "schedule-countdown";
      countdown.dataset.kickoff = game.kickoff ? game.kickoff.toISOString() : "";
      countdown.textContent = getScheduleCountdownText(game.kickoff);
      card.appendChild(countdown);
    }
    card.addEventListener("click", () => openGameModal(game));
    return card;
  }

  function getScheduleCountdownText(kickoff) {
    if (!(kickoff instanceof Date) || Number.isNaN(kickoff.getTime())) return "Kickoff time unavailable";
    const remaining = kickoff.getTime() - Date.now();
    if (remaining <= 0) return "Game time";
    const days = Math.floor(remaining / 86400000);
    const hours = Math.floor((remaining / 3600000) % 24);
    const minutes = Math.floor((remaining / 60000) % 60);
    const seconds = Math.floor((remaining / 1000) % 60);
    return `${days}d ${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
  }

  function updateScheduleCountdowns() {
    document.querySelectorAll(".schedule-countdown").forEach(countdown => {
      const kickoff = countdown.dataset.kickoff ? new Date(countdown.dataset.kickoff) : null;
      countdown.textContent = getScheduleCountdownText(kickoff);
    });
  }

  function startScheduleCountdowns() {
    if (scheduleCountdownInterval) clearInterval(scheduleCountdownInterval);
    updateScheduleCountdowns();
    scheduleCountdownInterval = setInterval(updateScheduleCountdowns, 1000);
  }

  function renderCalendar() {
    const selected = teamFilter.value;
    const monthKey = `${displayMonth.getFullYear()}-${String(displayMonth.getMonth() + 1).padStart(2, "0")}`;
    const visible = games.filter(game => game.dateKey.startsWith(monthKey) && (!selected || selected === "all" || game.homeId === selected || game.awayId === selected));
    monthLabel.textContent = displayMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    calendarGrid.innerHTML = "";

    const byWeek = new Map();
    visible.sort((a, b) => a.dateKey.localeCompare(b.dateKey) || compareKickoff(a, b)).forEach(game => {
      const weekKey = `${game.week}|${game.dateKey}`;
      if (!byWeek.has(weekKey)) byWeek.set(weekKey, []);
      byWeek.get(weekKey).push(game);
    });

    let lastWeek = "";
    byWeek.forEach((dayGames, weekKey) => {
      const [week, dateKey] = weekKey.split("|");
      if (week !== lastWeek) {
        const weekHeader = document.createElement("div");
        weekHeader.className = "schedule-week-header";
        weekHeader.textContent = week;
        calendarGrid.appendChild(weekHeader);
        lastWeek = week;
      }
      const daySection = document.createElement("section");
      daySection.className = `schedule-day-section${dateKey === todayKey ? " is-today" : ""}`;
      daySection.dataset.date = dateKey;
      const dateHeader = document.createElement("header");
      dateHeader.className = "schedule-date-header";
      const dayName = document.createElement("span");
      dayName.className = "schedule-date-day";
      dayName.textContent = formatDate(dateKey, { weekday: "short" }).toUpperCase();
      const dateValue = document.createElement("strong");
      dateValue.textContent = formatDate(dateKey, { month: "short", day: "numeric" }).toUpperCase();
      dateHeader.append(dayName, dateValue);
      const cards = document.createElement("div");
      cards.className = "schedule-game-list";
      dayGames.forEach(game => cards.appendChild(createGameCard(game)));
      daySection.append(dateHeader, cards);
      calendarGrid.appendChild(daySection);
    });

    if (!visible.length) {
      const empty = document.createElement("p");
      empty.className = "schedule-empty-state";
      empty.textContent = games.length ? "No games match this month and team filter." : "The live schedule is temporarily unavailable.";
      calendarGrid.appendChild(empty);
    }
    startScheduleCountdowns();
    renderFullCalendar();
  }

  function visibleGamesForDate(dateKey) {
    return games.filter(game => game.dateKey === dateKey &&
      matchesSelectedTeam(game))
      .sort(compareKickoff);
  }

  function renderSelectedDateGames() {
    if (!selectedDateKey) return;
    selectedDateHeading.textContent = formatDate(selectedDateKey, {
      weekday: "long", month: "long", day: "numeric", year: "numeric"
    });
    selectedDateGames.replaceChildren();
    const dayGames = visibleGamesForDate(selectedDateKey);
    if (!dayGames.length) {
      const empty = document.createElement("p");
      empty.className = "schedule-empty-state";
      empty.textContent = games.length
        ? "No NFL games scheduled for this date."
        : "The NFL schedule is temporarily unavailable.";
      selectedDateGames.appendChild(empty);
      return;
    }
    dayGames.forEach(game => selectedDateGames.appendChild(createGameCard(game)));
  }

  function renderFullCalendar() {
    if (!monthCalendarGrid) return;
    const year = displayMonth.getFullYear();
    const month = displayMonth.getMonth();
    const firstWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cellCount = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
    const filteredGames = games.filter(game => {
      return matchesSelectedTeam(game);
    });
    const gamesByDate = new Map();
    filteredGames.forEach(game => {
      if (!gamesByDate.has(game.dateKey)) gamesByDate.set(game.dateKey, []);
      gamesByDate.get(game.dateKey).push(game);
    });
    monthCalendarGrid.replaceChildren();
    const start = new Date(year, month, 1 - firstWeekday);
    for (let index = 0; index < cellCount; index++) {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
      const dateKey = getDateKey(date);
      const dateGames = (gamesByDate.get(dateKey) || []).slice().sort(compareKickoff);
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "schedule-calendar-day";
      if (date.getMonth() !== month) cell.classList.add("is-outside-month");
      if (dateKey === todayKey) cell.classList.add("is-today");
      if (dateKey === selectedDateKey) cell.classList.add("is-selected");
      if (dateGames.length) cell.classList.add("has-games");
      cell.setAttribute("role", "gridcell");
      cell.setAttribute("aria-pressed", String(dateKey === selectedDateKey));
      cell.setAttribute("aria-label", `${formatDate(dateKey, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}, ${dateGames.length} NFL ${dateGames.length === 1 ? "game" : "games"}`);
      const number = document.createElement("span");
      number.className = "schedule-calendar-day-number";
      number.textContent = String(date.getDate());
      const indicator = document.createElement("span");
      indicator.className = "schedule-calendar-day-indicator";
      indicator.textContent = dateGames.length ? `${dateGames.length} ${dateGames.length === 1 ? "game" : "games"}` : "";
      cell.append(number, indicator);
      cell.addEventListener("click", () => {
        userSelectedCalendarDate = true;
        selectedDateKey = dateKey;
        if (date.getMonth() !== displayMonth.getMonth() || date.getFullYear() !== displayMonth.getFullYear()) {
          displayMonth = new Date(date.getFullYear(), date.getMonth(), 1);
          userChangedMonth = true;
          loadScheduleYear(displayMonth.getFullYear()).catch(error => console.error("Unable to load the selected NFL schedule year:", error));
        }
        monthLabel.textContent = displayMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" });
        renderFullCalendar();
      });
      monthCalendarGrid.appendChild(cell);
    }
    renderSelectedDateGames();
  }

  function setScheduleView(view) {
    const showCalendar = view === "calendar";
    scheduleListView.hidden = showCalendar;
    fullCalendarView.hidden = !showCalendar;
    document.getElementById("schedule-view-list").setAttribute("aria-pressed", String(!showCalendar));
    document.getElementById("schedule-view-calendar").setAttribute("aria-pressed", String(showCalendar));
    if (showCalendar) renderFullCalendar();
  }

  function navigateMonth(offset) {
    userChangedMonth = true;
    const nextMonth = new Date(displayMonth.getFullYear(), displayMonth.getMonth() + offset, 1);
    displayMonth = nextMonth;
    if (selectedDateKey.slice(0, 7) !== getDateKey(nextMonth).slice(0, 7)) {
      selectedDateKey = getDateKey(nextMonth);
    }
    loadScheduleYear(displayMonth.getFullYear()).catch(error => console.error("Unable to load the selected NFL schedule year:", error));
    animateMonthChange(offset > 0 ? "next" : "prev");
  }

  function scrollToRelevantGame(dateKey) {
    const target = [...document.querySelectorAll(".schedule-day-section")].find(section => section.dataset.date === dateKey);
    if (!target) return;
    requestAnimationFrame(() => target.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "start"
    }));
  }

  function findRelevantGame() {
    const scheduleGames = relevantScheduleGames();
    const now = Date.now();
    return scheduleGames.find(game => game.status === "live") ||
      scheduleGames.find(game => game.status === "upcoming" && game.kickoff && game.kickoff.getTime() >= now) ||
      scheduleGames.slice().reverse().find(game => game.status === "final") ||
      scheduleGames[scheduleGames.length - 1];
  }

  async function loadScheduleYear(year) {
    if (loadedScheduleYears.has(year)) return;
    if (scheduleYearRequests.has(year)) return scheduleYearRequests.get(year);
    const request = (async () => {
      const response = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?limit=1000&dates=${year}`);
      if (!response.ok) throw new Error(`Schedule unavailable for ${year} (${response.status}).`);
      const payload = await response.json();
      if (!Array.isArray(payload.events)) throw new Error(`The schedule feed returned invalid data for ${year}.`);
      const byId = new Map(games.map(game => [String(game.id), game]));
      payload.events.map(normalizeEvent).filter(game => game.dateKey).forEach(game => byId.set(String(game.id), game));
      games = [...byId.values()].sort(compareKickoff);
      loadedScheduleYears.add(year);
      buildTeamFilter();
      renderCalendar();
    })().finally(() => scheduleYearRequests.delete(year));
    scheduleYearRequests.set(year, request);
    return request;
  }

  function openGameModal(game) {
    activeGame = game;
    document.getElementById("modal-week").textContent = game.week;
    document.getElementById("modal-matchup").textContent = `${game.away} @ ${game.home}`;
    document.getElementById("modal-date-line").textContent = `${formatDate(game.dateKey, { weekday: "long", month: "long", day: "numeric", year: "numeric" })} · ${game.time}`;
    document.getElementById("modal-away-team").textContent = game.away;
    document.getElementById("modal-home-team").textContent = game.home;
    document.getElementById("modal-away-logo").src = game.awayLogo;
    document.getElementById("modal-home-logo").src = game.homeLogo;
    document.getElementById("modal-away-logo").onerror = function () { this.src = "nfl logo.jfif"; };
    document.getElementById("modal-home-logo").onerror = function () { this.src = "nfl logo.jfif"; };
    document.getElementById("modal-time").textContent = game.status === "final" ? "Final" : game.time;
    document.getElementById("modal-score").textContent = game.score || "Not started";
    document.getElementById("modal-venue").textContent = game.venue;
    document.getElementById("modal-location").textContent = game.city && game.state ? `${game.city}, ${game.state}` : "Unavailable";
    document.getElementById("modal-type").textContent = game.type;
    document.getElementById("modal-broadcast").textContent = game.broadcasts || "Unavailable";
    document.getElementById("modal-records").textContent = game.records || "Unavailable";

    const tickets = document.getElementById("modal-tickets");
    tickets.hidden = !game.tickets;
    tickets.href = game.tickets || "#";
    const highlights = document.getElementById("modal-highlights");
    highlights.style.display = game.highlights ? "inline-flex" : "none";
    highlights.href = game.highlights || "#";

    const modal = document.getElementById("schedule-modal");
    selectGameTab("overview");
    loadGameSummary(game);
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
  }

  function applySharedSchedule(detail) {
    if (!detail || !Array.isArray(detail.events) || !detail.events.length) return;
    const previousGames = new Map(games.map(game => [String(game.id), game]));
    const updated = detail.events.map(normalizeEvent).filter(game => game.dateKey);
    if (!updated.length) return;
    updated.sort(compareKickoff);
    games = updated.map(game => {
      const previous = previousGames.get(String(game.id));
      return previous ? {
        ...game,
        broadcasts: game.broadcasts || previous.broadcasts,
        records: game.records || previous.records,
        highlights: game.highlights || previous.highlights
      } : game;
    });
    buildTeamFilter();
    renderCalendar();
    const scheduleGames = relevantScheduleGames();
    const currentOrUpcoming = scheduleGames.find(game => game.status === "live") ||
      scheduleGames.find(game => game.status === "upcoming" && game.kickoff && game.kickoff.getTime() >= Date.now()) ||
      scheduleGames.slice().reverse().find(game => game.status === "final") ||
      scheduleGames[scheduleGames.length - 1];
    const stage = currentOrUpcoming && currentOrUpcoming.type && currentOrUpcoming.type.toLowerCase() || "nfl";
    heroMessage.textContent = `Live ${stage} schedule · updated ${new Date(detail.updatedAt || Date.now()).toLocaleTimeString()}.`;

    if (!activeGame) return;
    const refreshedGame = games.find(game => String(game.id) === String(activeGame.id));
    if (!refreshedGame) return;
    const wasLive = activeGame.status === "live";
    activeGame = refreshedGame;
    document.getElementById("modal-week").textContent = refreshedGame.week;
    document.getElementById("modal-date-line").textContent =
      `${formatDate(refreshedGame.dateKey, { weekday: "long", month: "long", day: "numeric", year: "numeric" })} · ${refreshedGame.time}`;
    document.getElementById("modal-time").textContent = refreshedGame.status === "final" ? "Final" : refreshedGame.time;
    document.getElementById("modal-score").textContent = refreshedGame.score || "Not started";
    document.getElementById("modal-venue").textContent = refreshedGame.venue;
    document.getElementById("modal-location").textContent =
      refreshedGame.city && refreshedGame.state ? `${refreshedGame.city}, ${refreshedGame.state}` : "Unavailable";
    document.getElementById("modal-type").textContent = refreshedGame.type;
    document.getElementById("modal-broadcast").textContent = refreshedGame.broadcasts || "Unavailable";
    document.getElementById("modal-records").textContent = refreshedGame.records || "Unavailable";
    if (refreshedGame.status === "live") {
      if (!wasLive) loadGameSummary(refreshedGame);
    } else if (gameSummaryTimer) {
      window.clearInterval(gameSummaryTimer);
      gameSummaryTimer = null;
    }
  }

  function closeGameModal() {
    const modal = document.getElementById("schedule-modal");
    const wasOpen = modal.classList.contains("open");
    activeGame = null;
    window.clearInterval(gameSummaryTimer);
    gameSummaryTimer = null;
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
    if (wasOpen && new URLSearchParams(window.location.search).has("game")) {
      const url = new URL(window.location.href);
      url.searchParams.delete("game");
      window.history.replaceState(null, "", url);
    }
  }

  function selectGameTab(selected) {
    document.querySelectorAll("[data-game-tab]").forEach(button => {
      const active = button.dataset.gameTab === selected;
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    });
    document.querySelectorAll(".schedule-game-tab-panel").forEach(panel => {
      panel.hidden = panel.id !== `modal-panel-${selected}`;
    });
  }

  function createStatsTable(headers, rows) {
    const wrapper = document.createElement("div");
    wrapper.className = "schedule-detail-table-wrap";
    const table = document.createElement("table");
    table.className = "schedule-detail-table";
    const head = document.createElement("thead");
    const header = document.createElement("tr");
    headers.forEach(label => {
      const cell = document.createElement("th");
      cell.scope = "col";
      cell.textContent = label;
      header.appendChild(cell);
    });
    head.appendChild(header);
    const body = document.createElement("tbody");
    rows.forEach(row => {
      const tr = document.createElement("tr");
      row.forEach(value => {
        const cell = document.createElement("td");
        cell.textContent = value;
        tr.appendChild(cell);
      });
      body.appendChild(tr);
    });
    table.append(head, body);
    wrapper.appendChild(table);
    return wrapper;
  }

  function showEmptyPanel(id, message) {
    const panel = document.getElementById(id);
    panel.replaceChildren();
    const note = document.createElement("p");
    note.className = "schedule-data-note";
    note.textContent = message;
    panel.appendChild(note);
  }

  function renderGameSummary(game, summary) {
    const status = document.getElementById("modal-data-status");
    status.textContent = summary.header && summary.header.competitions && summary.header.competitions[0]
      ? `Data from ESPN · ${summary.header.competitions[0].status && summary.header.competitions[0].status.type && summary.header.competitions[0].status.type.shortDetail || "latest available"}`
      : "Latest game details from ESPN.";
    const teamGroups = summary.boxscore && summary.boxscore.teams || [];
    if (teamGroups.length) {
      const competitors = game.espnEvent && game.espnEvent.competitions && game.espnEvent.competitions[0] && game.espnEvent.competitions[0].competitors || [];
      const awayTeam = competitors.find(team => team.homeAway === "away");
      const homeTeam = competitors.find(team => team.homeAway === "home");
      const awayGroup = awayTeam && teamGroups.find(group => String(group.team && group.team.id) === String(awayTeam.team.id));
      const homeGroup = homeTeam && teamGroups.find(group => String(group.team && group.team.id) === String(homeTeam.team.id));
      const awayStats = new Map((awayGroup && awayGroup.statistics || []).map(stat => [stat.name, stat.displayValue]));
      const homeStats = new Map((homeGroup && homeGroup.statistics || []).map(stat => [stat.name, stat.displayValue]));
      const statNames = [...new Set([...awayStats.keys(), ...homeStats.keys()])].slice(0, 14);
      if (statNames.length) {
        document.getElementById("modal-panel-team-stats").replaceChildren(
          createStatsTable(["Statistic", game.away, game.home], statNames.map(name => [name.replace(/([A-Z])/g, " $1"), awayStats.get(name) || "—", homeStats.get(name) || "—"]))
        );
      } else {
        showEmptyPanel("modal-panel-team-stats", "Team statistics are not available for this game yet.");
      }
    } else {
      showEmptyPanel("modal-panel-team-stats", "Team statistics are not available for this game yet.");
    }

    const playerPanel = document.getElementById("modal-panel-player-stats");
    playerPanel.replaceChildren();
    const playerGroups = summary.boxscore && summary.boxscore.players || [];
    let playerTables = 0;
    playerGroups.forEach(group => (group.statistics || []).forEach(category => {
      const athletes = (category.athletes || []).slice(0, 10);
      if (!athletes.length || playerTables >= 8) return;
      const title = document.createElement("h4");
      title.className = "schedule-player-category";
      title.textContent = `${group.team && (group.team.displayName || group.team.name) || "Team"} · ${category.name || "Player stats"}`;
      playerPanel.appendChild(title);
      const labels = category.labels || [];
      const rows = athletes.map(entry => [entry.athlete && entry.athlete.displayName || "Player", ...(entry.stats || []).slice(0, 6)]);
      playerPanel.appendChild(createStatsTable(["Player", ...labels.slice(0, 6)], rows));
      playerTables++;
    }));
    if (!playerTables) showEmptyPanel("modal-panel-player-stats", "Player statistics are not available for this game yet.");

    const scoringPanel = document.getElementById("modal-panel-scoring");
    scoringPanel.replaceChildren();
    const plays = summary.scoringPlays || [];
    if (!plays.length) {
      showEmptyPanel("modal-panel-scoring", "No scoring plays have been reported for this game yet.");
    } else {
      const list = document.createElement("ol");
      list.className = "schedule-scoring-list";
      plays.slice().reverse().forEach(play => {
        const item = document.createElement("li");
        const heading = document.createElement("strong");
        heading.textContent = [play.period && play.period.number ? `Q${play.period.number}` : "", play.clock && play.clock.displayValue || "", `${play.awayScore ?? "—"}–${play.homeScore ?? "—"}`].filter(Boolean).join(" · ");
        const description = document.createElement("span");
        description.textContent = play.text || play.type && (play.type.text || play.type.name) || "Scoring play";
        item.append(heading, description);
        list.appendChild(item);
      });
      scoringPanel.appendChild(list);
    }
  }

  async function loadGameSummary(game) {
    const status = document.getElementById("modal-data-status");
    const cached = gameSummaryCache.get(game.id);
    let requestInFlight = false;
    const load = async () => {
      if (requestInFlight) return;
      requestInFlight = true;
      try {
        const response = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${encodeURIComponent(game.id)}`, { cache: "no-store" });
        if (!response.ok) throw new Error(`ESPN game details request failed (${response.status}).`);
        const summary = await response.json();
        gameSummaryCache.set(game.id, summary);
        if (activeGame && activeGame.id === game.id) renderGameSummary(game, summary);
      } catch (error) {
        console.error(`Unable to load game details for ${game.id}:`, error);
        if (activeGame && activeGame.id === game.id) status.textContent = "ESPN game details are temporarily unavailable. Try again later.";
      } finally {
        requestInFlight = false;
      }
    };
    if (cached) {
      renderGameSummary(game, cached);
      if (game.status === "live") startGameSummaryRefresh(game, load);
      return;
    }
    status.textContent = "Loading game details from ESPN…";
    ["modal-panel-team-stats", "modal-panel-player-stats", "modal-panel-scoring"].forEach(id => showEmptyPanel(id, "Loading…"));
    await load();
    if (game.status === "live") startGameSummaryRefresh(game, load);
  }

  function startGameSummaryRefresh(game, load) {
    window.clearInterval(gameSummaryTimer);
    gameSummaryTimer = window.setInterval(() => {
      if (!activeGame || activeGame.id !== game.id || document.visibilityState !== "visible") return;
      if (load) load();
      else loadGameSummary(game);
    }, 60000);
  }

  function animateMonthChange(direction) {
    calendarGrid.classList.remove("month-enter-left", "month-enter-right");
    calendarGrid.classList.add(direction === "next" ? "month-exit-left" : "month-exit-right");
    window.setTimeout(() => {
      renderCalendar();
      calendarGrid.classList.remove("month-exit-left", "month-exit-right");
      calendarGrid.classList.add(direction === "next" ? "month-enter-right" : "month-enter-left");
      window.setTimeout(() => calendarGrid.classList.remove("month-enter-left", "month-enter-right"), 220);
    }, 140);
  }

  function renderMonthPicker() {
    pickerYearLabel.textContent = pickerYear;
    pickerMonthGrid.innerHTML = "";
    monthNames.forEach((name, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `month-cell-btn${displayMonth.getFullYear() === pickerYear && displayMonth.getMonth() === index ? " active" : ""}`;
      button.textContent = name;
      button.addEventListener("click", () => {
        userChangedMonth = true;
        const direction = new Date(pickerYear, index) >= displayMonth ? "next" : "prev";
        displayMonth = new Date(pickerYear, index, 1);
        if (selectedDateKey.slice(0, 7) !== `${pickerYear}-${String(index + 1).padStart(2, "0")}`) {
          selectedDateKey = getDateKey(displayMonth);
        }
        loadScheduleYear(displayMonth.getFullYear()).catch(error => console.error("Unable to load the selected NFL schedule year:", error));
        animateMonthChange(direction);
        closeMonthPicker();
      });
      pickerMonthGrid.appendChild(button);
    });
  }

  function closeMonthPicker() {
    monthPicker.classList.remove("open");
    monthPicker.setAttribute("aria-hidden", "true");
    monthLabel.setAttribute("aria-expanded", "false");
  }

  async function loadSchedule() {
    try {
      const season = new Date().getFullYear();
      // ESPN's scoreboard endpoint accepts a season year, but rejects the date-range
      // form here with HTTP 400. A season query returns the complete published slate.
      await loadScheduleYear(season);
      if (!games.length) throw new Error("No games returned");
      games.sort(compareKickoff);
      const currentOrUpcoming = findRelevantGame();
      if (!currentOrUpcoming) throw new Error("No relevant NFL games found.");
      if (!userChangedMonth) {
        displayMonth = parseDateKey(currentOrUpcoming.dateKey);
        displayMonth.setDate(1);
      }
      if (!userSelectedCalendarDate) selectedDateKey = currentOrUpcoming.dateKey || todayKey;
      buildTeamFilter();
      renderCalendar();
      const seasonStage = currentOrUpcoming.type && currentOrUpcoming.type.toLowerCase();
      if (currentOrUpcoming.status === "upcoming" || currentOrUpcoming.status === "live") {
        heroMessage.textContent = `Live ${seasonStage || "NFL"} schedule with date-accurate sections and full game details.`;
      } else {
        heroMessage.textContent = `No upcoming NFL games are currently listed. Showing the latest published ${seasonStage || "season"} schedule.`;
      }
      const requestedGameId = new URLSearchParams(window.location.search).get("game");
      if (requestedGameId) {
        const requestedGame = games.find(game => String(game.id) === requestedGameId);
        if (requestedGame) {
          displayMonth = parseDateKey(requestedGame.dateKey);
          displayMonth.setDate(1);
          renderCalendar();
          openGameModal(requestedGame);
        }
      }
    } catch (error) {
      games = [];
      buildTeamFilter();
      renderCalendar();
      heroMessage.textContent = "Live schedule is temporarily unavailable. Please check back shortly.";
    }
  }

  window.toggleMenu = function () {
    const menu = document.getElementById("side-menu");
    menu.style.width = menu.style.width === "280px" ? "0" : "280px";
  };
  window.toggleTheme = toggleTheme;

  syncTheme();
  document.getElementById("prev-month-btn").addEventListener("click", () => navigateMonth(-1));
  document.getElementById("next-month-btn").addEventListener("click", () => navigateMonth(1));
  document.getElementById("today-btn").addEventListener("click", async () => {
    userChangedMonth = true;
    try {
      await loadScheduleYear(new Date().getFullYear());
    } catch (error) {
      console.error("Unable to load the current NFL schedule year:", error);
    }
    const relevantGame = findRelevantGame();
    const dateKey = relevantGame && relevantGame.dateKey || todayKey;
    displayMonth = parseDateKey(dateKey);
    displayMonth.setDate(1);
    selectedDateKey = dateKey;
    try {
      await loadScheduleYear(displayMonth.getFullYear());
    } catch (error) {
      console.error("Unable to load the selected NFL schedule year:", error);
    }
    renderCalendar();
    closeMonthPicker();
    if (!scheduleListView.hidden) scrollToRelevantGame(dateKey);
  });
  teamFilter.addEventListener("change", renderCalendar);
  document.getElementById("schedule-view-list").addEventListener("click", () => setScheduleView("list"));
  document.getElementById("schedule-view-calendar").addEventListener("click", () => setScheduleView("calendar"));
  monthLabel.addEventListener("click", () => { if (monthPicker.classList.contains("open")) closeMonthPicker(); else { pickerYear = displayMonth.getFullYear(); renderMonthPicker(); monthPicker.classList.add("open"); monthPicker.setAttribute("aria-hidden", "false"); monthLabel.setAttribute("aria-expanded", "true"); } });
  document.getElementById("picker-year-prev").addEventListener("click", () => { pickerYear--; renderMonthPicker(); });
  document.getElementById("picker-year-next").addEventListener("click", () => { pickerYear++; renderMonthPicker(); });
  document.getElementById("schedule-modal-close").addEventListener("click", closeGameModal);
  document.querySelectorAll("[data-game-tab]").forEach(button => {
    button.addEventListener("click", () => selectGameTab(button.dataset.gameTab));
    button.addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      const tabs = [...document.querySelectorAll("[data-game-tab]")];
      const index = tabs.indexOf(button);
      const next = tabs[(index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
      selectGameTab(next.dataset.gameTab);
      next.focus();
    });
  });
  document.getElementById("schedule-modal").addEventListener("click", event => { if (event.target.id === "schedule-modal") closeGameModal(); });
  document.addEventListener("click", event => { if (!monthPicker.contains(event.target) && event.target !== monthLabel) closeMonthPicker(); });
  document.addEventListener("keydown", event => { if (event.key === "Escape") closeGameModal(); });
  const backToTopButton = document.getElementById("schedule-back-to-top");
  let backToTopVisible = false;
  function updateBackToTop() {
    const visible = window.scrollY > 400;
    if (visible === backToTopVisible) return;
    backToTopVisible = visible;
    backToTopButton.classList.toggle("is-visible", visible);
    backToTopButton.setAttribute("aria-hidden", String(!visible));
    backToTopButton.tabIndex = visible ? 0 : -1;
  }
  window.addEventListener("scroll", updateBackToTop, { passive: true });
  updateBackToTop();
  backToTopButton.addEventListener("click", () => {
    window.scrollTo({
      top: 0,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
    });
  });
  window.addEventListener("storage", syncTheme);
  window.addEventListener("blitz-nfl-scoreboard", event => applySharedSchedule(event.detail));
  window.addEventListener("blitz-nfl-scoreboard-error", event => {
    heroMessage.textContent = event.detail && event.detail.message ||
      "NFL schedule data could not be refreshed; displayed scores may be out of date.";
  });

  const user = localStorage.getItem("currentUser") || sessionStorage.getItem("currentUser");
  if (user) {
    const navButton = document.getElementById("nav-login-btn");
    const sideLink = document.getElementById("side-login-link");
    if (navButton) { navButton.textContent = "ACCOUNT"; navButton.href = "Account.html"; }
    if (sideLink) { sideLink.textContent = "Account"; sideLink.href = "Account.html"; }
  }

  loadSchedule();
}());
