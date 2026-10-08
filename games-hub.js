(function () {
  "use strict";

  const historyPrefix = "games_history_v1:";
  const today = new Date().toISOString().slice(0, 10);
  const catalog = [
    { id: "team", title: "Roster Check", category: "Teams", icon: "T", description: "Match real active players to the NFL team that currently lists them.", time: "2–4 MIN", difficulty: "ALL LEVELS", quick: true },
    { id: "player", title: "Who’s That Player?", category: "Players", icon: "?", description: "Identify an active player from roster clues. Harder settings reveal less.", time: "2–4 MIN", difficulty: "4 DIFFICULTIES", quick: true },
    { id: "battle", title: "Stat Showdown", category: "Stats", icon: "VS", description: "Compare same-position players using actual season-to-date stat totals.", time: "2–4 MIN", difficulty: "REAL SEASON TOTALS" },
    { id: "higher", title: "Higher or Lower", category: "Stats", icon: "↑", description: "Compare two players’ real PPR fantasy totals from this regular season.", time: "2–4 MIN", difficulty: "REAL PPR TOTALS", quick: true },
    { id: "estimate", title: "Guess the Stat", category: "Stats", icon: "#", description: "Estimate a player’s real season total. Points reward answers close to the mark.", time: "2–4 MIN", difficulty: "CLOSE COUNTS" },
    { id: "recap", title: "Game Day Recap", category: "Teams", icon: "W", description: "Recall the winner of a completed regular-season game from the ESPN results feed.", time: "2–4 MIN", difficulty: "COMPLETED GAMES" },
    { id: "speed", title: "60-Second Blitz", category: "Speed", icon: "60", description: "Answer a rapid mix of roster, player, stat, and completed-game questions.", time: "30–120 SEC", difficulty: "TIMED ROUND", quick: true },
    { id: "daily", title: "The Daily Drive", category: "Daily", icon: "D", description: "Five fixed questions, seeded for today and saved on this device.", time: "5 QUESTIONS", difficulty: "SAME ALL DAY" }
  ];
  const categories = ["All", "Players", "Teams", "Stats", "Speed", "Daily"];
  const nextGameByMode = {
    team: "player",
    player: "battle",
    battle: "higher",
    higher: "estimate",
    estimate: "recap",
    recap: "team",
    speed: "player",
    daily: "speed"
  };
  const elements = {};
  let data = null;
  let selectedMode = "team";
  let recommendedMode = "player";
  let session = null;
  let currentQuestion = null;
  let timerId = null;
  let autoAdvanceId = null;
  let history = [];
  let activeCategory = "All";

  function byId(id) { return document.getElementById(id); }

  function setText(id, value) { byId(id).textContent = String(value); }

  function getUserScope() {
    let user = localStorage.getItem("currentUser") || sessionStorage.getItem("currentUser");
    if (user) {
      try {
        const parsed = JSON.parse(user);
        if (parsed && typeof parsed === "object") user = parsed.email || parsed.username || parsed.id;
      } catch {}
    }
    return user ? encodeURIComponent(String(user).trim().toLowerCase()) : "guest";
  }

  function loadHistory() {
    try {
      const stored = JSON.parse(localStorage.getItem(historyPrefix + getUserScope()) || "[]");
      history = Array.isArray(stored) ? stored.filter(item =>
        item && typeof item.mode === "string" && Number.isFinite(Number(item.score)) &&
        Number.isFinite(Number(item.answered)) && Number.isFinite(Number(item.bestStreak))
      ).slice(-100) : [];
      if (!Array.isArray(stored)) showNotice("Saved game history was not in the expected format; starting with an empty record.");
    } catch {
      history = [];
      showNotice("Saved game history couldn't be read from this browser.");
    }
  }

  function saveHistory(result) {
    const record = Object.assign({}, result, { date: new Date().toISOString(), dailyDate: result.mode === "daily" ? today : "" });
    history.push(record);
    history = history.slice(-100);
    try {
      localStorage.setItem(historyPrefix + getUserScope(), JSON.stringify(history));
    } catch {
      showNotice("Your game finished, but this browser couldn't save the local result.");
    }
    return record;
  }

  function formatDate(date) {
    return new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { month: "long", day: "numeric", timeZone: "UTC" });
  }

  function setGameScreen(screen) {
    ["games-browser", "games-setup", "games-play-screen", "games-results"].forEach(id => {
      byId(id).hidden = id !== screen;
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function showNotice(message) {
    const notice = byId("games-notice");
    notice.textContent = message;
    notice.hidden = false;
  }

  function hideNotice() { byId("games-notice").hidden = true; }

  function renderHistory() {
    const total = history.length;
    const best = history.reduce((top, item) => Math.max(top, Number(item.score) || 0), 0);
    const streak = history.reduce((top, item) => Math.max(top, Number(item.bestStreak) || 0), 0);
    setText("games-total-played", total);
    setText("games-personal-best", total ? best.toLocaleString() : "—");
    setText("games-best-streak", streak);
    const recent = history[history.length - 1];
    setText("games-recent-result", recent ? `${recent.title} · ${Number(recent.score).toLocaleString()}` : "Not played yet");
    const dailyScores = history.filter(item => item.mode === "daily" && item.dailyDate === today);
    const dailyBest = dailyScores.reduce((best, item) => Math.max(best, Number(item.score) || 0), 0);
    setText("games-daily-status", dailyScores.length
      ? `Completed today ✓ · Best ${dailyBest.toLocaleString()} points`
      : "5 questions · Your best score is saved on this device");
  }

  function renderCategories() {
    const container = byId("games-categories");
    container.replaceChildren();
    categories.forEach(category => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "games-category-filter" + (category === activeCategory ? " is-active" : "");
      button.textContent = category;
      button.setAttribute("aria-pressed", String(category === activeCategory));
      button.addEventListener("click", () => {
        activeCategory = category;
        renderCategories();
        renderCatalog();
      });
      container.appendChild(button);
    });
  }

  function makeGameCard(game) {
    const article = document.createElement("article");
    article.className = "games-game-card";
    article.dataset.category = game.category;
    const top = document.createElement("div");
    top.className = "games-game-card-top";
    const icon = document.createElement("span");
    icon.className = "games-game-card-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = game.icon;
    const category = document.createElement("span");
    category.className = "games-game-category";
    category.textContent = game.category;
    top.append(icon, category);
    const title = document.createElement("h3");
    title.textContent = game.title;
    const description = document.createElement("p");
    description.textContent = game.id === "recap" && !data.games.length ? data.gamesError : game.description;
    const meta = document.createElement("div");
    meta.className = "games-game-meta";
    [game.time, game.difficulty].forEach(value => {
      const span = document.createElement("span");
      span.textContent = value;
      meta.appendChild(span);
    });
    const play = document.createElement("button");
    play.className = "games-card-play";
    play.type = "button";
    play.textContent = "Play challenge →";
    play.disabled = game.id === "recap" && !data.games.length;
    play.addEventListener("click", () => openSetup(game.id));
    article.append(top, title, description, meta, play);
    return article;
  }

  function renderCatalog() {
    const grid = byId("games-card-grid");
    grid.replaceChildren();
    const visible = catalog.filter(game => activeCategory === "All" || game.category === activeCategory);
    visible.forEach(game => grid.appendChild(makeGameCard(game)));
    byId("games-empty-filter").hidden = visible.length > 0;
  }

  function renderQuickPlay() {
    const quickGrid = byId("games-quick-grid");
    quickGrid.replaceChildren();
    catalog.filter(game => game.quick).forEach(game => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "games-quick-card";
      const icon = document.createElement("span");
      icon.className = "games-quick-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = game.icon;
      const copy = document.createElement("span");
      copy.className = "games-quick-copy";
      const title = document.createElement("strong");
      title.textContent = game.title;
      const detail = document.createElement("span");
      detail.textContent = game.time;
      copy.append(title, detail);
      const arrow = document.createElement("span");
      arrow.className = "games-quick-arrow";
      arrow.setAttribute("aria-hidden", "true");
      arrow.textContent = "→";
      button.append(icon, copy, arrow);
      button.addEventListener("click", () => openSetup(game.id));
      quickGrid.appendChild(button);
    });
  }

  function getDailyQuestions() {
    const key = `games_daily_questions_v1:${today}`;
    try {
      const stored = JSON.parse(localStorage.getItem(key) || "null");
      if (Array.isArray(stored) && stored.length === 5 && stored.every(question =>
        GamesEngine.isValidQuestion(question)
      ) && new Set(stored.map(question => question.key)).size === 5) return stored;
    } catch {}
    const questions = GamesEngine.createDailyQuestions(data, today);
    try { localStorage.setItem(key, JSON.stringify(questions)); }
    catch { showNotice("Daily questions are ready, but this browser could not cache them for later today."); }
    return questions;
  }

  function openSetup(mode) {
    selectedMode = mode;
    const game = catalog.find(item => item.id === mode);
    if (!game) return;
    hideNotice();
    setText("games-setup-title", game.title);
    setText("games-setup-description", game.description);
    byId("games-count-setting").hidden = ["daily", "speed"].includes(mode);
    byId("games-difficulty-setting").hidden = ["daily"].includes(mode);
    byId("games-position-setting").hidden = !["team", "player", "battle", "higher", "estimate"].includes(mode);
    byId("games-timer-setting").hidden = mode !== "speed";
    if (mode === "recap" && !data.games.length) {
      showNotice(data.gamesError || "Completed-game data is unavailable right now.");
      return;
    }
    setGameScreen("games-setup");
  }

  function showBrowser() {
    clearTimer();
    session = null;
    currentQuestion = null;
    hideNotice();
    setGameScreen("games-browser");
    renderHistory();
  }

  function startGame() {
    try {
      const difficulty = selectedMode === "daily" ? "medium" : byId("games-difficulty").value;
      const options = {
        difficulty,
        count: Number(byId("games-question-count").value),
        position: byId("games-position").value,
        seconds: Number(byId("games-timer-length").value)
      };
      const questions = selectedMode === "daily" ? getDailyQuestions() : null;
      session = GamesEngine.createSession(selectedMode, data, options, questions);
      setText("games-play-title", GamesEngine.modes[selectedMode].title);
      setText("games-play-mode", `${GamesEngine.modes[selectedMode].category} · ${difficulty}`);
      byId("games-timer-stat").hidden = selectedMode !== "speed";
      byId("games-progress-track").hidden = selectedMode === "speed";
      setGameScreen("games-play-screen");
      loadQuestion();
      if (selectedMode === "speed") startTimer(options.seconds);
    } catch (error) {
      showNotice(error.message || "The game could not be prepared from the available NFL data.");
      showBrowser();
      showNotice(error.message || "The game could not be prepared from the available NFL data.");
    }
  }

  function renderQuestion() {
    setText("games-play-progress", session.mode === "speed"
      ? `${session.answered} ${session.answered === 1 ? "QUESTION" : "QUESTIONS"} ANSWERED`
      : `QUESTION ${session.index + 1} / ${session.count}`);
    setText("games-score-value", session.score.toLocaleString());
    setText("games-streak-value", session.streak);
    byId("games-progress-fill").style.width = session.mode === "speed" ? "0%" :
      `${Math.round((session.index / session.count) * 100)}%`;
    setText("games-question-label", currentQuestion.type === "number" ? "REAL SEASON TOTAL · YOUR ESTIMATE" : "YOUR QUESTION");
    setText("games-question-prompt", currentQuestion.prompt);

    const clues = byId("games-question-clues");
    clues.replaceChildren();
    (currentQuestion.clues || []).forEach(clue => {
      const item = document.createElement("div");
      item.className = "games-clue";
      const label = document.createElement("span");
      label.textContent = clue.label;
      const value = document.createElement("strong");
      value.textContent = clue.value;
      item.append(label, value);
      clues.appendChild(item);
    });

    const comparison = byId("games-stat-compare");
    comparison.replaceChildren();
    comparison.hidden = !currentQuestion.comparison;
    (currentQuestion.comparison || []).forEach(player => {
      const card = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = player.name;
      const team = document.createElement("span");
      team.textContent = `${player.team} · ${player.position}`;
      card.append(name, team);
      comparison.appendChild(card);
    });

    const answerGrid = byId("games-answer-grid");
    answerGrid.replaceChildren();
    const numberForm = byId("games-number-form");
    numberForm.hidden = currentQuestion.type !== "number";
    answerGrid.hidden = currentQuestion.type === "number";
    if (currentQuestion.type === "number") {
      byId("games-number-input").value = "";
      byId("games-number-input").disabled = false;
      setText("games-number-label", "Your estimate (decimals allowed)");
      byId("games-number-input").focus({ preventScroll: true });
      return;
    }
    currentQuestion.choices.forEach(choice => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "games-answer-option";
      button.textContent = choice.label;
      button.dataset.answer = String(choice.value);
      button.addEventListener("click", () => answerQuestion(choice.value));
      answerGrid.appendChild(button);
    });
  }

  function loadQuestion() {
    if (!session) return;
    if (session.mode !== "speed" && session.index >= session.count) {
      finishGame();
      return;
    }
    currentQuestion = GamesEngine.nextQuestion(session);
    if (!currentQuestion) {
      if (session.answered) finishGame();
      else {
        showBrowser();
        showNotice("There isn't enough verified data to build this game right now. Try another challenge or refresh the data.");
      }
      return;
    }
    session.lastAnswer = null;
    renderQuestion();
    byId("games-feedback").hidden = true;
    byId("games-next").disabled = false;
    if (currentQuestion.type === "number") byId("games-number-input").focus({ preventScroll: true });
  }

  function answerQuestion(value) {
    if (!session || !currentQuestion || session.lastAnswer) return;
    try {
      const result = GamesEngine.submitAnswer(session, currentQuestion, value);
      renderFeedback(result);
      setText("games-score-value", session.score.toLocaleString());
      setText("games-streak-value", session.streak);
      if (session.mode === "speed") {
        autoAdvanceId = window.setTimeout(() => {
          autoAdvanceId = null;
          if (session && currentQuestion && session.lastAnswer) loadQuestion();
        }, 450);
      }
    } catch (error) {
      showNotice(error.message);
    }
  }

  function renderFeedback(result) {
    const feedback = byId("games-feedback");
    feedback.hidden = false;
    const title = byId("games-feedback-title");
    title.textContent = result.isCorrect
      ? `Correct! +${result.points.toLocaleString()} points${session.streak > 1 ? ` · ${session.streak} streak` : ""}`
      : (currentQuestion.type === "number" && result.points > 0 ? `Close! +${result.points.toLocaleString()} points` : "Not quite");
    const answer = currentQuestion.type === "number"
      ? `Correct answer: ${currentQuestion.answerLabel} · Your answer: ${Number(result.userValue).toLocaleString()}`
      : `Correct answer: ${currentQuestion.choices.find(choice => String(choice.value) === String(currentQuestion.correct))?.label || currentQuestion.correct}`;
    setText("games-feedback-answer", answer);
    setText("games-feedback-explanation", currentQuestion.explanation);
    byId("games-next").textContent = session.mode === "speed" ? "Next question →" :
      (session.index + 1 >= session.count ? "See results →" : "Next question →");
    byId("games-next").hidden = session.mode === "speed";
    byId("games-answer-grid").querySelectorAll("button").forEach(button => {
      button.disabled = true;
      const isRight = button.dataset.answer === String(currentQuestion.correct);
      if (isRight) button.classList.add("is-correct");
      else if (button.dataset.answer === String(result.userValue)) button.classList.add("is-wrong");
    });
    if (currentQuestion.type === "number") byId("games-number-input").disabled = true;
  }

  function startTimer(seconds) {
    clearTimer();
    const expiresAt = Date.now() + seconds * 1000;
    const update = () => {
      if (!session || session.mode !== "speed") return;
      const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      setText("games-timer-value", `${String(Math.floor(remaining / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}`);
      byId("games-progress-fill").style.width = `${Math.max(0, Math.min(100, (remaining / seconds) * 100))}%`;
      if (!remaining) finishGame();
    };
    update();
    timerId = window.setInterval(update, 200);
  }

  function clearTimer() {
    if (timerId !== null) window.clearInterval(timerId);
    timerId = null;
    if (autoAdvanceId !== null) window.clearTimeout(autoAdvanceId);
    autoAdvanceId = null;
  }

  function formatDuration(seconds) {
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }

  function finishGame() {
    if (!session) return;
    clearTimer();
    const result = GamesEngine.getResults(session);
    const previousBest = history.reduce((best, item) => item.mode === result.mode ? Math.max(best, Number(item.score)) : best, 0);
    saveHistory(result);
    renderHistory();
    recommendedMode = nextGameByMode[result.mode] || "team";
    if (recommendedMode === "recap" && !data.games.length) recommendedMode = "team";
    const recommendation = catalog.find(item => item.id === recommendedMode);
    setText("games-next-recommendation", `Try next: ${recommendation.title} · ${recommendation.description}`);
    setText("games-recommended-play", `Try ${recommendation.title} →`);
    setText("games-results-title", result.title === "60-Second Blitz" ? "Time!" : "Game complete");
    setText("games-results-subtitle", result.mode === "daily" ? `The Daily Drive · ${formatDate(today)}` : result.title);
    setText("games-result-score", result.score.toLocaleString());
    setText("games-result-accuracy", `${result.accuracy}%`);
    setText("games-result-correct", `${result.correct} / ${result.answered}`);
    setText("games-result-streak", result.bestStreak);
    setText("games-result-time", formatDuration(result.elapsed));
    setText("games-result-difficulty", result.difficulty);
    setText("games-results-record", result.score > previousBest ? "New personal best for this game on this device." : "Your result has been saved to this browser.");
    byId("games-progress-fill").style.width = "100%";
    setGameScreen("games-results");
  }

  function bindEvents() {
    byId("games-retry").addEventListener("click", () => initialize(true));
    byId("games-daily-play").addEventListener("click", () => openSetup("daily"));
    byId("games-start").addEventListener("click", startGame);
    byId("games-setup-back").addEventListener("click", showBrowser);
    byId("games-play-exit").addEventListener("click", showBrowser);
    byId("games-next").addEventListener("click", () => {
      if (!session || session.mode === "speed") return;
      session.index += 1;
      session.lastAnswer = null;
      loadQuestion();
    });
    byId("games-number-form").addEventListener("submit", event => {
      event.preventDefault();
      answerQuestion(byId("games-number-input").value);
    });
    byId("games-play-again").addEventListener("click", () => {
      const mode = session?.mode || selectedMode;
      openSetup(mode);
      startGame();
    });
    byId("games-recommended-play").addEventListener("click", () => openSetup(recommendedMode));
    byId("games-another-game").addEventListener("click", showBrowser);
    byId("games-number-input").addEventListener("keydown", event => {
      if (event.key === "Enter" && !byId("games-number-form").hidden) {
        event.preventDefault();
        byId("games-number-form").requestSubmit();
      }
    });
  }

  async function initialize(force) {
    byId("games-loading").hidden = false;
    byId("games-error").hidden = true;
    byId("games-browser").hidden = true;
    try {
      data = await GamesData.load(force);
      loadHistory();
      getDailyQuestions();
      setText("games-season", `${data.season} NFL`);
      setText("games-data-updated", `Sleeper season stats · ${data.games.length ? "ESPN completed-game results" : "Game results unavailable"}`);
      setText("games-daily-date", formatDate(today));
      byId("games-daily-play").disabled = false;
      renderCategories();
      renderQuickPlay();
      renderCatalog();
      renderHistory();
      byId("games-loading").hidden = true;
      byId("games-browser").hidden = false;
      if (data.gamesError) {
        showNotice(`${data.gamesError} Other available challenges remain playable.`);
      } else hideNotice();
    } catch (error) {
      byId("games-loading").hidden = true;
      byId("games-error").hidden = false;
      setText("games-error-message", error.message || "Check your connection and try again.");
    }
  }

  function initializeThemeButton() {
    const button = byId("themeToggle");
    const apply = () => {
      const dark = document.documentElement.classList.contains("dark-mode");
      button.textContent = dark ? "Light" : "Dark";
      button.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
    };
    apply();
    new MutationObserver(apply).observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    window.toggleTheme = function () {
      const dark = document.documentElement.classList.contains("dark-mode");
      const next = dark ? "light-mode" : "dark-mode";
      document.documentElement.classList.remove("light-mode", "dark-mode");
      document.documentElement.classList.add(next);
      localStorage.setItem("user_settings.theme", JSON.stringify(next));
      localStorage.setItem("theme", next);
    };
  }

  window.toggleMenu = function () {
    const menu = byId("side-menu");
    const button = document.querySelector(".menu-btn");
    const open = !menu.classList.contains("open");
    menu.classList.toggle("open", open);
    menu.style.width = open ? "280px" : "0";
    button?.setAttribute("aria-expanded", String(open));
  };

  bindEvents();
  initializeThemeButton();
  initialize(false);
  window.addEventListener("pagehide", clearTimer, { once: true });
})();
