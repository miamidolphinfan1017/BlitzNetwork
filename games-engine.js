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
    const usable = data.players.filter(player => !position || position === "ALL" || player.position === position)
      .flatMap(player => GamesData.usableStats(player).map(stat => ({ player, stat, value: Number(player.stats[stat.key]) })));
    if (!usable.length) return null;
    const chosen = choose(usable, random);
    const candidates = usable.filter(item =>
      item.stat.key === chosen.stat.key &&
      item.player.position === chosen.player.position &&
      item.player.player_id !== chosen.player.player_id &&
      item.value !== chosen.value
    );
    if (!candidates.length) return null;
    const other = choose(candidates, random);
    const winner = chosen.value > other.value ? chosen.player : other.player;
    return {
      key: `battle:${chosen.stat.key}:${[chosen.player.player_id, other.player.player_id].sort().join(":")}`,
      type: "choice",
      prompt: `Who has recorded more ${chosen.stat.label} in the ${data.season} regular season so far?`,
      clues: [{ label: "SEASON", value: String(data.season) }, { label: "POSITION", value: chosen.player.position }],
      comparison: [
        { name: chosen.player.full_name, team: chosen.player.team, position: chosen.player.position },
        { name: other.player.full_name, team: other.player.team, position: other.player.position }
      ],
      choices: shuffle([chosen.player, other.player], random).map(player => ({ label: player.full_name, value: player.player_id })),
      correct: winner.player_id,
      explanation: `${winner.full_name} has the higher ${chosen.stat.label} total in the ${data.season} regular season to date.`
    };
  }

  function higherQuestion(data, random, position) {
    const eligible = data.players.filter(player =>
      (!position || position === "ALL" || player.position === position) &&
      Number.isFinite(Number(player.stats.pts_ppr)) && Number(player.stats.pts_ppr) > 0
    );
    if (eligible.length < 2) return null;
    const first = choose(eligible, random);
    const secondPool = eligible.filter(player =>
      player.player_id !== first.player_id &&
      Number(player.stats.pts_ppr).toFixed(1) !== Number(first.stats.pts_ppr).toFixed(1)
    );
    if (!secondPool.length) return null;
    const second = choose(secondPool, random);
    const firstValue = Number(first.stats.pts_ppr);
    const secondValue = Number(second.stats.pts_ppr);
    const answer = secondValue > firstValue ? "Higher" : "Lower";
    return {
      key: `higher:${first.player_id}:${second.player_id}`,
      type: "choice",
      prompt: `Compared with ${first.full_name}, did ${second.full_name} score higher or lower in PPR fantasy points this season?`,
      clues: [
        { label: "REFERENCE PLAYER", value: `${first.full_name} · ${first.team} ${first.position}` },
        { label: "REFERENCE POINTS", value: firstValue.toFixed(1) },
        { label: "CHALLENGE PLAYER", value: `${second.full_name} · ${second.team} ${second.position}` },
        { label: "SEASON", value: String(data.season) }
      ],
      choices: shuffle(["Higher", "Lower"], random).map(value => ({ label: value, value })),
      correct: answer,
      explanation: `${second.full_name} has ${secondValue.toFixed(1)} PPR points; ${first.full_name} has ${firstValue.toFixed(1)}.`
    };
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
    const teams = data.teams.filter(team => team.abbr !== game.home.abbr && team.abbr !== game.away.abbr);
    const options = sampleOptions(correct, teams, 4, random, team => team.name);
    if (!options) return null;
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
      choices: options,
      correct: correct.name,
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
