(function () {
  "use strict";

  const root = document.documentElement;
  const scheduleTimeZone = "America/New_York";
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthLabel = document.getElementById("current-month-label");
  const monthPicker = document.getElementById("month-picker");
  const pickerYearLabel = document.getElementById("picker-year-label");
  const pickerMonthGrid = document.getElementById("picker-month-grid");
  const calendarGrid = document.getElementById("calendar-grid");
  const teamFilter = document.getElementById("team-filter");
  const heroMessage = document.querySelector(".schedule-hero .muted");
  const todayKey = getDateKey(new Date());
  let games = [];
  let scheduleCountdownInterval = null;
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
    const mode = readJson("user_settings.theme", localStorage.getItem("theme") || "light-mode");
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
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: scheduleTimeZone,
      year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(date).reduce((result, part) => {
      result[part.type] = part.value;
      return result;
    }, {});
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function parseDateKey(dateKey) {
    const [year, month, day] = dateKey.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  function formatDate(dateKey, options) {
    return new Intl.DateTimeFormat("en-US", Object.assign({ timeZone: scheduleTimeZone }, options)).format(parseDateKey(dateKey));
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
    const seasonType = event.season && event.season.type && event.season.type.name;
    const venue = competition.venue || {};
    const address = venue.address || {};
    const homeTeam = home.team || {};
    const awayTeam = away.team || {};
    const week = competition.week && competition.week.number || event.week && event.week.number || "";
    const broadcasts = (competition.broadcasts || []).flatMap(item => item.names || []).filter(Boolean);

    return {
      id: event.id,
      kickoff: Number.isNaN(start.getTime()) ? null : start,
      dateKey: getDateKey(start),
      away: awayTeam.displayName || "TBD",
      home: homeTeam.displayName || "TBD",
      awayId: (awayTeam.abbreviation || "").toLowerCase(),
      homeId: (homeTeam.abbreviation || "").toLowerCase(),
      awayLogo: getLogo(awayTeam),
      homeLogo: getLogo(homeTeam),
      time: status.type && status.type.shortDetail || new Intl.DateTimeFormat("en-US", { timeZone: scheduleTimeZone, hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(start),
      status: state === "post" ? "final" : state === "in" ? "live" : "upcoming",
      score: state === "pre" ? "" : `${away.score || 0}-${home.score || 0}`,
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
    card.setAttribute("aria-label", `View details for ${game.away} at ${game.home}`);
    const meta = document.createElement("span");
    meta.className = "game-card-meta";
    meta.textContent = `${game.status === "final" ? "FINAL" : game.time}  ·  ${game.venue}`;
    const matchup = document.createElement("span");
    matchup.className = "game-card-matchup";
    matchup.append(createTeamRow(game, "away", game.away, game.awayLogo));
    const at = document.createElement("span");
    at.className = "game-card-at";
    at.textContent = game.status === "final" || game.status === "live" ? game.score : "@";
    matchup.append(at, createTeamRow(game, "home", game.home, game.homeLogo));
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
    visible.sort((a, b) => a.dateKey.localeCompare(b.dateKey) || a.time.localeCompare(b.time)).forEach(game => {
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
  }

  function openGameModal(game) {
    document.getElementById("modal-week").textContent = game.week;
    document.getElementById("modal-matchup").textContent = `${game.away} @ ${game.home}`;
    document.getElementById("modal-date-line").textContent = `${formatDate(game.dateKey, { weekday: "long", month: "long", day: "numeric", year: "numeric" })} · ${game.time}`;
    document.getElementById("modal-away-team").textContent = game.away;
    document.getElementById("modal-home-team").textContent = game.home;
    document.getElementById("modal-away-logo").src = game.awayLogo;
    document.getElementById("modal-home-logo").src = game.homeLogo;
    document.getElementById("modal-away-logo").onerror = function () { this.src = "nfl logo.jfif"; };
    document.getElementById("modal-home-logo").onerror = function () { this.src = "nfl logo.jfif"; };
    document.getElementById("modal-time").textContent = game.status === "final" ? "Final" : game.status === "live" ? "Live" : game.time;
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
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
  }

  function closeGameModal() {
    const modal = document.getElementById("schedule-modal");
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
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
        const direction = new Date(pickerYear, index) >= displayMonth ? "next" : "prev";
        displayMonth = new Date(pickerYear, index, 1);
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
      const response = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?limit=1000&dates=${season}0901-${season + 1}0220`);
      if (!response.ok) throw new Error("Schedule unavailable");
      const payload = await response.json();
      games = (payload.events || []).map(normalizeEvent).filter(game => game.dateKey);
      if (!games.length) throw new Error("No games returned");
      games.sort((a, b) => a.dateKey.localeCompare(b.dateKey));
      displayMonth = parseDateKey(games[0].dateKey);
      displayMonth.setDate(1);
      buildTeamFilter();
      renderCalendar();
      heroMessage.textContent = "Live NFL schedule with date-accurate week sections and full game details.";
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
  document.getElementById("prev-month-btn").addEventListener("click", () => { displayMonth.setMonth(displayMonth.getMonth() - 1); animateMonthChange("prev"); });
  document.getElementById("next-month-btn").addEventListener("click", () => { displayMonth.setMonth(displayMonth.getMonth() + 1); animateMonthChange("next"); });
  document.getElementById("today-btn").addEventListener("click", () => { displayMonth = parseDateKey(todayKey); displayMonth.setDate(1); renderCalendar(); closeMonthPicker(); });
  teamFilter.addEventListener("change", renderCalendar);
  monthLabel.addEventListener("click", () => { if (monthPicker.classList.contains("open")) closeMonthPicker(); else { pickerYear = displayMonth.getFullYear(); renderMonthPicker(); monthPicker.classList.add("open"); monthPicker.setAttribute("aria-hidden", "false"); monthLabel.setAttribute("aria-expanded", "true"); } });
  document.getElementById("picker-year-prev").addEventListener("click", () => { pickerYear--; renderMonthPicker(); });
  document.getElementById("picker-year-next").addEventListener("click", () => { pickerYear++; renderMonthPicker(); });
  document.getElementById("schedule-modal-close").addEventListener("click", closeGameModal);
  document.getElementById("schedule-modal").addEventListener("click", event => { if (event.target.id === "schedule-modal") closeGameModal(); });
  document.addEventListener("click", event => { if (!monthPicker.contains(event.target) && event.target !== monthLabel) closeMonthPicker(); });
  document.addEventListener("keydown", event => { if (event.key === "Escape") closeGameModal(); });
  window.addEventListener("storage", syncTheme);

  const user = localStorage.getItem("currentUser") || sessionStorage.getItem("currentUser");
  if (user) {
    const navButton = document.getElementById("nav-login-btn");
    const sideLink = document.getElementById("side-login-link");
    if (navButton) { navButton.textContent = "ACCOUNT"; navButton.href = "Account.html"; }
    if (sideLink) { sideLink.textContent = "Account"; sideLink.href = "Account.html"; }
  }

  loadSchedule();
}());
