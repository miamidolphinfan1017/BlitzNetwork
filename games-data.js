(function () {
  "use strict";

  const espnBase = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
  const statDefinitions = [
    { key: "pass_yd", label: "passing yards", positions: ["QB"] },
    { key: "pass_td", label: "passing touchdowns", positions: ["QB"] },
    { key: "rush_yd", label: "rushing yards", positions: ["QB", "RB"] },
    { key: "rush_td", label: "rushing touchdowns", positions: ["QB", "RB"] },
    { key: "rec_yd", label: "receiving yards", positions: ["RB", "WR", "TE"] },
    { key: "rec", label: "receptions", positions: ["RB", "WR", "TE"] },
    { key: "rec_td", label: "receiving touchdowns", positions: ["RB", "WR", "TE"] },
    { key: "pts_ppr", label: "PPR fantasy points", positions: ["QB", "RB", "WR", "TE", "K"] }
  ];
  const gameStatDefinitions = [
    { key: "pass_yd", label: "passing yards", group: "passing", field: "YDS" },
    { key: "pass_td", label: "passing touchdowns", group: "passing", field: "TD" },
    { key: "pass_int", label: "interceptions thrown", group: "passing", field: "INT" },
    { key: "rush_yd", label: "rushing yards", group: "rushing", field: "YDS" },
    { key: "rush_td", label: "rushing touchdowns", group: "rushing", field: "TD" },
    { key: "rec", label: "receptions", group: "receiving", field: "REC" },
    { key: "rec_yd", label: "receiving yards", group: "receiving", field: "YDS" },
    { key: "rec_td", label: "receiving touchdowns", group: "receiving", field: "TD" },
    { key: "targets", label: "targets", group: "receiving", field: "TGTS" },
    { key: "tackles", label: "total tackles", group: "defensive", field: "TOT" },
    { key: "sacks", label: "sacks", group: "defensive", field: "SACKS" },
    { key: "fg_made", label: "field goals made", group: "kicking", field: "FG" },
    { key: "kick_points", label: "kicking points", group: "kicking", field: "PTS" }
  ];
  const teamNames = {
    ARI: "Arizona Cardinals", ATL: "Atlanta Falcons", BAL: "Baltimore Ravens", BUF: "Buffalo Bills",
    CAR: "Carolina Panthers", CHI: "Chicago Bears", CIN: "Cincinnati Bengals", CLE: "Cleveland Browns",
    DAL: "Dallas Cowboys", DEN: "Denver Broncos", DET: "Detroit Lions", GB: "Green Bay Packers",
    HOU: "Houston Texans", IND: "Indianapolis Colts", JAX: "Jacksonville Jaguars", KC: "Kansas City Chiefs",
    LV: "Las Vegas Raiders", LAC: "Los Angeles Chargers", LAR: "Los Angeles Rams", MIA: "Miami Dolphins",
    MIN: "Minnesota Vikings", NE: "New England Patriots", NO: "New Orleans Saints", NYG: "New York Giants",
    NYJ: "New York Jets", PHI: "Philadelphia Eagles", PIT: "Pittsburgh Steelers", SF: "San Francisco 49ers",
    SEA: "Seattle Seahawks", TB: "Tampa Bay Buccaneers", TEN: "Tennessee Titans", WAS: "Washington Commanders"
  };
  let dataPromise = null;

  async function fetchJson(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`NFL data request failed (${response.status})`);
    return response.json();
  }

  function getTeams() {
    return Object.entries(teamNames).map(([abbr, name]) => ({ id: abbr, abbr, name }));
  }

  function normalizeGames(payload, season) {
    if (!payload || !Array.isArray(payload.events)) throw new Error("The NFL results feed returned invalid data");
    return payload.events.map(event => {
      if (Number(event.season?.year) !== Number(season)) return null;
      if (event.status?.type?.state !== "post") return null;
      const competition = event.competitions?.[0];
      const competitors = competition?.competitors;
      if (!Array.isArray(competitors) || competitors.length !== 2) return null;
      const normalized = competitors.map(competitor => ({
        abbr: String(competitor.team?.abbreviation || "").toUpperCase(),
        name: String(competitor.team?.displayName || ""),
        score: Number(competitor.score)
      }));
      if (normalized.some(team => !team.abbr || !team.name || !Number.isFinite(team.score))) return null;
      if (normalized[0].score === normalized[1].score) return null;
      const winner = normalized.find(team => team.score > normalized.find(other => other !== team).score);
      const seasonType = Number(event.season?.type?.type ?? event.season?.type);
      if (Number.isFinite(seasonType) && seasonType !== 2) return null;
      return {
        id: String(event.id || event.date),
        date: String(event.date || ""),
        week: Number(event.week?.number) || null,
        home: normalized.find(team => competition.competitors.find(item => item.team?.abbreviation?.toUpperCase() === team.abbr)?.homeAway === "home"),
        away: normalized.find(team => competition.competitors.find(item => item.team?.abbreviation?.toUpperCase() === team.abbr)?.homeAway === "away"),
        winner
      };
    }).filter(game => game && game.home && game.away);
  }

  function numericStat(value) {
    const match = String(value ?? "").match(/^-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
  }

  function normalizePlayerName(value) {
    return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "").replace(/[^a-z0-9]/g, "");
  }

  function parseGamePlayerStats(summary, game, playerDirectory) {
    const boxscoreTeams = summary.boxscore?.players;
    if (!Array.isArray(boxscoreTeams)) return [];
    const positionIndex = new Map();
    playerDirectory.forEach(player => {
      const name = normalizePlayerName(player.full_name || `${player.first_name || ""} ${player.last_name || ""}`);
      if (name && player.team) positionIndex.set(`${String(player.team).toUpperCase()}|${name}`, player.position);
    });
    const players = new Map();
    boxscoreTeams.forEach(teamBox => {
      const teamCode = String(teamBox.team?.abbreviation || "").toUpperCase();
      (teamBox.statistics || []).forEach(group => {
        const groupName = String(group.name || "").toLowerCase();
        const labels = (group.labels || []).map(label => String(label).toUpperCase());
        (group.athletes || []).forEach(entry => {
          const athlete = entry.athlete || {};
          const name = String(athlete.displayName || athlete.fullName || "").trim();
          const stats = Array.isArray(entry.stats) ? entry.stats : [];
          if (!name || !stats.length) return;
          const id = String(athlete.id || `${teamCode}:${name}`);
          if (!players.has(id)) {
            const rosterPosition = positionIndex.get(`${teamCode}|${normalizePlayerName(name)}`);
            players.set(id, {
              id,
              name,
              team: teamCode,
              position: rosterPosition || (groupName === "passing" ? "QB" : groupName === "kicking" ? "K" : ""),
              values: {},
              groups: new Set()
            });
          }
          const player = players.get(id);
          player.groups.add(groupName);
          const valueFor = label => {
            const index = labels.indexOf(label);
            return index >= 0 ? numericStat(stats[index]) : null;
          };
          const setValue = (key, label) => {
            const value = valueFor(label);
            if (value !== null) player.values[key] = value;
          };
          if (groupName === "passing") {
            setValue("pass_yd", "YDS");
            setValue("pass_td", "TD");
            setValue("pass_int", "INT");
          } else if (groupName === "rushing") {
            setValue("rush_yd", "YDS");
            setValue("rush_td", "TD");
          } else if (groupName === "receiving") {
            setValue("rec", "REC");
            setValue("rec_yd", "YDS");
            setValue("rec_td", "TD");
            setValue("targets", "TGTS");
          } else if (groupName === "fumbles") {
            setValue("fumbles_lost", "LOST");
          } else if (groupName === "defensive") {
            setValue("tackles", "TOT");
            setValue("sacks", "SACKS");
          } else if (groupName === "kicking") {
            const fgIndex = labels.indexOf("FG");
            const fg = fgIndex >= 0 ? String(stats[fgIndex]).split("/")[0] : "";
            const made = numericStat(fg);
            if (made !== null) player.values.fg_made = made;
            setValue("kick_points", "PTS");
          }
        });
      });
    });
    const comparisons = [];
    players.forEach(player => {
      const values = player.values;
      if (player.groups.has("passing") || player.groups.has("rushing") || player.groups.has("receiving")) {
        const ppr = (values.pass_yd || 0) * 0.04 + (values.pass_td || 0) * 4 - (values.pass_int || 0) * 2 +
          (values.rush_yd || 0) * 0.1 + (values.rush_td || 0) * 6 +
          (values.rec || 0) + (values.rec_yd || 0) * 0.1 + (values.rec_td || 0) * 6 -
          (values.fumbles_lost || 0) * 2;
        comparisons.push({
          gameId: game.id, gameLabel: `${game.away.name} at ${game.home.name}`,
          gameDate: game.date, playerId: player.id, name: player.name, team: player.team,
          position: player.position, statKey: "pts_ppr", statLabel: "PPR fantasy points",
          value: Math.round(ppr * 10) / 10
        });
      }
      gameStatDefinitions.forEach(definition => {
        if (!player.groups.has(definition.group)) return;
        let value = values[definition.key];
        if (definition.key === "fg_made") value = values.fg_made;
        if (Number.isFinite(value)) comparisons.push({
          gameId: game.id, gameLabel: `${game.away.name} at ${game.home.name}`,
          gameDate: game.date, playerId: player.id, name: player.name, team: player.team,
          position: player.position, statKey: definition.key, statLabel: definition.label, value
        });
      });
    });
    return comparisons;
  }

  async function loadRecentGameStats(games, players) {
    const recent = games.slice().sort((left, right) => new Date(right.date) - new Date(left.date)).slice(0, 4);
    const results = await Promise.allSettled(recent.map(async game => {
      const cacheKey = `blitz_games_boxscore_v2:${game.id}`;
      try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed)) return parsed;
          console.error(`Saved player statistics for game ${game.id} are invalid; refreshing them.`);
          localStorage.removeItem(cacheKey);
        }
      } catch (error) {
        console.error(`Unable to read cached player statistics for game ${game.id}:`, error);
      }
      const summary = await fetchJson(`${espnBase}/summary?event=${encodeURIComponent(game.id)}`);
      const stats = parseGamePlayerStats(summary, game, players);
      if (stats.length) {
        try {
          localStorage.setItem(cacheKey, JSON.stringify(stats));
        } catch (error) {
          console.error(`Unable to cache player statistics for game ${game.id}:`, error);
        }
      }
      return stats;
    }));
    const comparisons = [];
    results.forEach(result => {
      if (result.status === "fulfilled") comparisons.push(...result.value);
      else console.error("Unable to load player statistics for an ESPN game recap:", result.reason);
    });
    return comparisons;
  }

  function activePlayers(players, seasonStats, teams) {
    const teamCodes = new Set(teams.map(team => team.abbr));
    return players.map(player => {
      const position = player.position === "DEF" ? "DST" : String(player.position || "").toUpperCase();
      const stats = seasonStats[player.player_id] || seasonStats[String(player.player_id)] || {};
      const team = String(player.team || "").toUpperCase();
      return Object.assign({}, player, {
        position,
        team,
        stats,
        current: player.active === true && teamCodes.has(team) &&
          ["QB", "RB", "WR", "TE", "K"].includes(position) &&
          Object.keys(stats).length > 0
      });
    }).filter(player => player.current);
  }

  async function load(force) {
    if (force) dataPromise = null;
    if (!dataPromise) {
      dataPromise = (async () => {
        if (!window.FantasyData) throw new Error("The NFL player data service is unavailable");
        const state = await window.FantasyData.getSeasonState(Boolean(force));
        const season = Number(state?.season);
        if (!Number.isInteger(season)) throw new Error("The NFL data service did not provide a valid season");
        const results = await Promise.allSettled([
          window.FantasyData.getPlayerDirectory(Boolean(force)),
          window.FantasyData.getSeasonStats(season, Boolean(force)),
          fetchJson(`${espnBase}/scoreboard?limit=1000&dates=${season}`),
          fetchJson(`${espnBase}/scoreboard?limit=1000&dates=${season + 1}`)
        ]);
        const [playersResult, statsResult, currentGamesResult, nextYearGamesResult] = results;
        if (playersResult.status !== "fulfilled") throw playersResult.reason;
        if (statsResult.status !== "fulfilled") throw statsResult.reason;
        const teams = getTeams();
        const players = activePlayers(playersResult.value, statsResult.value, teams);
        if (players.length < 20) throw new Error("The NFL player and season-stat feeds did not return enough usable data");
        const normalizedGameFeeds = [];
        let gameFeedFailures = 0;
        [currentGamesResult, nextYearGamesResult].forEach(result => {
          if (result.status !== "fulfilled") {
            gameFeedFailures += 1;
            return;
          }
          try {
            normalizedGameFeeds.push(normalizeGames(result.value, season));
          } catch {
            gameFeedFailures += 1;
          }
        });
        const games = normalizedGameFeeds.flat();
        const gamePlayerStats = games.length ? await loadRecentGameStats(games, players) : [];
        const gamePlayerStatsError = games.length && !gamePlayerStats.length
          ? "ESPN player game statistics are unavailable right now; player-comparison challenges may be unavailable."
          : "";
        const gamesError = !games.length
          ? (gameFeedFailures === 2 ? "Completed-game data is unavailable right now." : "No completed regular-season games are available yet.")
          : (gameFeedFailures ? "Some completed-game results are unavailable; the remaining NFL games are still playable." : "");
        return {
          season,
          players,
          teams,
          games,
          gamePlayerStats,
          gamePlayerStatsError,
          gamesError,
          statDefinitions
        };
      })().catch(error => {
        dataPromise = null;
        throw error;
      });
    }
    return dataPromise;
  }

  function usableStats(player, position) {
    return statDefinitions.filter(definition =>
      definition.positions.includes(position || player.position) &&
      Number.isFinite(Number(player.stats[definition.key])) &&
      Number(player.stats[definition.key]) > 0
    );
  }

  window.GamesData = Object.freeze({ load, usableStats, statDefinitions });
})();
