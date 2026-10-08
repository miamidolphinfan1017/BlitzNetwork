(function () {
  "use strict";

  const sleeperBase = "https://api.sleeper.app/v1";
  const espnBase = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
  const playerPositions = ["QB", "RB", "WR", "TE", "K", "DEF"];
  let playerDirectoryPromise = null;
  let statePromise = null;
  const projectionsCache = new Map();
  const statsCache = new Map();
  const seasonStatsCache = new Map();
  const scheduleCache = new Map();

  async function fetchJson(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Data request failed (${response.status})`);
    return response.json();
  }

  function cacheRequest(cache, key, request) {
    if (!cache.has(key)) {
      const promise = request().catch(error => {
        cache.delete(key);
        throw error;
      });
      cache.set(key, promise);
    }
    return cache.get(key);
  }

  function getSeasonState(force) {
    if (force) statePromise = null;
    if (!statePromise) {
      statePromise = fetchJson(`${sleeperBase}/state/nfl`).catch(error => {
        statePromise = null;
        throw error;
      });
    }
    return statePromise;
  }

  function getPlayerDirectory(force) {
    if (force) playerDirectoryPromise = null;
    if (!playerDirectoryPromise) {
      playerDirectoryPromise = Promise.all(playerPositions.map(async position => {
        const payload = await fetchJson(`${sleeperBase}/players/nfl?position=${position}`);
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
          throw new Error(`The player directory returned invalid ${position} data`);
        }
        return payload;
      })).then(groups => {
        const players = new Map();
        groups.forEach(group => {
          Object.entries(group).forEach(([id, player]) => {
            if (!player || typeof player !== "object") return;
            const name = player.full_name || (player.position === "DEF" && player.team ? `${player.team} D/ST` : "");
            if (!name) return;
            const eligiblePositions = Array.isArray(player.fantasy_positions) ? player.fantasy_positions : [];
            const primaryPosition = player.position === "DEF" ? "DST" : player.position;
            const supported = eligiblePositions.some(position => playerPositions.includes(position)) ||
              playerPositions.includes(primaryPosition === "DST" ? "DEF" : primaryPosition);
            if (!supported) return;
            players.set(String(player.player_id || id), Object.assign({}, player, {
              player_id: String(player.player_id || id),
              full_name: name
            }));
          });
        });
        if (!players.size) throw new Error("The player directory did not contain usable NFL players");
        return [...players.values()];
      }).catch(error => {
        playerDirectoryPromise = null;
        throw error;
      });
    }
    return playerDirectoryPromise;
  }

  function getWeeklyProjections(season, week, force) {
    const key = `${season}:${week}`;
    if (force) projectionsCache.delete(key);
    return cacheRequest(projectionsCache, key, () =>
      fetchJson(`${sleeperBase}/projections/nfl/regular/${season}/${week}`)
    );
  }

  function getWeeklyStats(season, week, force) {
    const key = `${season}:${week}`;
    if (force) statsCache.delete(key);
    return cacheRequest(statsCache, key, () =>
      fetchJson(`${sleeperBase}/stats/nfl/regular/${season}/${week}`)
    );
  }

  function getSeasonStats(season, force) {
    const key = String(season);
    if (force) seasonStatsCache.delete(key);
    return cacheRequest(seasonStatsCache, key, () =>
      fetchJson(`${sleeperBase}/stats/nfl/regular/${season}`)
    );
  }

  function getSeasonSchedule(season, week, force) {
    const key = `${season}:${week}`;
    if (force) scheduleCache.delete(key);
    return cacheRequest(scheduleCache, key, () =>
      fetchJson(`${espnBase}/scoreboard?limit=1000&week=${week}&seasontype=2&year=${season}`)
    );
  }

  function clearCache() {
    playerDirectoryPromise = null;
    statePromise = null;
    projectionsCache.clear();
    statsCache.clear();
    seasonStatsCache.clear();
    scheduleCache.clear();
  }

  window.FantasyData = Object.freeze({
    getSeasonState,
    getPlayerDirectory,
    getWeeklyProjections,
    getWeeklyStats,
    getSeasonStats,
    getSeasonSchedule,
    clearCache
  });
})();
