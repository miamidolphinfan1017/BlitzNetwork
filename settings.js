(function () {
  "use strict";

  const colorMap = {
    red: "#cc0000", blue: "#1f69d7", green: "#1fa654", purple: "#7d3ccf",
    orange: "#db7700", teal: "#0fa3a3", pink: "#d63d8f", gold: "#cf9f0a"
  };
  const user = window.BlitzProfile && window.BlitzProfile.getCurrentUser();
  const root = document.documentElement;
  const menu = document.getElementById("side-menu");
  const menuButton = document.getElementById("settings-menu-toggle");
  const themeButton = document.getElementById("themeToggle");
  const themeSwitch = document.getElementById("settings-theme-toggle");
  const textRange = document.getElementById("settings-text-size");
  const message = document.getElementById("settings-message");
  const preferenceButtons = {
    bold_text: document.getElementById("settings-bold-toggle"),
    high_contrast: document.getElementById("settings-contrast-toggle"),
    reduce_motion: document.getElementById("settings-motion-toggle")
  };

  function getValue(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return fallback;
      try { return JSON.parse(raw); } catch { return raw; }
    } catch (error) {
      console.error(`Unable to read setting "${key}":`, error);
      return fallback;
    }
  }

  function setValue(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function preferences() {
    const value = getValue("user_settings.preferences", {});
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  function setTheme(mode) {
    const dark = mode === "dark-mode";
    root.classList.toggle("dark-mode", dark);
    root.classList.toggle("light-mode", !dark);
    localStorage.setItem("theme", dark ? "dark-mode" : "light-mode");
    setValue("user_settings.theme", dark ? "dark-mode" : "light-mode");
    themeSwitch.setAttribute("aria-checked", String(dark));
    themeButton.textContent = dark ? "Light" : "Dark";
  }

  function setAccent(name, customColor) {
    const selectedColor = name === "custom" ? customColor : colorMap[name] || colorMap.red;
    root.style.setProperty("--accent-red", selectedColor);
    localStorage.setItem("settings_accent", selectedColor);
    setValue("user_settings.color_theme", name);
    if (name === "custom") localStorage.setItem("user_settings.custom_color", customColor);
    document.getElementById("settings-custom-color").value = selectedColor;
    document.querySelectorAll(".settings-color-swatch").forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.colorName === name));
    });
  }

  function setPreference(key, enabled) {
    const current = preferences();
    current[key] = enabled;
    setValue("user_settings.preferences", current);
    root.classList.toggle("blitz-bold-text", Boolean(current.bold_text));
    root.classList.toggle("blitz-high-contrast", Boolean(current.high_contrast));
    root.classList.toggle("blitz-reduce-motion", Boolean(current.reduce_motion));
    preferenceButtons[key].setAttribute("aria-checked", String(enabled));
  }

  function applyCurrentSettings() {
    const theme = localStorage.getItem("theme") || getValue("user_settings.theme", "light-mode");
    setTheme(theme);
    const accent = getValue("user_settings.color_theme", "red");
    const custom = localStorage.getItem("user_settings.custom_color") || "#cc0000";
    setAccent(colorMap[accent] ? accent : accent === "custom" ? "custom" : "red", custom);

    const storedSize = Number(getValue("user_settings.text_size", 16));
    const textSize = Number.isFinite(storedSize) ? Math.min(22, Math.max(14, storedSize)) : 16;
    textRange.value = String(textSize);
    document.getElementById("settings-text-output").value = `${textSize} px`;
    root.style.fontSize = `${textSize}px`;

    const currentPreferences = preferences();
    Object.keys(preferenceButtons).forEach(key => setPreference(key, Boolean(currentPreferences[key])));

    const name = document.getElementById("settings-account-name");
    const action = document.getElementById("settings-account-action");
    if (user) {
      const profile = window.BlitzProfile.read(user);
      name.textContent = `${profile.displayName || user} (@${user})`;
      action.textContent = "Manage profile →";
      action.href = "Account.html";
    } else {
      name.textContent = "Guest";
      action.textContent = "Log in →";
      action.href = "Login.html";
    }
  }

  function announce(text) {
    message.textContent = text;
    window.clearTimeout(announce.timer);
    announce.timer = window.setTimeout(() => { message.textContent = ""; }, 2400);
  }

  applyCurrentSettings();
  themeSwitch.addEventListener("click", () => {
    setTheme(root.classList.contains("dark-mode") ? "light-mode" : "dark-mode");
    announce("Theme saved on this browser.");
  });
  themeButton.addEventListener("click", () => {
    setTheme(root.classList.contains("dark-mode") ? "light-mode" : "dark-mode");
    announce("Theme saved on this browser.");
  });
  document.querySelectorAll(".settings-color-swatch").forEach(button => {
    button.addEventListener("click", () => {
      setAccent(button.dataset.colorName);
      announce("Accent color saved.");
    });
  });
  document.getElementById("settings-custom-color").addEventListener("input", event => {
    setAccent("custom", event.target.value);
    announce("Custom accent color saved.");
  });
  textRange.addEventListener("input", event => {
    const size = Number(event.target.value);
    root.style.fontSize = `${size}px`;
    document.getElementById("settings-text-output").value = `${size} px`;
    setValue("user_settings.text_size", size);
  });
  Object.keys(preferenceButtons).forEach(key => {
    preferenceButtons[key].addEventListener("click", () => {
      const enabled = preferenceButtons[key].getAttribute("aria-checked") !== "true";
      setPreference(key, enabled);
      announce("Display preference saved.");
    });
  });
  document.getElementById("settings-reset").addEventListener("click", () => {
    if (!window.confirm("Reset theme, accent, text size, and accessibility preferences? Your account and profile will not be changed.")) return;
    ["theme", "settings_accent", "user_settings.theme", "user_settings.color_theme", "user_settings.custom_color",
      "user_settings.text_size", "user_settings.preferences"].forEach(key => localStorage.removeItem(key));
    root.style.removeProperty("font-size");
    root.style.removeProperty("--accent-red");
    applyCurrentSettings();
    announce("Appearance preferences reset.");
  });
  document.getElementById("settings-menu-toggle").addEventListener("click", () => {
    const open = menu.style.width !== "280px";
    menu.style.width = open ? "280px" : "0";
    menuButton.setAttribute("aria-expanded", String(open));
    menuButton.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
  });
  document.getElementById("settings-menu-close").addEventListener("click", event => {
    event.preventDefault();
    menu.style.width = "0";
    menuButton.setAttribute("aria-expanded", "false");
    menuButton.setAttribute("aria-label", "Open navigation");
  });
  window.addEventListener("storage", event => {
    if (event.key === null || ["theme", "settings_accent", "user_settings.theme", "user_settings.color_theme",
      "user_settings.custom_color", "user_settings.text_size", "user_settings.preferences"].includes(event.key)) {
      applyCurrentSettings();
    }
    if (event.key === `profile_${user}`) applyCurrentSettings();
  });
})();
