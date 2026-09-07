(function () {
  const root = document.documentElement;

  function getJson(key, fallback) {
    const value = localStorage.getItem(key);
    if (value === null) return fallback;
    try { return JSON.parse(value); } catch { return value; }
  }

  function applyThemeMode() {
    const mode = getJson("user_settings.theme", localStorage.getItem("theme") || "light-mode");
    root.classList.remove("light-mode", "dark-mode");
    root.classList.add(mode === "dark-mode" ? "dark-mode" : "light-mode");
  }

  function applyAccent() {
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
  }

  applyThemeMode();
  applyAccent();
  window.addEventListener("storage", function (event) {
    if (event.key === null || event.key.indexOf("user_settings.") === 0 || event.key === "settings_accent" || event.key === "theme") {
      applyThemeMode();
      applyAccent();
    }
  });
})();
