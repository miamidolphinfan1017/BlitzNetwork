(function () {
  "use strict";

  const profileApi = window.BlitzProfile;
  const currentUser = profileApi && profileApi.getCurrentUser();
  const shell = document.getElementById("account-shell");
  const guest = document.getElementById("account-guest");
  const menu = document.getElementById("side-menu");
  const menuButton = document.getElementById("account-menu-toggle");
  const themeButton = document.getElementById("themeToggle");
  if (!currentUser || !profileApi) {
    guest.hidden = false;
    return;
  }

  shell.hidden = false;
  const profileForm = document.getElementById("profile-form");
  const displayInput = document.getElementById("profile-display-name");
  const bioInput = document.getElementById("profile-bio");
  const favoriteInput = document.getElementById("profile-favorite-team");
  const profileMessage = document.getElementById("profile-form-message");
  const avatarMessage = document.getElementById("avatar-message");
  const usernameMessage = document.getElementById("username-message");
  const teamMessage = document.getElementById("team-pfp-message");
  const teamSelect = document.getElementById("team-pfp-team");
  const avatarPreview = document.getElementById("profile-avatar-preview");
  let profile = profileApi.read(currentUser);
  let draftAvatar = profile.avatar || "";
  let draftPreset = profile.avatar ? "" : profile.avatarPreset || "default";
  let avatarIsDefault = !profile.avatar && (!profile.avatarPreset || profile.avatarPreset === "default");
  let teamDraft = "";
  let teamPfps = {};

  function setMessage(element, text, state) {
    element.textContent = text;
    if (state) element.dataset.state = state;
    else delete element.dataset.state;
  }

  function setThemeButton() {
    themeButton.textContent = document.documentElement.classList.contains("dark-mode") ? "Light" : "Dark";
  }

  function teamPfpsKey() {
    return `team_pfps_${currentUser}`;
  }

  function loadTeamPfps() {
    try {
      const saved = JSON.parse(localStorage.getItem(teamPfpsKey()) || "{}");
      if (!saved || typeof saved !== "object" || Array.isArray(saved)) throw new Error("Saved team pictures have an invalid format.");
      teamPfps = saved;
    } catch (error) {
      console.error("Unable to read saved personal team pictures:", error);
      teamPfps = {};
      setMessage(teamMessage, "Saved team images could not be read. You can replace them by saving a new image.", "error");
    }
  }

  function migrateTeamPfps() {
    const migratedKey = `team_pfps_migrated_${currentUser}`;
    if (localStorage.getItem(migratedKey)) return;
    try {
      if (!localStorage.getItem(teamPfpsKey())) {
        const legacy = JSON.parse(localStorage.getItem("team_pfps") || "{}");
        if (legacy && typeof legacy === "object" && !Array.isArray(legacy) && Object.keys(legacy).length) {
          localStorage.setItem(teamPfpsKey(), JSON.stringify(legacy));
        }
      }
      localStorage.setItem(migratedKey, "true");
    } catch (error) {
      console.error("Unable to migrate legacy team pictures to this account:", error);
    }
  }

  function setAvatarPreview(source, preset) {
    if (source) {
      avatarPreview.src = source;
    } else {
      avatarPreview.src = profileApi.avatarSource({
        displayName: displayInput.value.trim() || currentUser,
        avatarPreset: preset || "default"
      });
    }
    document.querySelectorAll(".avatar-preset").forEach(button => {
      button.setAttribute("aria-checked", String(button.dataset.preset === (preset || "default") && !source));
    });
  }

  function refreshOverview() {
    const userProfile = profileApi.read(currentUser);
    const displayName = userProfile.displayName || currentUser;
    const avatar = document.getElementById("account-avatar");
    avatar.src = profileApi.avatarSource({ ...userProfile, displayName });
    avatar.alt = `${displayName}'s profile picture`;
    document.getElementById("account-display-name").textContent = displayName;
    document.getElementById("account-username-label").textContent = `@${currentUser}`;
    document.getElementById("account-bio").textContent = userProfile.bio || "";
    const favoriteText = userProfile.favoriteTeam || "No favorite team selected";
    const favoriteName = document.getElementById("account-favorite-name");
    favoriteName.textContent = `Favorite team · ${favoriteText}`;
    const logo = document.getElementById("account-favorite-logo");
    const teamLogoAbbreviations = {
      cardinals: "ari", falcons: "atl", ravens: "bal", bills: "buf", panthers: "car", bears: "chi",
      bengals: "cin", browns: "cle", cowboys: "dal", broncos: "den", lions: "det", packers: "gb",
      texans: "hou", colts: "ind", jaguars: "jax", chiefs: "kc", raiders: "lv", chargers: "lac",
      rams: "lar", dolphins: "mia", vikings: "min", patriots: "ne", saints: "no", giants: "nyg",
      jets: "nyj", eagles: "phi", steelers: "pit", sf49ers: "sf", seahawks: "sea", buccaneers: "tb",
      titans: "ten", commanders: "wsh"
    };
    const abbreviation = teamLogoAbbreviations[userProfile.favoriteTeamId];
    logo.hidden = !abbreviation;
    logo.onerror = () => { logo.hidden = true; };
    if (abbreviation) logo.src = `https://a.espncdn.com/i/teamlogos/nfl/500/${abbreviation}.png`;
    const score = localStorage.getItem(`BestScore_${currentUser}`);
    document.getElementById("account-high-score").textContent = score === null ? "No quiz score yet" : `${score} / 25`;
    const favoriteLink = document.getElementById("account-favorite-link");
    favoriteLink.hidden = !userProfile.favoriteTeamId;
    if (userProfile.favoriteTeamId) favoriteLink.href = `Team-Details.html?id=${encodeURIComponent(userProfile.favoriteTeamId)}`;
    document.getElementById("account-username").value = currentUser;
    document.getElementById("profile-save-status").textContent = "Saved on this browser";
  }

  function loadProfileForm() {
    profile = profileApi.read(currentUser);
    displayInput.value = profile.displayName || "";
    bioInput.value = profile.bio || "";
    document.getElementById("profile-bio-count").textContent = String(bioInput.value.length);
    favoriteInput.value = profile.favoriteTeam || "";
    draftAvatar = profile.avatar || "";
    draftPreset = profile.avatar ? "" : profile.avatarPreset || "default";
    avatarIsDefault = !profile.avatar && (!profile.avatarPreset || profile.avatarPreset === "default");
    document.getElementById("profile-avatar-url").value = "";
    setAvatarPreview(draftAvatar, draftPreset);
    document.getElementById("favorite-team-current").textContent = profile.favoriteTeam || "No team selected";
    document.getElementById("profile-save-status").textContent = "";
    setMessage(profileMessage, "");
    setMessage(avatarMessage, "");
  }

  function addTeamOptions(select, includeNone) {
    select.replaceChildren();
    if (includeNone) {
      const none = document.createElement("option");
      none.value = "";
      none.textContent = "No favorite team";
      select.appendChild(none);
    }
    profileApi.teams.forEach(team => {
      const option = document.createElement("option");
      option.value = team.name;
      option.textContent = team.name;
      select.appendChild(option);
    });
  }

  function renderTeamPicture() {
    teamDraft = teamPfps[profileApi.teams.find(team => team.id === teamSelect.value)?.id] || "";
    const preview = document.getElementById("team-pfp-preview");
    preview.hidden = !teamDraft;
    preview.removeAttribute("src");
    if (teamDraft) preview.src = teamDraft;
    document.getElementById("team-pfp-empty").hidden = Boolean(teamDraft);
    document.getElementById("team-pfp-use").disabled = !teamDraft;
    document.getElementById("team-pfp-remove").disabled = !teamDraft;
    document.getElementById("team-pfp-url").value = "";
    document.getElementById("team-pfp-file").value = "";
    setMessage(teamMessage, "");
  }

  function imageFromUrl(rawUrl) {
    let parsed;
    try {
      parsed = new URL(rawUrl.trim());
    } catch {
      throw new Error("Enter a complete image URL.");
    }
    if (parsed.protocol !== "https:") throw new Error("Use an HTTPS image URL.");
    return parsed.href;
  }

  function loadImage(source) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("That image could not be loaded. Check the URL or choose another file."));
      image.src = source;
    });
  }

  async function prepareUpload(file) {
    const acceptedTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!acceptedTypes.includes(file.type)) throw new Error("Choose a PNG, JPEG, or WebP image.");
    if (file.size > 5 * 1024 * 1024) throw new Error("Choose an image smaller than 5 MB.");
    const objectUrl = URL.createObjectURL(file);
    try {
      const image = await loadImage(objectUrl);
      const canvas = document.createElement("canvas");
      const dimension = 256;
      canvas.width = dimension;
      canvas.height = dimension;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("This browser cannot process the selected image.");
      const scale = Math.max(dimension / image.naturalWidth, dimension / image.naturalHeight);
      const width = image.naturalWidth * scale;
      const height = image.naturalHeight * scale;
      context.drawImage(image, (dimension - width) / 2, (dimension - height) / 2, width, height);
      return canvas.toDataURL("image/jpeg", 0.82);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  async function handleUpload(input, isTeamImage) {
    const file = input.files && input.files[0];
    if (!file) return;
    const message = isTeamImage ? teamMessage : avatarMessage;
    setMessage(message, "Preparing image…");
    try {
      const source = await prepareUpload(file);
      if (isTeamImage) {
        teamDraft = source;
        renderTeamDraftPreview();
      } else {
        draftAvatar = source;
        draftPreset = "";
        avatarIsDefault = false;
        setAvatarPreview(draftAvatar, draftPreset);
      }
      setMessage(message, "Preview ready. Save to keep this image.");
    } catch (error) {
      setMessage(message, error.message, "error");
    } finally {
      input.value = "";
    }
  }

  function renderTeamDraftPreview() {
    const preview = document.getElementById("team-pfp-preview");
    preview.src = teamDraft;
    preview.hidden = !teamDraft;
    document.getElementById("team-pfp-empty").hidden = Boolean(teamDraft);
    document.getElementById("team-pfp-use").disabled = !teamDraft;
    document.getElementById("team-pfp-remove").disabled = !teamDraft;
  }

  function loadUrlPreview(input, isTeamImage) {
    const message = isTeamImage ? teamMessage : avatarMessage;
    let source;
    try {
      source = imageFromUrl(input.value);
    } catch (error) {
      setMessage(message, error.message, "error");
      return;
    }
    setMessage(message, "Checking image…");
    loadImage(source).then(() => {
      if (isTeamImage) {
        teamDraft = source;
        renderTeamDraftPreview();
      } else {
        draftAvatar = source;
        draftPreset = "";
        avatarIsDefault = false;
        setAvatarPreview(source, "");
      }
      setMessage(message, "Image verified. Save to keep this image.");
    }).catch(error => setMessage(message, error.message, "error"));
  }

  addTeamOptions(favoriteInput, true);
  addTeamOptions(teamSelect, false);
  migrateTeamPfps();
  loadTeamPfps();
  renderTeamPicture();
  loadProfileForm();
  refreshOverview();
  setThemeButton();

  document.getElementById("profile-bio").addEventListener("input", event => {
    document.getElementById("profile-bio-count").textContent = String(event.target.value.length);
  });
  displayInput.addEventListener("input", () => {
    if (!draftAvatar) setAvatarPreview("", draftPreset);
  });
  document.querySelectorAll(".avatar-preset").forEach(button => {
    button.addEventListener("click", () => {
      draftAvatar = "";
      draftPreset = button.dataset.preset;
      avatarIsDefault = draftPreset === "default";
      setAvatarPreview("", draftPreset);
      setMessage(avatarMessage, "Avatar preview selected. Save profile to keep it.");
    });
  });
  document.getElementById("profile-avatar-file").addEventListener("change", event => handleUpload(event.target, false));
  document.getElementById("team-pfp-file").addEventListener("change", event => handleUpload(event.target, true));
  document.getElementById("profile-avatar-load-url").addEventListener("click", () => loadUrlPreview(document.getElementById("profile-avatar-url"), false));
  document.getElementById("team-pfp-load-url").addEventListener("click", () => loadUrlPreview(document.getElementById("team-pfp-url"), true));
  document.getElementById("profile-avatar-reset").addEventListener("click", () => {
    draftAvatar = "";
    draftPreset = "default";
    avatarIsDefault = true;
    document.getElementById("profile-avatar-url").value = "";
    setAvatarPreview("", "default");
    setMessage(avatarMessage, "Default avatar selected. Save profile to apply it.");
  });

  favoriteInput.addEventListener("change", () => {
    document.getElementById("favorite-team-current").textContent = favoriteInput.value || "No team selected";
  });
  profileForm.addEventListener("submit", event => {
    event.preventDefault();
    const displayName = displayInput.value.trim();
    const bio = bioInput.value.trim();
    if (displayName.length > 32) {
      setMessage(profileMessage, "Display name must be 32 characters or fewer.", "error");
      displayInput.focus();
      return;
    }
    if (bio.length > 160) {
      setMessage(profileMessage, "Bio must be 160 characters or fewer.", "error");
      bioInput.focus();
      return;
    }
    try {
      profile = profileApi.save(currentUser, {
        displayName,
        bio,
        avatar: draftAvatar,
        avatarPreset: avatarIsDefault ? "default" : draftPreset || "default",
        favoriteTeam: favoriteInput.value
      });
      draftAvatar = profile.avatar || "";
      draftPreset = profile.avatar ? "" : profile.avatarPreset || "default";
      avatarIsDefault = !profile.avatar && draftPreset === "default";
      refreshOverview();
      setMessage(profileMessage, "Profile saved on this browser.");
      document.getElementById("profile-save-status").textContent = "Saved";
      setMessage(avatarMessage, "");
    } catch (error) {
      console.error("Unable to save profile changes:", error);
      setMessage(profileMessage, "Profile could not be saved. Check available browser storage and try again.", "error");
    }
  });

  document.getElementById("profile-cancel").addEventListener("click", loadProfileForm);
  document.getElementById("account-username").value = currentUser;
  document.getElementById("username-cancel").addEventListener("click", () => {
    document.getElementById("account-username").value = profileApi.getCurrentUser() || currentUser;
    setMessage(usernameMessage, "");
  });
  document.getElementById("username-form").addEventListener("submit", event => {
    event.preventDefault();
    const input = document.getElementById("account-username");
    const next = input.value.trim();
    if (!/^[A-Za-z0-9_.-]{3,24}$/.test(next)) {
      setMessage(usernameMessage, "Use 3–24 characters: letters, numbers, periods, underscores, or hyphens.", "error");
      input.focus();
      return;
    }
    if (next !== currentUser && !window.confirm(`Change your local account username from "${currentUser}" to "${next}"? Saved scores and profile data will be migrated in this browser.`)) return;
    try {
      profileApi.rename(next);
      setMessage(usernameMessage, "Username changed. Your local profile and saved records were migrated.");
      window.setTimeout(() => window.location.reload(), 400);
    } catch (error) {
      setMessage(usernameMessage, error.message, "error");
    }
  });

  teamSelect.addEventListener("change", renderTeamPicture);
  document.getElementById("team-pfp-save").addEventListener("click", () => {
    const team = profileApi.teams.find(item => item.id === teamSelect.value);
    if (!teamDraft || !team) {
      setMessage(teamMessage, "Choose or preview an image before saving.", "error");
      return;
    }
    const previous = teamPfps[team.id];
    try {
      teamPfps[team.id] = teamDraft;
      localStorage.setItem(teamPfpsKey(), JSON.stringify(teamPfps));
      renderTeamDraftPreview();
      setMessage(teamMessage, `${team.name} image saved for your account.`);
    } catch (error) {
      console.error("Unable to save personal team image:", error);
      if (previous) teamPfps[team.id] = previous;
      else delete teamPfps[team.id];
      setMessage(teamMessage, "Team image could not be saved. Try a smaller image or free browser storage.", "error");
    }
  });
  document.getElementById("team-pfp-use").addEventListener("click", () => {
    if (!teamDraft) return;
    draftAvatar = teamDraft;
    draftPreset = "";
    avatarIsDefault = false;
    setAvatarPreview(teamDraft, "");
    setMessage(teamMessage, "Avatar preview set. Save your profile to apply it.");
    profileForm.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  document.getElementById("team-pfp-remove").addEventListener("click", () => {
    const team = profileApi.teams.find(item => item.id === teamSelect.value);
    if (!team || !teamPfps[team.id]) return;
    const previous = teamPfps[team.id];
    try {
      delete teamPfps[team.id];
      localStorage.setItem(teamPfpsKey(), JSON.stringify(teamPfps));
      teamDraft = "";
      renderTeamPicture();
      setMessage(teamMessage, `${team.name} image removed.`);
    } catch (error) {
      console.error("Unable to remove personal team image:", error);
      teamPfps[team.id] = previous;
      setMessage(teamMessage, "Team image could not be removed from this browser.", "error");
    }
  });

  document.getElementById("account-logout").addEventListener("click", () => {
    if (!window.confirm("Log out of this browser? Your saved profile will remain here.")) return;
    localStorage.removeItem("currentUser");
    sessionStorage.removeItem("currentUser");
    window.BlitzAuth.sync();
    window.location.href = "Login.html";
  });
  document.getElementById("account-menu-toggle").addEventListener("click", () => {
    const open = menu.style.width !== "280px";
    menu.style.width = open ? "280px" : "0";
    menuButton.setAttribute("aria-expanded", String(open));
    menuButton.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
  });
  document.getElementById("account-menu-close").addEventListener("click", event => {
    event.preventDefault();
    menu.style.width = "0";
    menuButton.setAttribute("aria-expanded", "false");
    menuButton.setAttribute("aria-label", "Open navigation");
  });
  themeButton.addEventListener("click", () => {
    const dark = !document.documentElement.classList.contains("dark-mode");
    document.documentElement.classList.toggle("dark-mode", dark);
    document.documentElement.classList.toggle("light-mode", !dark);
    localStorage.setItem("theme", dark ? "dark-mode" : "light-mode");
    setThemeButton();
  });
  window.addEventListener("storage", event => {
    if (event.key === "registeredUsers" || event.key === "currentUser") {
      if (!profileApi.getCurrentUser()) window.location.href = "Login.html";
    }
    if (event.key === `profile_${currentUser}`) {
      loadProfileForm();
      refreshOverview();
    }
  });
  document.addEventListener("blitz-profile-changed", event => {
    if (event.detail.username === currentUser) {
      refreshOverview();
      if (event.detail.previousUsername) document.getElementById("account-username-label").textContent = `@${event.detail.username}`;
    }
  });
})();
