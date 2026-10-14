(function () {
  "use strict";

  const pointsByDifficulty = { easy: 100, medium: 150, hard: 200, expert: 250 };
  const difficultyNames = { easy: "Easy", medium: "Medium", hard: "Hard", expert: "Expert" };
  const positionNames = { QB: "quarterback", RB: "running back", WR: "wide receiver", TE: "tight end" };
  const modes = {
    team: { title: "Roster Check", category: "Teams", promptType: "choice" },
    player: { title: "Who’s That Player?", category: "Players", promptType: "choice" },
    battle: { title: "Stat Showdown", category: "Stats", promptType: "choice" },
    higher: { title: "Higher or Lower", category: "Stats", promptType: "choice" },
    estimate: { title: "Guess the Stat", category: "Stats", promptType: "number" },
    recap: { title: "Game Day Recap", category: "Teams", promptType: "choice" },
    speed: { title: "60-Second Blitz", category: "Speed", promptType: "choice" },
    daily: { title: "The Daily Drive", category: "Daily", promptType: "choice" }
  };

  function shuffle(items, random) {
    const copy = items.slice();
    for (let index = copy.length - 1; index > 0; index--) {
      const other = Math.floor(random() * (index + 1));
      [copy[index], copy[other]] = [copy[other], copy[index]];
    }
    return copy;
  }

  function choose(items, random) {
    return items[Math.floor(random() * items.length)];
  }

  function sampleOptions(answer, pool, count, random, getLabel) {
    const answerKey = getLabel(answer);
    const distinct = new Map();
    pool.forEach(item => {
      const label = getLabel(item);
      if (label && label !== answerKey && !distinct.has(label)) distinct.set(label, item);
    });
    if (!answerKey || distinct.size < count - 1) return null;
    return shuffle([answer, ...shuffle([...distinct.values()], random).slice(0, count - 1)], random)
      .map(item => ({ label: getLabel(item), value: getLabel(item) }));
  }

  function createQuestion(mode, data, difficulty, random, position) {
    if (mode === "team") return rosterQuestion(data, random, position);
    if (mode === "player") return playerQuestion(data, random, difficulty, position);
    if (mode === "battle") return battleQuestion(data, random, position);
    if (mode === "higher") return higherQuestion(data, random, position);
    if (mode === "estimate") return estimateQuestion(data, random, position);
    if (mode === "recap") return recapQuestion(data, random);
    return null;
  }

  function rosterQuestion(data, random, position) {
    const pool = data.players.filter(player => !position || position === "ALL" || player.position === position);
    const rosterTeams = data.teams.filter(team => pool.some(player => player.team === team.abbr));
    if (rosterTeams.length < 4) return null;
    const team = choose(rosterTeams, random);
    const player = choose(pool.filter(item => item.team === team.abbr), random);
    const options = sampleOptions(player, pool.filter(item => item.position === player.position), 4, random, item => item.full_name);
    if (!options || !options.some(option => option.value === player.full_name)) return null;
    return {
      key: `team:${team.abbr}:${player.player_id}`,
      type: "choice",
      prompt: `Which ${positionNames[player.position] || player.position} is currently listed with the ${team.name}?`,
      clues: [{ label: "TEAM", value: team.name }, { label: "POSITION", value: player.position }],
      choices: options,
      correct: player.full_name,
      explanation: `${player.full_name} is listed with the ${team.name} in the current player directory.`
    };
  }

  function playerQuestion(data, random, difficulty, position) {
    const pool = data.players.filter(player =>
      (!position || position === "ALL" || player.position === position) &&
      player.full_name && player.position && player.team
    );
    if (pool.length < 4) return null;
    const player = choose(pool, random);
    const clueOptions = [
      ["team", "TEAM", player.team],
      ["position", "POSITION", player.position],
      ["college", "COLLEGE", player.college],
      ["number", "JERSEY", player.number],
      ["age", "AGE", player.age]
    ].filter(([, , value]) => value !== undefined && value !== null && String(value).trim() !== "");
    const clueCount = { easy: 4, medium: 3, hard: 2, expert: 1 }[difficulty] || 3;
    const clues = clueOptions.slice(0, clueCount).map(([, label, value]) => ({ label, value: String(value) }));
    const options = sampleOptions(player, pool.filter(item => item.position === player.position), difficulty === "hard" ? 3 : 4, random, item => item.full_name);
    if (!options || !clues.length || !options.some(option => option.value === player.full_name)) return null;
    return {
      key: `player:${player.player_id}:${clues.map(clue => clue.label).join("-")}`,
      type: "choice",
      prompt: "Identify the active NFL player from the verified roster clues.",
      clues,
      choices: options,
      correct: player.full_name,
      explanation: `${player.full_name} is listed as a ${player.position} for ${player.team}.`
    };
  }

  function battleQuestion(data, random, position) {
    const groups = groupGameComparisons(data.gamePlayerStats, position);
    const usable = [...groups.values()].filter(items =>
      items.length > 1 && items.some(item => items.some(other => other.playerId !== item.playerId && other.value !== item.value))
    );
    if (!usable.length) return null;
    const group = choose(usable, random);
    const first = choose(group, random);
    const candidates = group.filter(item => item.playerId !== first.playerId && item.value !== first.value);
    if (!candidates.length) return null;
    const second = choose(candidates, random);
    const winner = first.value > second.value ? first : second;
    return {
      key: `battle:${first.gameId}:${first.statKey}:${[first.playerId, second.playerId].sort().join(":")}`,
      type: "choice",
      prompt: `Who recorded more ${first.statLabel} in this completed game?`,
      clues: [{ label: "MATCHUP", value: first.gameLabel }, { label: "GAME DATE", value: formatGameDate(first.gameDate) }],
      comparison: [first, second].map(item => comparisonCard(item)),
      choices: shuffle([first, second], random).map(item => ({ label: item.name, value: item.playerId })),
      correct: winner.playerId,
      explanation: `${first.name} recorded ${formatComparisonValue(first)} ${formatComparisonLabel(first)}; ${second.name} recorded ${formatComparisonValue(second)} ${formatComparisonLabel(second)}. ${winner.name} had more.`
    };
  }

  function higherQuestion(data, random, position) {
    const groups = groupGameComparisons(data.gamePlayerStats, position, "pts_ppr");
    const usable = [...groups.values()].filter(items =>
      items.length > 1 && items.some(item => items.some(other => other.playerId !== item.playerId && other.value !== item.value))
    );
    if (!usable.length) return null;
    const group = choose(usable, random);
    const first = choose(group, random);
    const candidates = group.filter(item => item.playerId !== first.playerId && item.value !== first.value);
    if (!candidates.length) return null;
    const second = choose(candidates, random);
    const answer = second.value > first.value ? "Higher" : "Lower";
    return {
      key: `higher:${first.gameId}:${first.playerId}:${second.playerId}`,
      type: "choice",
      prompt: `Compared with ${first.name}, did ${second.name} score higher or lower in PPR fantasy points in this game?`,
      clues: [
        { label: "MATCHUP", value: first.gameLabel },
        { label: "GAME DATE", value: formatGameDate(first.gameDate) },
        { label: "SCORING", value: "PPR · 1 point per reception" }
      ],
      comparison: [first, second].map(item => comparisonCard(item)),
      choices: shuffle(["Higher", "Lower"], random).map(value => ({ label: value, value })),
      correct: answer,
      explanation: `${second.name} scored ${second.value.toFixed(1)} PPR points; ${first.name} scored ${first.value.toFixed(1)}. Calculated from ESPN game stats: 1 point per reception, 0.1 per yard, 4 per passing touchdown, 6 per rushing or receiving touchdown, and -2 per interception or lost fumble.`
    };
  }

  function groupGameComparisons(comparisons, position, statKey) {
    const groups = new Map();
    (comparisons || []).filter(item =>
      (!statKey || item.statKey === statKey) &&
      (!position || position === "ALL" || item.position === position)
    ).forEach(item => {
      const key = `${item.gameId}|${item.statKey}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    });
    return groups;
  }

  function comparisonCard(item) {
    return {
      playerId: item.playerId,
      name: item.name,
      team: item.team,
      position: item.position,
      value: item.value,
      statLabel: item.statLabel,
      displayStatLabel: formatComparisonLabel(item),
      context: item.gameLabel
    };
  }

  function formatComparisonValue(item) {
    return item.statKey === "pts_ppr"
      ? Number(item.value).toFixed(1)
      : Number(item.value).toLocaleString();
  }

  function formatComparisonLabel(item) {
    if (Number(item.value) !== 1) return item.statLabel;
    return ({
      "passing yards": "passing yard",
      "passing touchdowns": "passing touchdown",
      "interceptions thrown": "interception thrown",
      "rushing yards": "rushing yard",
      "rushing touchdowns": "rushing touchdown",
      "receptions": "reception",
      "receiving yards": "receiving yard",
      "receiving touchdowns": "receiving touchdown",
      "targets": "target",
      "total tackles": "total tackle",
      "sacks": "sack",
      "field goals made": "field goal made",
      "kicking points": "kicking point",
      "PPR fantasy points": "PPR fantasy point"
    })[item.statLabel] || item.statLabel;
  }

  function formatGameDate(date) {
    const parsed = new Date(date);
    return Number.isNaN(parsed.getTime())
      ? "Date unavailable"
      : parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }

  function estimateQuestion(data, random, position) {
    const usable = data.players.filter(player => !position || position === "ALL" || player.position === position)
      .flatMap(player => GamesData.usableStats(player).map(stat => ({
        player, stat, value: Number(player.stats[stat.key])
      })));
    if (!usable.length) return null;
    const selected = choose(usable, random);
    return {
      key: `estimate:${selected.player.player_id}:${selected.stat.key}`,
      type: "number",
      prompt: `How many ${selected.stat.label} has ${selected.player.full_name} recorded this regular season?`,
      clues: [{ label: "PLAYER", value: `${selected.player.full_name} · ${selected.player.team}` }, { label: "SEASON", value: String(data.season) }],
      correct: selected.value,
      answerLabel: `${selected.value.toLocaleString()} ${selected.stat.label}`,
      tolerance: selected.stat.key === "pts_ppr"
        ? Math.max(1, selected.value * 0.05)
        : Math.floor(Math.min(20, selected.value * 0.05)),
      explanation: `The provider's ${data.season} regular-season total for ${selected.player.full_name} is ${selected.value.toLocaleString()} ${selected.stat.label}.`
    };
  }

  function recapQuestion(data, random) {
    if (!data.games.length) return null;
    const game = choose(data.games, random);
    const correct = game.winner;
    if (!correct || !game.home || !game.away) return null;
    const date = game.date ? new Date(game.date).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" }) : "";
    return {
      key: `recap:${game.id}`,
      type: "choice",
      prompt: `Which team won this completed ${data.season} regular-season game${date ? ` on ${date}` : ""}?`,
      clues: [
        { label: "MATCHUP", value: `${game.away.name} at ${game.home.name}` },
        { label: "FINAL", value: `${game.away.score} – ${game.home.score}` },
        ...(game.week ? [{ label: "WEEK", value: String(game.week) }] : [])
      ],
      choices: shuffle([game.away, game.home], random).map(team => ({ label: team.name, value: team.abbr })),
      correct: correct.abbr,
      explanation: `${correct.name} won ${game.winner.score}–${(correct.abbr === game.home.abbr ? game.away : game.home).score}.`
    };
  }

  function createDailyQuestions(data, date) {
    let seed = 2166136261;
    for (const character of date) {
      seed ^= character.charCodeAt(0);
      seed = Math.imul(seed, 16777619);
    }
    const random = () => {
      seed += 0x6D2B79F5;
      let value = seed;
      value = Math.imul(value ^ value >>> 15, value | 1);
      value ^= value + Math.imul(value ^ value >>> 7, value | 61);
      return ((value ^ value >>> 14) >>> 0) / 4294967296;
    };
    const dailyModes = ["team", "player", "battle", "higher", "estimate"];
    if (data.games.length) dailyModes.push("recap");
    const questions = [];
    const used = new Set();
    for (const mode of shuffle(dailyModes, random)) {
      for (let attempt = 0; attempt < 40; attempt++) {
        const question = createQuestion(mode, data, "medium", random, "ALL");
        if (question && isValidQuestion(question) && !used.has(question.key)) {
          questions.push(question);
          used.add(question.key);
          break;
        }
      }
      if (questions.length === 5) break;
    }
    if (questions.length !== 5) throw new Error("A complete daily challenge could not be prepared from the available NFL data");
    return questions;
  }

  function makeRandom(seed) {
    let state = (Number(seed) || Math.floor(Math.random() * 0xffffffff)) >>> 0;
    return () => {
      state += 0x6D2B79F5;
      let value = state;
      value = Math.imul(value ^ value >>> 15, value | 1);
      value ^= value + Math.imul(value ^ value >>> 7, value | 61);
      return ((value ^ value >>> 14) >>> 0) / 4294967296;
    };
  }

  function createSession(mode, data, options, fixedQuestions) {
    const speed = mode === "speed";
    const daily = mode === "daily";
    const count = daily ? 5 : (speed ? Infinity : Number(options.count) || 5);
    return {
      mode,
      data,
      difficulty: options.difficulty || "medium",
      position: options.position || "ALL",
      count,
      seconds: speed ? Number(options.seconds) || 60 : 0,
      random: makeRandom(Date.now() ^ Math.floor(Math.random() * 0xffffffff)),
      questions: fixedQuestions ? fixedQuestions.slice() : [],
      used: new Set(),
      index: 0,
      score: 0,
      correct: 0,
      answered: 0,
      streak: 0,
      bestStreak: 0,
      startedAt: Date.now(),
      lastAnswer: null
    };
  }

  function nextQuestion(session) {
    if (session.mode === "daily") {
      const question = session.questions[session.index];
      return isValidQuestion(question) ? question : null;
    }
    const sourceModes = session.mode === "speed"
      ? ["team", "player", "battle", "higher", "recap"]
      : [session.mode];
    for (let attempt = 0; attempt < 80; attempt++) {
      const mode = sourceModes[Math.floor(session.random() * sourceModes.length)];
      const question = createQuestion(mode, session.data, session.difficulty, session.random, session.position);
      if (!isValidQuestion(question) || session.used.has(question.key)) continue;
      session.used.add(question.key);
      return question;
    }
    return null;
  }

  function submitAnswer(session, question, value) {
    const numeric = question.type === "number";
    const number = numeric ? Number(value) : NaN;
    if (numeric && (!Number.isFinite(number) || number < 0)) throw new Error("Enter a non-negative number before submitting your answer.");
    const correctValue = Number(question.correct);
    const distance = numeric ? Math.abs(number - correctValue) : Infinity;
    const tolerance = numeric ? question.tolerance : 0;
    const isCorrect = numeric ? distance <= tolerance : String(value) === String(question.correct);
    const base = pointsByDifficulty[session.difficulty] || pointsByDifficulty.medium;
    const earned = numeric
      ? Math.round(base * Math.max(0, 1 - distance / Math.max(correctValue * 0.5, 25)))
      : (isCorrect ? base : 0);
    session.answered += 1;
    if (isCorrect) {
      session.correct += 1;
      session.streak += 1;
      session.bestStreak = Math.max(session.bestStreak, session.streak);
    } else {
      session.streak = 0;
    }
    const streakBonus = isCorrect ? Math.min(50, Math.max(0, session.streak - 1) * 10) : 0;
    const points = earned + streakBonus;
    session.score += points;
    session.lastAnswer = { isCorrect, points, streakBonus, distance, userValue: value };
    return session.lastAnswer;
  }

  function getResults(session) {
    return {
      mode: session.mode,
      score: session.score,
      answered: session.answered,
      correct: session.correct,
      accuracy: session.answered ? Math.round((session.correct / session.answered) * 100) : 0,
      bestStreak: session.bestStreak,
      elapsed: Math.max(0, Math.round((Date.now() - session.startedAt) / 1000)),
      difficulty: difficultyNames[session.difficulty] || "Medium",
      title: modes[session.mode]?.title || "NFL Challenge"
    };
  }

  function isValidQuestion(question) {
    if (!question || typeof question.key !== "string" || !question.key ||
        typeof question.prompt !== "string" || !question.prompt ||
        typeof question.explanation !== "string" || !question.explanation) return false;
    if (question.type === "number") {
      return Number.isFinite(Number(question.correct)) && Number(question.correct) >= 0 &&
        Number.isFinite(Number(question.tolerance)) && Number(question.tolerance) >= 0;
    }
    if (question.type !== "choice" || !Array.isArray(question.choices) || question.choices.length < 2) return false;
    const values = question.choices.map(choice => String(choice?.value));
    const labels = question.choices.map(choice => String(choice?.label || ""));
    return values.every(Boolean) && labels.every(Boolean) &&
      new Set(values).size === values.length && new Set(labels).size === labels.length &&
      values.includes(String(question.correct));
  }

  window.GamesEngine = Object.freeze({
    modes,
    difficultyNames,
    pointsByDifficulty,
    createDailyQuestions,
    createSession,
    nextQuestion,
    isValidQuestion,
    submitAnswer,
    getResults
  });
})();
