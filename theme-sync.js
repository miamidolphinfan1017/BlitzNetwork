(function () {
  "use strict";

  const root = document.documentElement;

  function getJson(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      if (value === null) return fallback;
      try { return JSON.parse(value); } catch { return value; }
    } catch (error) {
      console.error(`Unable to read the saved setting "${key}":`, error);
      return fallback;
    }
  }

  function applyThemeMode() {
    const mode = getJson("theme", null) || getJson("user_settings.theme", "light-mode");
    root.classList.remove("light-mode", "dark-mode");
    root.classList.add(mode === "dark-mode" ? "dark-mode" : "light-mode");
  }

  function getUser() {
    try {
      const users = JSON.parse(localStorage.getItem("registeredUsers") || "{}");
      if (!users || typeof users !== "object") throw new Error("Saved account records are invalid.");
      const localUser = localStorage.getItem("currentUser");
      const sessionUser = sessionStorage.getItem("currentUser");
      const valid = username => Boolean(username && Object.prototype.hasOwnProperty.call(users, username) &&
        users[username] && typeof users[username].password === "string");
      if (valid(localUser)) return localUser;
      if (localUser) localStorage.removeItem("currentUser");
      if (valid(sessionUser)) return sessionUser;
      if (sessionUser) {
        sessionStorage.removeItem("currentUser");
      }
      if (!localUser && !sessionUser) return null;
      return null;
    } catch (error) {
      console.error("Unable to validate the saved Blitz Network account:", error);
      try {
        localStorage.removeItem("currentUser");
        sessionStorage.removeItem("currentUser");
      } catch (storageError) {
        console.error("Unable to clear invalid Blitz Network account state:", storageError);
      }
      return null;
    }
  }

  function syncAuthUI() {
    const username = getUser();
    const profile = username ? readProfile(username) : {};
    const displayName = username ? (profile.displayName || username) : "";
    const destination = username ? "Account.html" : "Login.html";
    document.querySelectorAll("#nav-login-btn, #side-login-link, #settings-nav-login-btn, #settings-side-login-link").forEach(link => {
      const sideNavigation = link.id.includes("side-login-link");
      link.href = destination;
      link.textContent = username ? (sideNavigation ? `Account · ${displayName}` : "ACCOUNT") : (sideNavigation ? "Login" : "LOGIN");
      link.setAttribute("aria-label", username ? `Open account for ${displayName}` : "Log in");
    });
    document.querySelectorAll("[data-blitz-profile-avatar]").forEach(image => {
      if (!username) {
        image.hidden = true;
        image.removeAttribute("src");
        return;
      }
      image.src = avatarSource(profile);
      image.alt = `${displayName}'s profile picture`;
      image.hidden = false;
    });
    document.dispatchEvent(new CustomEvent("blitz-auth-changed", { detail: { username, displayName, profile } }));
    return username;
  }

  const teamIdsByName = {
    "Arizona Cardinals": "cardinals", "Atlanta Falcons": "falcons", "Baltimore Ravens": "ravens",
    "Buffalo Bills": "bills", "Carolina Panthers": "panthers", "Chicago Bears": "bears",
    "Cincinnati Bengals": "bengals", "Cleveland Browns": "browns", "Dallas Cowboys": "cowboys",
    "Denver Broncos": "broncos", "Detroit Lions": "lions", "Green Bay Packers": "packers",
    "Houston Texans": "texans", "Indianapolis Colts": "colts", "Jacksonville Jaguars": "jaguars",
    "Kansas City Chiefs": "chiefs", "Las Vegas Raiders": "raiders", "Los Angeles Chargers": "chargers",
    "Los Angeles Rams": "rams", "Miami Dolphins": "dolphins", "Minnesota Vikings": "vikings",
    "New England Patriots": "patriots", "New Orleans Saints": "saints", "New York Giants": "giants",
    "New York Jets": "jets", "Philadelphia Eagles": "eagles", "Pittsburgh Steelers": "steelers",
    "San Francisco 49ers": "sf49ers", "Seattle Seahawks": "seahawks", "Tampa Bay Buccaneers": "buccaneers",
    "Tennessee Titans": "titans", "Washington Commanders": "commanders"
  };
  const allowedAvatarPresets = ["default", "red", "blue", "green", "purple", "orange", "teal", "gold"];
  const avatarColors = {
    default: "#697586", red: "#cc0000", blue: "#1f69d7", green: "#1fa654",
    purple: "#7d3ccf", orange: "#db7700", teal: "#0fa3a3", gold: "#cf9f0a"
  };

  function readProfile(username) {
    if (!username) return {};
    try {
      const profile = JSON.parse(localStorage.getItem(`profile_${username}`) || "{}");
      if (!profile || typeof profile !== "object" || Array.isArray(profile)) throw new Error("Saved profile has an invalid shape.");
      if (!profile.favoriteTeam) profile.favoriteTeam = localStorage.getItem(`favoriteTeam_${username}`) || "";
      if (!profile.favoriteTeamId) profile.favoriteTeamId = localStorage.getItem(`favoriteTeamId_${username}`) || teamIdsByName[profile.favoriteTeam] || "";
      if (!teamIdsByName[profile.favoriteTeam]) {
        profile.favoriteTeam = "";
        profile.favoriteTeamId = "";
      }
      return profile;
    } catch (error) {
      console.error(`Unable to read the profile for "${username}":`, error);
      return {};
    }
  }

  function saveProfile(username, updates) {
    if (!username || !updates || typeof updates !== "object" || Array.isArray(updates)) {
      throw new TypeError("A signed-in username and profile update object are required.");
    }
    const profile = Object.assign(readProfile(username), updates);
    profile.displayName = typeof profile.displayName === "string" ? profile.displayName.trim().slice(0, 32) : "";
    profile.bio = typeof profile.bio === "string" ? profile.bio.trim().slice(0, 160) : "";
    profile.avatar = typeof profile.avatar === "string" ? profile.avatar : "";
    profile.avatarPreset = allowedAvatarPresets.includes(profile.avatarPreset) ? profile.avatarPreset : "default";
    if (!teamIdsByName[profile.favoriteTeam]) {
      profile.favoriteTeam = "";
      profile.favoriteTeamId = "";
    } else {
      profile.favoriteTeamId = teamIdsByName[profile.favoriteTeam];
    }
    localStorage.setItem(`profile_${username}`, JSON.stringify(profile));
    if (profile.favoriteTeam) {
      localStorage.setItem(`favoriteTeam_${username}`, profile.favoriteTeam);
      localStorage.setItem(`favoriteTeamId_${username}`, profile.favoriteTeamId);
    } else {
      localStorage.removeItem(`favoriteTeam_${username}`);
      localStorage.removeItem(`favoriteTeamId_${username}`);
    }
    document.dispatchEvent(new CustomEvent("blitz-profile-changed", { detail: { username, profile } }));
    syncAuthUI();
    return profile;
  }

  function avatarSource(profile) {
    if (profile && typeof profile.avatar === "string" && profile.avatar) return profile.avatar;
    const preset = profile && allowedAvatarPresets.includes(profile.avatarPreset) ? profile.avatarPreset : "default";
    const color = avatarColors[preset];
    const initials = (profile && (profile.displayName || profile.username) || "BN")
      .trim().split(/\s+/).slice(0, 2).map(part => part.charAt(0).toUpperCase()).join("") || "BN";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160"><circle cx="80" cy="80" r="80" fill="${color}"/><text x="80" y="94" text-anchor="middle" font-family="Arial,sans-serif" font-size="54" font-weight="700" fill="#fff">${initials.replace(/[<>&"']/g, "")}</text></svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }

  function renameCurrentUser(nextUsername) {
    const oldUsername = getUser();
    const next = String(nextUsername || "").trim();
    if (!oldUsername) throw new Error("Log in before changing the username.");
    if (!/^[A-Za-z0-9_.-]{3,24}$/.test(next)) {
      throw new Error("Use 3–24 characters: letters, numbers, periods, underscores, or hyphens.");
    }
    if (next === oldUsername) return oldUsername;

    const users = JSON.parse(localStorage.getItem("registeredUsers") || "{}");
    const collision = Object.keys(users).find(name => name.toLowerCase() === next.toLowerCase() && name !== oldUsername);
    if (collision) throw new Error("That username is already in use in this browser.");
    if (!Object.prototype.hasOwnProperty.call(users, oldUsername)) throw new Error("The local account record could not be found.");

    const encodedScope = encodeURIComponent(oldUsername.trim().toLowerCase());
    const keyMoves = [
      [`profile_${oldUsername}`, `profile_${next}`],
      [`BestScore_${oldUsername}`, `BestScore_${next}`],
      [`favoriteTeam_${oldUsername}`, `favoriteTeam_${next}`],
      [`favoriteTeamId_${oldUsername}`, `favoriteTeamId_${next}`],
      [`${oldUsername}_survey_results`, `${next}_survey_results`],
      [`games_history_v1:${encodedScope}`, `games_history_v1:${encodeURIComponent(next.trim().toLowerCase())}`],
      [`blitz_game_history_${encodedScope}`, `blitz_game_history_${encodeURIComponent(next.trim().toLowerCase())}`],
      [`team_pfps_${oldUsername}`, `team_pfps_${next}`]
    ];
    const originalValues = new Map();
    const writes = new Map();
    keyMoves.forEach(([oldKey, newKey]) => {
      const oldValue = localStorage.getItem(oldKey);
      if (oldValue !== null) {
        originalValues.set(oldKey, oldValue);
        const targetValue = localStorage.getItem(newKey);
        if (targetValue !== null) throw new Error(`Existing data for "${next}" prevents safely renaming this account.`);
        writes.set(newKey, oldValue);
        writes.set(oldKey, null);
      }
    });
    if (writes.has(`profile_${next}`)) {
      const profile = JSON.parse(writes.get(`profile_${next}`));
      if (profile.displayName === oldUsername) {
        profile.displayName = next;
        writes.set(`profile_${next}`, JSON.stringify(profile));
      }
    }

    const leaderboardRaw = localStorage.getItem("nfl_leaderboard");
    if (leaderboardRaw) {
      try {
        const leaderboard = JSON.parse(leaderboardRaw);
        if (Array.isArray(leaderboard)) {
          const renamed = leaderboard.map(entry => {
            if (!entry || entry.name !== oldUsername) return entry;
            return {
              ...entry,
              name: next,
              displayName: entry.displayName === oldUsername ? next : entry.displayName
            };
          });
          if (JSON.stringify(renamed) !== leaderboardRaw) writes.set("nfl_leaderboard", JSON.stringify(renamed));
        }
      } catch (error) {
        console.error("Unable to migrate the local leaderboard during username change:", error);
      }
    }
    const oldProfile = writes.has(`profile_${next}`)
      ? JSON.parse(writes.get(`profile_${next}`))
      : readProfile(oldUsername);
    const oldDisplayName = oldProfile.displayName || oldUsername;
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key || !key.startsWith("posts_")) continue;
      try {
        const posts = JSON.parse(localStorage.getItem(key) || "[]");
        if (!Array.isArray(posts)) continue;
        const updated = posts.map(post => {
          if (!post || (post.username !== oldUsername && post.name !== oldDisplayName && post.name !== oldUsername)) return post;
          const migrated = { ...post, username: next };
          if (post.name === oldDisplayName || post.name === oldUsername) migrated.name = oldProfile.displayName || next;
          return migrated;
        });
        if (JSON.stringify(updated) !== JSON.stringify(posts)) writes.set(key, JSON.stringify(updated));
      } catch (error) {
        console.error(`Unable to migrate saved posts in "${key}" during username change:`, error);
      }
    }

    const updatedUsers = { ...users, [next]: users[oldUsername] };
    delete updatedUsers[oldUsername];
    const previousUsers = localStorage.getItem("registeredUsers");
    const localCurrent = localStorage.getItem("currentUser") === oldUsername;
    const sessionCurrent = sessionStorage.getItem("currentUser") === oldUsername;
    try {
      writes.forEach((value, key) => {
        originalValues.set(key, localStorage.getItem(key));
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      });
      localStorage.setItem("registeredUsers", JSON.stringify({ ...users, [next]: users[oldUsername] }));
      if (localCurrent) localStorage.setItem("currentUser", next);
      if (sessionCurrent) sessionStorage.setItem("currentUser", next);
      localStorage.setItem("registeredUsers", JSON.stringify(updatedUsers));
    } catch (error) {
      originalValues.forEach((value, key) => {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      });
      if (previousUsers === null) localStorage.removeItem("registeredUsers");
      else localStorage.setItem("registeredUsers", previousUsers);
      if (localCurrent) localStorage.setItem("currentUser", oldUsername);
      if (sessionCurrent) sessionStorage.setItem("currentUser", oldUsername);
      throw new Error("The username change could not be saved. Existing account data was restored.");
    }
    document.dispatchEvent(new CustomEvent("blitz-profile-changed", { detail: { username: next, previousUsername: oldUsername, profile: readProfile(next) } }));
    syncAuthUI();
    return next;
  }

  window.BlitzProfile = {
    teams: Object.keys(teamIdsByName).map(name => ({ name, id: teamIdsByName[name] })),
    getCurrentUser: getUser,
    read: readProfile,
    save: saveProfile,
    rename: renameCurrentUser,
    avatarSource
  };

  function applyAccent() {
    try {
      const colorTheme = getJson("user_settings.color_theme", "red");
      const customColor = localStorage.getItem("user_settings.custom_color") || "#cc0000";
      const colorMap = {
        red: "#cc0000",
        blue: "#1f69d7",
        green: "#1fa654",
        purple: "#7d3ccf",
        orange: "#db7700",
        teal: "#0fa3a3",
        pink: "#d63d8f",
        gold: "#cf9f0a"
      };
      const next = colorTheme === "custom"
        ? customColor
        : (colorMap[colorTheme] || localStorage.getItem("settings_accent") || "#cc0000");
      root.style.setProperty("--accent-red", next);
    } catch (error) {
      console.error("Unable to apply the saved Blitz Network accent:", error);
    }
  }

  function applyDisplayPreferences() {
    try {
      const textSize = Number(getJson("user_settings.text_size", 16));
      const preferences = getJson("user_settings.preferences", {});
      const safeTextSize = Number.isFinite(textSize) ? Math.min(22, Math.max(14, textSize)) : 16;
      root.style.fontSize = `${safeTextSize}px`;
      root.classList.toggle("blitz-bold-text", Boolean(preferences && preferences.bold_text));
      root.classList.toggle("blitz-high-contrast", Boolean(preferences && preferences.high_contrast));
      root.classList.toggle("blitz-reduce-motion", Boolean(preferences && preferences.reduce_motion));
    } catch (error) {
      console.error("Unable to apply saved accessibility preferences:", error);
    }
  }

  function ensureFantasyNavigation() {
    const menu = document.getElementById("side-menu");
    if (!menu || menu.querySelector('a[href="Fantasy.html"]')) return;
    const scheduleLink = menu.querySelector('a[href="Schedule.html"], a[href="schedule.html"]');
    const fantasyLink = document.createElement("a");
    fantasyLink.href = "Fantasy.html";
    fantasyLink.textContent = "Fantasy";
    if (scheduleLink) scheduleLink.insertAdjacentElement("afterend", fantasyLink);
    else menu.appendChild(fantasyLink);
  }

  function loadLiveExperience() {
    if (document.querySelector('script[data-blitz-live="true"]')) return;
    const script = document.createElement("script");
    script.src = "nfl-live.js";
    script.defer = true;
    script.dataset.blitzLive = "true";
    script.addEventListener("error", () => console.error("Unable to load the shared NFL live experience."));
    document.head.appendChild(script);
  }

  window.BlitzAuth = {
    getUser,
    sync: syncAuthUI,
    changed: syncAuthUI
  };

  applyThemeMode();
  applyAccent();
  applyDisplayPreferences();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      ensureFantasyNavigation();
      syncAuthUI();
      loadLiveExperience();
    }, { once: true });
  } else {
    ensureFantasyNavigation();
    syncAuthUI();
    loadLiveExperience();
  }
  window.addEventListener("storage", event => {
    if (event.key === "currentUser" || event.key === "registeredUsers") syncAuthUI();
    const activeUser = getUser();
    if (activeUser && event.key === `profile_${activeUser}`) syncAuthUI();
    if (event.key === null || event.key.indexOf("user_settings.") === 0 || event.key === "settings_accent" || event.key === "theme") {
      applyThemeMode();
      applyAccent();
      applyDisplayPreferences();
    }
  });
})();
