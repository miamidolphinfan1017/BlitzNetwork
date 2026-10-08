(function () {
  "use strict";

  const scoringPointsField = { ppr: "pts_ppr", half_ppr: "pts_half_ppr", std: "pts_std" };
  const positionOrder = ["QB", "RB", "WR", "TE", "K", "DST"];
  const lineupSlots = [
    { id: "QB", label: "QB", positions: ["QB"] },
    { id: "RB1", label: "RB", positions: ["RB"] },
    { id: "RB2", label: "RB", positions: ["RB"] },
    { id: "WR1", label: "WR", positions: ["WR"] },
    { id: "WR2", label: "WR", positions: ["WR"] },
    { id: "TE", label: "TE", positions: ["TE"] },
    { id: "FLEX", label: "FLEX", positions: ["RB", "WR", "TE"] },
    { id: "K", label: "K", positions: ["K"] },
    { id: "DST", label: "DST", positions: ["DST"] },
    { id: "BENCH", label: "Bench", positions: positionOrder }
  ];
  const pageSize = 50;
  const elements = {};
  [
    "fantasy-error", "fantasy-error-message", "fantasy-retry", "fantasy-notice",
    "fantasy-updated", "fantasy-week", "fantasy-prev-week", "fantasy-next-week",
    "fantasy-scoring", "fantasy-search", "fantasy-refresh", "fantasy-position-filters",
    "fantasy-top-name", "fantasy-top-detail", "fantasy-trend-name", "fantasy-trend-detail",
    "fantasy-matchup-summary", "fantasy-scoring-summary", "fantasy-projection-cards",
    "fantasy-sort", "fantasy-result-count", "fantasy-rankings", "fantasy-matchups",
    "fantasy-compare-a", "fantasy-compare-b", "fantasy-comparison", "fantasy-lineup",
    "fantasy-trending-up", "fantasy-trending-down",
    "fantasy-lineup-total", "fantasy-player-dialog", "fantasy-dialog-meta",
    "fantasy-dialog-name", "fantasy-dialog-content", "fantasy-dialog-close"
  ].forEach(id => { elements[id] = document.getElementById(id); });

  const app = {
    season: null,
    currentWeek: 1,
    selectedWeek: null,
    scoring: "ppr",
    position: "ALL",
    sort: "projection",
    search: "",
    players: [],
    directory: [],
    playersById: new Map(),
    scheduleByTeam: new Map(),
    scheduleEvents: [],
    weeklyStats: new Map(),
    seasonStats: {},
    projections: {},
    pageLimit: pageSize,
    loadVersion: 0,
    fetchedAt: null,
    errors: { schedule: false, seasonStats: false, weeklyStats: false },
    lineup: readStoredObject("blitz_fantasy_lineup"),
    watched: new Set(readStoredArray("blitz_fantasy_watchlist"))
  };

  function readStoredObject(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "{}");
      return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    } catch (error) {
      console.error(`Could not read ${key}:`, error);
      return {};
    }
  }

  function readStoredArray(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(value) ? value : [];
    } catch (error) {
      console.error(`Could not read ${key}:`, error);
      return [];
    }
  }

  function saveStoredValue(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.error(`Could not save ${key}:`, error);
      setNotice("Your browser could not save this setting. Check the browser's local-storage permissions.", true);
    }
  }

  function setNotice(message, isError) {
    elements["fantasy-notice"].textContent = message;
    elements["fantasy-notice"].classList.toggle("fantasy-notice-error", Boolean(isError));
    elements["fantasy-notice"].hidden = !message;
  }

  function setLoading(container, text) {
    const message = document.createElement("p");
    message.className = "fantasy-loading";
    message.textContent = text;
    container.replaceChildren(message);
  }

  function finiteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function pointsFor(stats) {
    if (!stats || typeof stats !== "object") return null;
    return finiteNumber(stats[scoringPointsField[app.scoring]]);
  }

  function formatPoints(value) {
    return value === null || value === undefined ? "—" : `${value.toFixed(1)}`;
  }

  function formatAverage(value) {
    return value === null || value === undefined ? "—" : value.toFixed(1);
  }

  function normalizePosition(position) {
    return position === "DEF" || position === "D/ST" ? "DST" : position;
  }

  function getPlayerPosition(player) {
    const eligible = Array.isArray(player.fantasy_positions)
      ? player.fantasy_positions.map(normalizePosition).filter(position => positionOrder.includes(position))
      : [];
    const primary = normalizePosition(player.position);
    return positionOrder.includes(primary) ? primary : (eligible[0] || "");
  }

  function makeScheduleLookup(payload, week) {
    const events = Array.isArray(payload.events) ? payload.events : [];
    const filteredEvents = events.filter(event => {
      const eventWeek = event.week && finiteNumber(event.week.number);
      const competitionWeek = event.competitions && event.competitions[0] &&
        event.competitions[0].week && finiteNumber(event.competitions[0].week.number);
      return Number(eventWeek || competitionWeek) === Number(week);
    });
    const byTeam = new Map();
    filteredEvents.forEach(event => {
      const competition = event.competitions && event.competitions[0] || {};
      const competitors = Array.isArray(competition.competitors) ? competition.competitors : [];
      const home = competitors.find(team => team.homeAway === "home");
      const away = competitors.find(team => team.homeAway === "away");
      const homeTeam = home && home.team || {};
      const awayTeam = away && away.team || {};
      const date = new Date(event.date);
      if (!homeTeam.abbreviation || !awayTeam.abbreviation || Number.isNaN(date.getTime())) return;
      const statusType = competition.status && competition.status.type ||
        event.status && event.status.type || {};
      const game = {
        id: String(event.id || ""),
        date,
        status: statusType.state || "pre",
        kickoffKnown: statusType.state !== "pre" ||
          Boolean(statusType.shortDetail && !/tbd/i.test(statusType.shortDetail)),
        home: homeTeam.abbreviation,
        away: awayTeam.abbreviation,
        homeName: homeTeam.displayName || homeTeam.abbreviation,
        awayName: awayTeam.displayName || awayTeam.abbreviation
      };
      byTeam.set(game.home, { game, opponent: game.away, side: "HOME" });
      byTeam.set(game.away, { game, opponent: game.home, side: "AWAY" });
    });
    return { events: filteredEvents, byTeam };
  }

  function getActualScores(id, limit) {
    const weeks = [...app.weeklyStats.entries()]
      .filter(([week]) => Number(week) < Math.min(app.selectedWeek, app.currentWeek))
      .map(([week, data]) => ({ week: Number(week), stats: data[String(id)] }))
      .filter(item => item.stats && finiteNumber(item.stats.gp) > 0)
      .sort((left, right) => right.week - left.week);
    return weeks.slice(0, limit).map(item => ({
      week: item.week,
      points: pointsFor(item.stats)
    })).filter(item => item.points !== null);
  }

  function average(values) {
    return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
  }

  function buildPlayerRows() {
    const pointsField = scoringPointsField[app.scoring];
    const rows = app.directory.map(player => {
      const id = String(player.player_id);
      const stats = app.seasonStats[id] || {};
      const gamesPlayed = finiteNumber(stats.gp);
      const seasonTotal = finiteNumber(stats[pointsField]);
      const last3 = getActualScores(id, 3);
      const last5 = getActualScores(id, 5);
      const last3Average = average(last3.map(game => game.points));
      const seasonAverage = gamesPlayed > 0 && seasonTotal !== null ? seasonTotal / gamesPlayed : null;
      const trendDelta = last3.length === 3 && gamesPlayed > 3 && seasonAverage !== null
        ? last3Average - seasonAverage
        : null;
      const latestCompletedWeek = Math.min(app.selectedWeek - 1, app.currentWeek - 1);
      const weekly = app.weeklyStats.get(String(latestCompletedWeek)) || {};
      const schedule = player.team ? app.scheduleByTeam.get(player.team) : null;
      const rawProjection = app.projections[id];
      const projection = rawProjection && finiteNumber(rawProjection[pointsField]);
      const eligiblePositions = Array.isArray(player.fantasy_positions)
        ? [...new Set(player.fantasy_positions.map(normalizePosition).filter(position => positionOrder.includes(position)))]
        : [];
      const position = getPlayerPosition(player);
      return {
        id,
        name: player.full_name,
        position,
        eligiblePositions: eligiblePositions.length ? eligiblePositions : [position],
        team: player.team || "FA",
        injury: player.injury_status && player.injury_status !== "Active" ? player.injury_status : "",
        projection: projection !== null && projection > 0 ? projection : null,
        seasonAverage,
        last3Average,
        last5Average: average(last5.map(game => game.points)),
        last5Games: last5,
        trendDelta,
        previousWeekStats: weekly[id] || null,
        previousWeekNumber: latestCompletedWeek,
        matchup: schedule || null,
      };
    }).filter(player => player.position && player.name && (player.projection !== null || player.team !== "FA"));

    const projected = rows.filter(player => player.projection !== null)
      .sort((left, right) => right.projection - left.projection || left.name.localeCompare(right.name));
    const positionRanks = new Map();
    projected.forEach((player, index) => {
      player.rank = index + 1;
      const positionRank = (positionRanks.get(player.position) || 0) + 1;
      positionRanks.set(player.position, positionRank);
      player.positionRank = positionRank;
    });
    rows.forEach(player => {
      if (player.rank === undefined) {
        player.rank = null;
        player.positionRank = null;
      }
    });
    app.playersById = new Map(rows.map(player => [player.id, player]));
    return rows;
  }

  function sortPlayers(players) {
    const compareNullable = (left, right, key, direction) => {
      const a = left[key];
      const b = right[key];
      if (a === null || a === undefined) return b === null || b === undefined ? 0 : 1;
      if (b === null || b === undefined) return -1;
      return (a - b) * direction;
    };
    const sorted = [...players];
    sorted.sort((left, right) => {
      if (app.sort === "season") return compareNullable(left, right, "seasonAverage", -1) || (left.rank || Infinity) - (right.rank || Infinity);
      if (app.sort === "last3") return compareNullable(left, right, "last3Average", -1) || (left.rank || Infinity) - (right.rank || Infinity);
      if (app.sort === "team") return left.team.localeCompare(right.team) || (left.rank || Infinity) - (right.rank || Infinity);
      if (app.sort === "position") return positionOrder.indexOf(left.position) - positionOrder.indexOf(right.position) || (left.rank || Infinity) - (right.rank || Infinity);
      if (app.sort === "name") return left.name.localeCompare(right.name);
      return compareNullable(left, right, "projection", -1) || (left.rank || Infinity) - (right.rank || Infinity);
    });
    return sorted;
  }

  function getVisiblePlayers() {
    const query = app.search.trim().toLowerCase();
    const filtered = app.players.filter(player => {
      const positionMatches = app.position === "ALL" ||
        (app.position === "FLEX"
          ? player.eligiblePositions.some(position => ["RB", "WR", "TE"].includes(position))
          : player.eligiblePositions.includes(app.position) || player.position === app.position);
      if (!positionMatches) return false;
      return !query || `${player.name} ${player.team} ${player.position} ${player.eligiblePositions.join(" ")}`.toLowerCase().includes(query);
    });
    return sortPlayers(filtered);
  }

  function textElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function playerButton(player, className) {
    const button = textElement("button", className, player.name);
    button.type = "button";
    button.dataset.playerId = player.id;
    button.setAttribute("aria-label", `View details for ${player.name}, ${player.position}, ${player.team}`);
    return button;
  }

  function matchupText(player) {
    if (!player.matchup) return "No scheduled game";
    const { game, opponent, side } = player.matchup;
    const opponentLabel = side === "HOME" ? `vs ${opponent}` : `@ ${opponent}`;
    if (!game.kickoffKnown) return `${opponentLabel} · Kickoff TBA`;
    const time = new Intl.DateTimeFormat(undefined, {
      weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
    }).format(game.date);
    if (game.status === "in") return `${opponentLabel} · LIVE`;
    if (game.status === "post") return `${opponentLabel} · FINAL`;
    return `${opponentLabel} · ${time}`;
  }

  function trendLabel(player) {
    if (player.trendDelta === null) return "Trend unavailable";
    if (player.trendDelta > 0.5) return `Up ${player.trendDelta.toFixed(1)} vs season`;
    if (player.trendDelta < -0.5) return `Down ${Math.abs(player.trendDelta).toFixed(1)} vs season`;
    return "Steady";
  }

  function createProjectionCard(player, index) {
    const card = textElement("article", "fantasy-projection-card");
    const rank = textElement("span", "fantasy-card-rank", `#${index + 1}`);
    const playerLine = textElement("div", "fantasy-card-player");
    const info = textElement("div", "");
    info.append(playerButton(player, "fantasy-player-link"));
    info.appendChild(textElement("span", "fantasy-player-subtitle", `${player.position} · ${player.team}`));
    playerLine.append(rank, info);
    if (player.injury) playerLine.appendChild(textElement("span", "fantasy-injury-badge", player.injury));
    const projection = textElement("div", "fantasy-card-projection");
    projection.append(textElement("strong", "", formatPoints(player.projection)), textElement("span", "", "projected"));
    const meta = textElement("div", "fantasy-card-meta");
    meta.append(
      textElement("span", "", matchupText(player)),
      textElement("span", "", `Season ${formatAverage(player.seasonAverage)} · L3 ${formatAverage(player.last3Average)}`)
    );
    card.append(playerLine, projection, meta);
    return card;
  }

  function renderSummary() {
    const projected = app.players.filter(player => player.projection !== null)
      .sort((left, right) => right.projection - left.projection);
    const leaders = projected.slice(0, 5);
    elements["fantasy-projection-cards"].replaceChildren();
    if (leaders.length) leaders.forEach((player, index) => elements["fantasy-projection-cards"].appendChild(createProjectionCard(player, index)));
    else setLoading(elements["fantasy-projection-cards"], `No provider projections are available for Week ${app.selectedWeek}.`);

    const top = projected[0];
    elements["fantasy-top-name"].textContent = top ? top.name : "Unavailable";
    elements["fantasy-top-detail"].textContent = top
      ? `${top.position} · ${top.team} · ${formatPoints(top.projection)} ${app.scoring.toUpperCase()}`
      : "No weekly provider projection";

    const rising = app.players.filter(player => player.trendDelta !== null)
      .sort((left, right) => right.trendDelta - left.trendDelta)[0];
    elements["fantasy-trend-name"].textContent = rising && rising.trendDelta > 0.5 ? rising.name : "No clear riser";
    elements["fantasy-trend-detail"].textContent = rising && rising.trendDelta > 0.5
      ? `Last 3 actual games are +${rising.trendDelta.toFixed(1)} PPG vs season average`
      : "Needs 4+ completed games to compare L3 with season average";
    elements["fantasy-matchup-summary"].textContent = app.errors.schedule
      ? "Unavailable"
      : `${app.scheduleEvents.length} games scheduled`;
    elements["fantasy-scoring-summary"].textContent = elements["fantasy-scoring"].selectedOptions[0].textContent;
    elements["fantasy-updated"].textContent = app.fetchedAt
      ? `Fetched ${new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(app.fetchedAt)}`
      : "Data not refreshed";
  }

  function appendPlayerRow(tbody, player) {
    const row = document.createElement("tr");
    const rankCell = textElement("td", "fantasy-rank-cell", player.rank ? `#${player.rank}` : "—");
    const playerCell = document.createElement("td");
    const playerInfo = textElement("div", "fantasy-table-player");
    playerInfo.appendChild(playerButton(player, "fantasy-player-link"));
    playerInfo.appendChild(textElement("span", "fantasy-player-subtitle", `${player.positionRank ? `${player.position}${player.positionRank}` : player.position} · ${player.team}`));
    if (player.injury) playerInfo.appendChild(textElement("span", "fantasy-injury-badge", player.injury));
    playerCell.appendChild(playerInfo);
    const positionCell = textElement("td", "fantasy-position-cell", player.position);
    const matchupCell = textElement("td", "fantasy-matchup-cell", matchupText(player));
    const projectionCell = textElement("td", "fantasy-number-cell", formatPoints(player.projection));
    projectionCell.classList.add("is-projection");
    const seasonCell = textElement("td", "fantasy-number-cell", formatAverage(player.seasonAverage));
    const last3Cell = textElement("td", "fantasy-number-cell", formatAverage(player.last3Average));
    const last5Cell = textElement("td", "fantasy-number-cell", formatAverage(player.last5Average));
    const trend = textElement("td", "fantasy-trend-cell", trendLabel(player));
    if (player.trendDelta !== null) trend.dataset.trend = player.trendDelta > 0.5 ? "up" : player.trendDelta < -0.5 ? "down" : "steady";
    row.append(rankCell, playerCell, positionCell, matchupCell, projectionCell, seasonCell, last3Cell, last5Cell, trend);
    tbody.appendChild(row);
  }

  function appendPlayerCard(container, player) {
    const card = textElement("article", "fantasy-mobile-player-card");
    const header = textElement("div", "fantasy-mobile-card-header");
    const identity = textElement("div", "fantasy-mobile-player-identity");
    identity.append(playerButton(player, "fantasy-player-link"));
    identity.appendChild(textElement("span", "fantasy-player-subtitle", `#${player.rank || "—"} · ${player.position} · ${player.team}`));
    header.append(identity, textElement("strong", "fantasy-mobile-projection", `${formatPoints(player.projection)} PTS`));
    const info = textElement("div", "fantasy-mobile-card-stats");
    info.append(
      textElement("span", "", `OPP ${player.matchup ? `${player.matchup.side === "HOME" ? "vs" : "@"} ${player.matchup.opponent}` : "—"}`),
      textElement("span", "", `SEASON ${formatAverage(player.seasonAverage)}`),
      textElement("span", "", `L3 ${formatAverage(player.last3Average)}`),
      textElement("span", "", trendLabel(player))
    );
    const details = textElement("details", "fantasy-mobile-extra");
    details.appendChild(textElement("summary", "", "More details"));
    details.appendChild(textElement("p", "", `Last 5: ${formatAverage(player.last5Average)} · Game: ${matchupText(player)}${player.injury ? ` · Status: ${player.injury}` : ""}`));
    card.append(header, info, details);
    container.appendChild(card);
  }

  function renderRankings() {
    const players = getVisiblePlayers();
    const visible = players.slice(0, app.pageLimit);
    elements["fantasy-result-count"].textContent = players.length
      ? `Showing ${visible.length} of ${players.length} players · ranking uses provider weekly projection`
      : "No players match these filters.";
    elements["fantasy-rankings"].replaceChildren();
    if (!visible.length) return;

    const mobile = window.matchMedia("(max-width: 900px)").matches;
    if (mobile) {
      const cards = textElement("div", "fantasy-mobile-player-list");
      visible.forEach(player => appendPlayerCard(cards, player));
      elements["fantasy-rankings"].appendChild(cards);
    } else {
      const wrapper = textElement("div", "fantasy-table-wrap");
      const table = document.createElement("table");
      table.className = "fantasy-player-table";
      const head = document.createElement("thead");
      const headerRow = document.createElement("tr");
      ["Rank", "Player", "Pos", "Opponent / kickoff", "Projection", "Season avg", "Last 3", "Last 5", "Trend"].forEach(label => {
        const cell = textElement("th", "", label);
        cell.scope = "col";
        headerRow.appendChild(cell);
      });
      head.appendChild(headerRow);
      const body = document.createElement("tbody");
      visible.forEach(player => appendPlayerRow(body, player));
      table.append(head, body);
      wrapper.appendChild(table);
      elements["fantasy-rankings"].appendChild(wrapper);
    }

    if (visible.length < players.length) {
      const more = textElement("button", "fantasy-button fantasy-load-more", `Load ${Math.min(pageSize, players.length - visible.length)} more`);
      more.type = "button";
      more.addEventListener("click", () => {
        app.pageLimit += pageSize;
        renderRankings();
      });
      elements["fantasy-rankings"].appendChild(more);
    }
  }

  function renderMatchups() {
    elements["fantasy-matchups"].replaceChildren();
    if (app.errors.schedule) {
      setLoading(elements["fantasy-matchups"], "The ESPN schedule is unavailable. Opponents and kickoff times are not shown.");
      return;
    }
    if (!app.scheduleEvents.length) {
      setLoading(elements["fantasy-matchups"], `No schedule events were returned for Week ${app.selectedWeek}.`);
      return;
    }
    app.scheduleEvents.slice().sort((left, right) => new Date(left.date) - new Date(right.date)).forEach(event => {
      const competition = event.competitions && event.competitions[0] || {};
      const competitors = competition.competitors || [];
      const home = competitors.find(team => team.homeAway === "home");
      const away = competitors.find(team => team.homeAway === "away");
      if (!home || !away) return;
      const game = textElement("article", "fantasy-matchup-row");
      const teams = textElement("strong", "fantasy-matchup-teams", `${away.team.abbreviation} @ ${home.team.abbreviation}`);
      const date = new Date(event.date);
      const time = Number.isNaN(date.getTime())
        ? "Kickoff unavailable"
        : new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
      const statusType = competition.status && competition.status.type || event.status && event.status.type || {};
      const status = statusType.state || "pre";
      const statusLabel = status === "in" ? "LIVE" : status === "post" ? "FINAL" :
        !statusType.shortDetail || /tbd/i.test(statusType.shortDetail) ? "Kickoff TBA" : time;
      game.append(teams, textElement("span", "", statusLabel));
      elements["fantasy-matchups"].appendChild(game);
    });
  }

  function fillPlayerSelect(select, placeholder, selectedValue, filterPositions) {
    const blank = document.createElement("option");
    blank.value = "";
    blank.textContent = placeholder;
    const options = [blank];
    app.players.filter(player => player.projection !== null &&
      (!filterPositions || filterPositions.some(position => player.eligiblePositions.includes(position) || player.position === position)))
      .sort((left, right) => (left.rank || Infinity) - (right.rank || Infinity))
      .forEach(player => {
        const option = document.createElement("option");
        option.value = player.id;
        option.textContent = `${player.name} · ${player.position} · ${player.team}`;
        options.push(option);
      });
    select.replaceChildren(...options);
    select.value = selectedValue || "";
  }

  function renderComparisonSelects() {
    const left = elements["fantasy-compare-a"].value;
    const right = elements["fantasy-compare-b"].value;
    fillPlayerSelect(elements["fantasy-compare-a"], "Choose a player", left);
    fillPlayerSelect(elements["fantasy-compare-b"], "Choose a player", right);
  }

  function renderComparison() {
    const left = app.playersById.get(elements["fantasy-compare-a"].value);
    const right = app.playersById.get(elements["fantasy-compare-b"].value);
    elements["fantasy-comparison"].replaceChildren();
    if (!left || !right) {
      elements["fantasy-comparison"].appendChild(textElement("p", "", "Select two players to compare."));
      return;
    }
    if (left.id === right.id) {
      elements["fantasy-comparison"].appendChild(textElement("p", "", "Choose two different players."));
      return;
    }
    const winner = left.projection === null || right.projection === null
      ? null
      : left.projection === right.projection ? null : left.projection > right.projection ? left : right;
    const delta = left.projection !== null && right.projection !== null ? Math.abs(left.projection - right.projection) : null;
    const heading = winner
      ? `Projection edge: ${winner.name} by ${delta.toFixed(1)} points`
      : left.projection !== null && right.projection !== null ? "Projections are level" : "Projection comparison unavailable";
    elements["fantasy-comparison"].appendChild(textElement("strong", "fantasy-comparison-edge", heading));
    elements["fantasy-comparison"].appendChild(textElement("p", "fantasy-comparison-caveat", "A projection is an estimate, not a guaranteed result."));
    const table = document.createElement("table");
    table.className = "fantasy-compare-table";
    const thead = document.createElement("thead");
    const header = document.createElement("tr");
    ["Metric", left.name, right.name].forEach(text => header.appendChild(textElement("th", "", text)));
    thead.appendChild(header);
    const body = document.createElement("tbody");
    [
      ["Position / team", `${left.position} · ${left.team}`, `${right.position} · ${right.team}`],
      ["Opponent", matchupText(left), matchupText(right)],
      ["Provider projection", formatPoints(left.projection), formatPoints(right.projection)],
      ["Season average", formatAverage(left.seasonAverage), formatAverage(right.seasonAverage)],
      ["Last 3 games", formatAverage(left.last3Average), formatAverage(right.last3Average)],
      ["Last 5 games", formatAverage(left.last5Average), formatAverage(right.last5Average)],
      ["Injury status", left.injury || "No designation listed", right.injury || "No designation listed"]
    ].forEach(values => {
      const row = document.createElement("tr");
      values.forEach((value, index) => row.appendChild(textElement(index ? "td" : "th", "", value)));
      body.appendChild(row);
    });
    table.append(thead, body);
    elements["fantasy-comparison"].appendChild(table);
  }

  function renderLineup() {
    elements["fantasy-lineup"].replaceChildren();
    const starters = lineupSlots.filter(slot => slot.id !== "BENCH");
    let total = 0;
    let projectedSlots = 0;
    const selectedIds = new Set(Object.values(app.lineup).filter(Boolean).map(String));
    lineupSlots.forEach(slot => {
      const card = textElement("label", "fantasy-lineup-slot");
      card.appendChild(textElement("span", "fantasy-lineup-slot-label", slot.label));
      const select = document.createElement("select");
      select.dataset.lineupSlot = slot.id;
      const currentValue = app.lineup[slot.id] || "";
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Empty";
      select.appendChild(placeholder);
      app.players.filter(player => player.projection !== null &&
        (slot.positions.includes(player.position) || slot.positions.some(position => player.eligiblePositions.includes(position))))
        .sort((left, right) => (left.rank || Infinity) - (right.rank || Infinity))
        .forEach(player => {
          const option = document.createElement("option");
          option.value = player.id;
          option.textContent = `${player.name} · ${player.team}`;
          option.disabled = player.id !== currentValue && selectedIds.has(player.id);
          select.appendChild(option);
        });
      select.value = currentValue;
      select.addEventListener("change", () => {
        app.lineup[slot.id] = select.value;
        saveStoredValue("blitz_fantasy_lineup", app.lineup);
        renderLineup();
        const nextSelect = elements["fantasy-lineup"].querySelector(`[data-lineup-slot="${slot.id}"]`);
        if (nextSelect) nextSelect.focus();
      });
      card.appendChild(select);
      const chosen = app.playersById.get(currentValue);
      card.appendChild(textElement("span", "fantasy-lineup-projection", chosen ? `${formatPoints(chosen.projection)} pts · ${matchupText(chosen)}` : "Projection and matchup appear when selected."));
      if (slot.id !== "BENCH" && chosen && chosen.projection !== null) {
        total += chosen.projection;
        projectedSlots += 1;
      }
      elements["fantasy-lineup"].appendChild(card);
    });
    elements["fantasy-lineup-total"].textContent = projectedSlots
      ? `Projected starters: ${total.toFixed(1)} pts · ${projectedSlots}/${starters.length} filled`
      : "Projected starters: —";
  }

  function renderTrendList(container, isRising) {
    const direction = isRising ? 1 : -1;
    const trending = app.players.filter(player => player.trendDelta !== null && player.trendDelta * direction > 0.5)
      .sort((left, right) => (right.trendDelta - left.trendDelta) * direction)
      .slice(0, 5);
    container.replaceChildren();
    if (!trending.length) {
      setLoading(container, app.errors.weeklyStats
        ? "Recent stats are unavailable from the provider."
        : "Not enough completed player games to establish this trend.");
      return;
    }
    trending.forEach(player => {
      const row = textElement("article", "fantasy-trend-player");
      const identity = textElement("div", "");
      identity.appendChild(playerButton(player, "fantasy-player-link"));
      identity.appendChild(textElement("span", "fantasy-player-subtitle", `${player.position} · ${player.team} · L3 ${formatAverage(player.last3Average)}`));
      row.append(identity, textElement("strong", isRising ? "fantasy-trend-value is-up" : "fantasy-trend-value is-down", `${player.trendDelta > 0 ? "+" : ""}${player.trendDelta.toFixed(1)} PPG`));
      container.appendChild(row);
    });
  }

  function renderTrendBoards() {
    renderTrendList(elements["fantasy-trending-up"], true);
    renderTrendList(elements["fantasy-trending-down"], false);
  }

  function appendDetailStat(container, label, value) {
    const item = textElement("div", "fantasy-detail-stat");
    item.append(textElement("span", "", label), textElement("strong", "", value));
    container.appendChild(item);
  }

  function openPlayerDetails(player) {
    elements["fantasy-dialog-name"].textContent = player.name;
    elements["fantasy-dialog-meta"].textContent = `${player.position} · ${player.team}${player.injury ? ` · ${player.injury}` : ""}`;
    elements["fantasy-dialog-content"].replaceChildren();
    const overview = textElement("div", "fantasy-detail-overview");
    const stats = textElement("div", "fantasy-detail-stats");
    appendDetailStat(stats, "Provider projection", formatPoints(player.projection));
    appendDetailStat(stats, "Projection rank", player.rank ? `#${player.rank} overall · ${player.position} #${player.positionRank}` : "Unavailable");
    appendDetailStat(stats, "Season average", formatAverage(player.seasonAverage));
    appendDetailStat(stats, "Last 3 completed games", formatAverage(player.last3Average));
    appendDetailStat(stats, "Last 5 completed games", formatAverage(player.last5Average));
    appendDetailStat(stats, "Opponent / kickoff", matchupText(player));
    appendDetailStat(stats, "Production trend", trendLabel(player));
    appendDetailStat(stats, "Projection floor / ceiling", "Not supplied");
    appendDetailStat(stats, "Opponent rank vs position", "Not supplied");
    overview.appendChild(stats);
    elements["fantasy-dialog-content"].appendChild(overview);

    const recent = textElement("section", "fantasy-detail-recent");
    recent.appendChild(textElement("h3", "", "Recent fantasy points"));
    const values = player.last5Games.map(game => `Week ${game.week}: ${game.points.toFixed(1)}`);
    recent.appendChild(textElement("p", "", values.length ? values.join(" · ") : "No completed player games available for this view."));
    elements["fantasy-dialog-content"].appendChild(recent);

    if (player.previousWeekStats) {
      const usageRows = [
        ["Targets", player.previousWeekStats.rec_tgt],
        ["Carries", player.previousWeekStats.rush_att],
        ["Receptions", player.previousWeekStats.rec],
        ["Receiving yards", player.previousWeekStats.rec_yd],
        ["Rushing yards", player.previousWeekStats.rush_yd],
        ["Passing yards", player.previousWeekStats.pass_yd],
        ["Passing touchdowns", player.previousWeekStats.pass_td],
        ["Interceptions", player.previousWeekStats.pass_int],
        ["Sacks", player.previousWeekStats.sack]
      ].filter(([, value]) => finiteNumber(value) !== null);
      if (usageRows.length) {
        const usage = textElement("section", "fantasy-detail-recent");
        usage.appendChild(textElement("h3", "", `Available stats · Week ${player.previousWeekNumber}`));
        const list = document.createElement("dl");
        list.className = "fantasy-usage-list";
        usageRows.forEach(([label, value]) => {
          list.append(textElement("dt", "", label), textElement("dd", "", String(value)));
        });
        usage.appendChild(list);
        elements["fantasy-dialog-content"].appendChild(usage);
      }
    }

    const actions = textElement("div", "fantasy-dialog-actions");
    const watch = textElement("button", "fantasy-button", app.watched.has(player.id) ? "Remove saved player" : "Save player");
    watch.type = "button";
    watch.addEventListener("click", () => {
      if (app.watched.has(player.id)) app.watched.delete(player.id);
      else app.watched.add(player.id);
      saveStoredValue("blitz_fantasy_watchlist", [...app.watched]);
      renderWatchlist();
      watch.textContent = app.watched.has(player.id) ? "Remove saved player" : "Save player";
    });
    const bench = textElement("button", "fantasy-button fantasy-button-secondary", "Add to bench");
    bench.type = "button";
    bench.addEventListener("click", () => {
      app.lineup.BENCH = player.id;
      saveStoredValue("blitz_fantasy_lineup", app.lineup);
      renderLineup();
      elements["fantasy-player-dialog"].close();
    });
    actions.append(watch, bench);
    elements["fantasy-dialog-content"].appendChild(actions);
    elements["fantasy-player-dialog"].showModal();
  }

  function renderWatchlist() {
    const note = document.getElementById("fantasy-data-attribution");
    const validWatched = [...app.watched].filter(id => app.playersById.has(id));
    const existing = document.getElementById("fantasy-saved-section");
    if (!validWatched.length) {
      if (existing) existing.remove();
      return;
    }
    const section = document.createElement("section");
    section.id = "fantasy-saved-section";
    section.className = "fantasy-section fantasy-saved-section";
    section.setAttribute("aria-labelledby", "fantasy-saved-title");
    const heading = textElement("div", "fantasy-section-heading");
    const title = document.createElement("div");
    title.append(textElement("p", "fantasy-eyebrow", "YOUR PLAYER SHORTLIST"), textElement("h2", "", "Saved players"));
    heading.appendChild(title);
    const row = textElement("div", "fantasy-saved-player-grid");
    section.addEventListener("click", event => {
      const button = event.target.closest("button[data-player-id]");
      if (!button) return;
      const player = app.playersById.get(button.dataset.playerId);
      if (player) openPlayerDetails(player);
    });
    validWatched.forEach(id => {
      const player = app.playersById.get(id);
      const button = playerButton(player, "fantasy-saved-player");
      button.appendChild(textElement("span", "", `${player.position} · ${player.team} · ${formatPoints(player.projection)} pts`));
      row.appendChild(button);
    });
    section.append(heading, row);
    if (existing) existing.replaceWith(section);
    else note.parentElement.before(section);
  }

  function renderAll() {
    app.players = buildPlayerRows();
    renderSummary();
    renderRankings();
    renderMatchups();
    renderComparisonSelects();
    renderComparison();
    renderTrendBoards();
    renderLineup();
    renderWatchlist();
    const messages = [];
    if (app.errors.schedule) messages.push("ESPN schedule details are unavailable.");
    if (app.errors.seasonStats) messages.push("Season averages are unavailable from Sleeper.");
    if (app.errors.weeklyStats) messages.push("Recent game averages and production trends are unavailable from Sleeper.");
    setNotice(messages.join(" "), messages.length > 0);
  }

  function populateWeekSelector() {
    const selected = app.selectedWeek;
    const options = [];
    for (let week = 1; week <= 18; week += 1) {
      const option = document.createElement("option");
      option.value = String(week);
      option.textContent = `Week ${week}${week === app.currentWeek ? " · Current" : ""}`;
      options.push(option);
    }
    elements["fantasy-week"].replaceChildren(...options);
    elements["fantasy-week"].value = String(selected);
  }

  async function loadWeek(week, force) {
    const version = ++app.loadVersion;
    app.selectedWeek = Number(week);
    app.projections = {};
    app.errors.weeklyStats = false;
    app.errors.seasonStats = false;
    app.errors.schedule = false;
    populateWeekSelector();
    setLoading(elements["fantasy-projection-cards"], "Loading provider projections…");
    setLoading(elements["fantasy-rankings"], "Updating weekly rankings…");
    setLoading(elements["fantasy-matchups"], "Loading NFL schedule…");
    elements["fantasy-result-count"].textContent = "";
    try {
      const schedulePromise = FantasyData.getSeasonSchedule(app.season, app.selectedWeek, force);
      const seasonPromise = FantasyData.getSeasonStats(app.season, force);
      const completedThrough = Math.min(app.selectedWeek - 1, app.currentWeek - 1);
      const firstRecentWeek = Math.max(1, completedThrough - 5);
      const weekNumbers = [];
      for (let recentWeek = firstRecentWeek; recentWeek <= completedThrough; recentWeek += 1) weekNumbers.push(recentWeek);
      const weeklyPromises = weekNumbers.map(recentWeek => FantasyData.getWeeklyStats(app.season, recentWeek, force));
      const [projections, scheduleResult, seasonResult, weeklyResults] = await Promise.all([
        FantasyData.getWeeklyProjections(app.season, app.selectedWeek, force),
        schedulePromise.then(value => ({ value })).catch(error => ({ error })),
        seasonPromise.then(value => ({ value })).catch(error => ({ error })),
        Promise.all(weeklyPromises.map(promise => promise.then(value => ({ value })).catch(error => ({ error }))))
      ]);
      if (version !== app.loadVersion) return;
      if (!projections || typeof projections !== "object" || Array.isArray(projections)) {
        throw new Error("The projection feed returned invalid data");
      }
      app.projections = projections;
      app.errors.schedule = Boolean(scheduleResult.error);
      app.errors.seasonStats = Boolean(seasonResult.error);
      app.errors.weeklyStats = weeklyResults.some(result => result.error);
      if (scheduleResult.error) {
        console.error("Unable to load the ESPN fantasy schedule:", scheduleResult.error);
        app.scheduleByTeam = new Map();
        app.scheduleEvents = [];
      } else {
        const schedule = makeScheduleLookup(scheduleResult.value, app.selectedWeek);
        app.scheduleByTeam = schedule.byTeam;
        app.scheduleEvents = schedule.events;
      }
      app.seasonStats = seasonResult.error ? {} : seasonResult.value;
      if (seasonResult.error) console.error("Unable to load Sleeper season stats:", seasonResult.error);
      app.weeklyStats = new Map();
      weeklyResults.forEach((result, index) => {
        if (result.error) console.error(`Unable to load Sleeper weekly stats for Week ${weekNumbers[index]}:`, result.error);
        else app.weeklyStats.set(String(weekNumbers[index]), result.value);
      });
      app.fetchedAt = new Date();
      elements["fantasy-error"].hidden = true;
      app.pageLimit = pageSize;
      renderAll();
    } catch (error) {
      if (version !== app.loadVersion) return;
      console.error("Unable to load fantasy week data:", error);
      elements["fantasy-error-message"].textContent = error.message || "Check your connection and try again.";
      elements["fantasy-error"].hidden = false;
      app.projections = {};
      app.players = buildPlayerRows();
      renderSummary();
      renderRankings();
    }
  }

  async function initialize(force) {
    elements["fantasy-error"].hidden = true;
    elements["fantasy-notice"].hidden = true;
    elements["fantasy-refresh"].disabled = true;
    setLoading(elements["fantasy-projection-cards"], "Loading provider projections…");
    setLoading(elements["fantasy-rankings"], "Loading player directory…");
    try {
      const [seasonState, players] = await Promise.all([
        FantasyData.getSeasonState(force),
        FantasyData.getPlayerDirectory(force)
      ]);
      const season = finiteNumber(seasonState.season);
      const week = finiteNumber(seasonState.week);
      if (!season || !week || !Array.isArray(players) || !players.length) {
        throw new Error("The fantasy provider returned incomplete season or player information.");
      }
      app.season = season;
      app.currentWeek = Math.max(1, Math.min(18, week));
      app.directory = players.filter(player => player.active !== false && getPlayerPosition(player));
      app.selectedWeek = app.selectedWeek || app.currentWeek;
      populateWeekSelector();
      await loadWeek(app.selectedWeek, force);
    } catch (error) {
      console.error("Unable to initialize the Fantasy page:", error);
      elements["fantasy-error-message"].textContent = error.message || "Check your connection and try again.";
      elements["fantasy-error"].hidden = false;
    } finally {
      elements["fantasy-refresh"].disabled = false;
    }
  }

  function updateLineupWeek() {
    app.lineup = readStoredObject("blitz_fantasy_lineup");
    renderLineup();
  }

  elements["fantasy-position-filters"].addEventListener("click", event => {
    const button = event.target.closest("button[data-position]");
    if (!button) return;
    app.position = button.dataset.position;
    elements["fantasy-position-filters"].querySelectorAll("button").forEach(item => {
      const active = item === button;
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-pressed", String(active));
    });
    app.pageLimit = pageSize;
    renderRankings();
  });

  elements["fantasy-week"].addEventListener("change", () => loadWeek(Number(elements["fantasy-week"].value), false));
  elements["fantasy-prev-week"].addEventListener("click", () => {
    if (app.selectedWeek > 1) loadWeek(app.selectedWeek - 1, false);
  });
  elements["fantasy-next-week"].addEventListener("click", () => {
    if (app.selectedWeek < 18) loadWeek(app.selectedWeek + 1, false);
  });
  elements["fantasy-scoring"].addEventListener("change", () => {
    app.scoring = elements["fantasy-scoring"].value;
    try {
      localStorage.setItem("blitz_fantasy_scoring", app.scoring);
    } catch (error) {
      console.error("Could not save fantasy scoring preference:", error);
    }
    renderAll();
  });
  elements["fantasy-search"].addEventListener("input", () => {
    app.search = elements["fantasy-search"].value;
    app.pageLimit = pageSize;
    renderRankings();
  });
  elements["fantasy-sort"].addEventListener("change", () => {
    app.sort = elements["fantasy-sort"].value;
    app.pageLimit = pageSize;
    renderRankings();
  });
  elements["fantasy-refresh"].addEventListener("click", async () => {
    FantasyData.clearCache();
    await initialize(true);
  });
  elements["fantasy-retry"].addEventListener("click", () => initialize(true));
  elements["fantasy-compare-a"].addEventListener("change", renderComparison);
  elements["fantasy-compare-b"].addEventListener("change", renderComparison);
  elements["fantasy-rankings"].addEventListener("click", event => {
    const button = event.target.closest("button[data-player-id]");
    if (!button) return;
    const player = app.playersById.get(button.dataset.playerId);
    if (player) openPlayerDetails(player);
  });
  elements["fantasy-projection-cards"].addEventListener("click", event => {
    const button = event.target.closest("button[data-player-id]");
    if (!button) return;
    const player = app.playersById.get(button.dataset.playerId);
    if (player) openPlayerDetails(player);
  });
  [elements["fantasy-trending-up"], elements["fantasy-trending-down"]].forEach(container => {
    container.addEventListener("click", event => {
      const button = event.target.closest("button[data-player-id]");
      if (!button) return;
      const player = app.playersById.get(button.dataset.playerId);
      if (player) openPlayerDetails(player);
    });
  });
  elements["fantasy-dialog-content"].addEventListener("click", event => {
    const button = event.target.closest("button[data-player-id]");
    if (!button) return;
    const player = app.playersById.get(button.dataset.playerId);
    if (player) openPlayerDetails(player);
  });
  elements["fantasy-dialog-close"].addEventListener("click", () => elements["fantasy-player-dialog"].close());
  elements["fantasy-player-dialog"].addEventListener("click", event => {
    if (event.target === elements["fantasy-player-dialog"]) elements["fantasy-player-dialog"].close();
  });
  elements["fantasy-scoring"].addEventListener("change", updateLineupWeek);
  window.addEventListener("resize", () => {
    window.clearTimeout(window.fantasyResizeTimer);
    window.fantasyResizeTimer = window.setTimeout(renderRankings, 120);
  });

  function initializeNavigationAndTheme() {
    window.toggleMenu = function () {
      const menu = document.getElementById("side-menu");
      const button = document.querySelector(".menu-btn");
      const open = menu.style.width === "280px";
      menu.style.width = open ? "0" : "280px";
      if (button) button.setAttribute("aria-expanded", String(!open));
    };
    window.toggleTheme = function () {
      const next = document.documentElement.classList.contains("dark-mode") ? "light-mode" : "dark-mode";
      localStorage.setItem("theme", next);
      localStorage.setItem("user_settings.theme", JSON.stringify(next));
      document.documentElement.classList.toggle("dark-mode", next === "dark-mode");
      document.documentElement.classList.toggle("light-mode", next !== "dark-mode");
      document.getElementById("themeToggle").textContent = next === "dark-mode" ? "Light" : "Dark";
    };
    const loggedIn = localStorage.getItem("currentUser") || sessionStorage.getItem("currentUser");
    if (loggedIn) {
      const loginButton = document.getElementById("nav-login-btn");
      const sideLink = document.getElementById("side-login-link");
      loginButton.textContent = "ACCOUNT";
      loginButton.href = "Account.html";
      sideLink.textContent = "Account";
      sideLink.href = "Account.html";
    }
    try {
      const scoring = localStorage.getItem("blitz_fantasy_scoring");
      if (["ppr", "half_ppr", "std"].includes(scoring)) {
        app.scoring = scoring;
        elements["fantasy-scoring"].value = scoring;
      }
    } catch (error) {
      console.error("Could not read fantasy scoring preference:", error);
    }
    document.documentElement.classList.toggle("light-mode", !document.documentElement.classList.contains("dark-mode"));
    const themeToggle = document.getElementById("themeToggle");
    if (themeToggle) themeToggle.textContent = document.documentElement.classList.contains("dark-mode") ? "Light" : "Dark";
  }

  initializeNavigationAndTheme();
  initialize(false);
})();
