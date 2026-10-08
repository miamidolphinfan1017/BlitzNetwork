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
        const gamesError = !games.length
          ? (gameFeedFailures === 2 ? "Completed-game data is unavailable right now." : "No completed regular-season games are available yet.")
          : (gameFeedFailures ? "Some completed-game results are unavailable; the remaining NFL games are still playable." : "");
        return {
          season,
          players,
          teams,
          games,
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
