(function () {
  "use strict";

  const teamNames = {
    ARI: "Arizona Cardinals", ATL: "Atlanta Falcons", BAL: "Baltimore Ravens", BUF: "Buffalo Bills",
    CAR: "Carolina Panthers", CHI: "Chicago Bears", CIN: "Cincinnati Bengals", CLE: "Cleveland Browns",
    DAL: "Dallas Cowboys", DEN: "Denver Broncos", DET: "Detroit Lions", GB: "Green Bay Packers",
    HOU: "Houston Texans", IND: "Indianapolis Colts", JAX: "Jacksonville Jaguars", KC: "Kansas City Chiefs",
    LAC: "Los Angeles Chargers", LAR: "Los Angeles Rams", LV: "Las Vegas Raiders", MIA: "Miami Dolphins",
    MIN: "Minnesota Vikings", NE: "New England Patriots", NO: "New Orleans Saints", NYG: "New York Giants",
    NYJ: "New York Jets", PHI: "Philadelphia Eagles", PIT: "Pittsburgh Steelers", SF: "San Francisco 49ers",
    SEA: "Seattle Seahawks", TB: "Tampa Bay Buccaneers", TEN: "Tennessee Titans", WAS: "Washington Commanders"
  };
  const categoryNames = {
    "regular-season": "Regular season",
    playoffs: "Playoffs",
    "super-bowl": "Super Bowl",
    team: "Team",
    player: "Player",
    stadium: "Stadium & game day",
    celebration: "Celebration"
  };
  const pageSize = 12;
  const elements = {
    category: document.getElementById("photo-category"),
    categoryFilter: document.getElementById("photo-category-filter"),
    clear: document.getElementById("photo-clear-filters"),
    empty: document.getElementById("photo-empty"),
    emptyAction: document.getElementById("photo-empty-action"),
    emptyCopy: document.getElementById("photo-empty-copy"),
    emptyHeading: document.getElementById("photo-empty-heading"),
    grid: document.getElementById("photo-grid"),
    loadMore: document.getElementById("photo-load-more"),
    resultCategory: document.getElementById("photo-result-category"),
    resultCount: document.getElementById("photo-result-count"),
    resultsHeading: document.getElementById("photo-results-heading"),
    search: document.getElementById("photo-search"),
    seasonContext: document.getElementById("season-context"),
    seasonNav: document.getElementById("season-nav"),
    team: document.getElementById("photo-team"),
    totalSummary: document.getElementById("photo-archive-summary"),
    coverageNote: document.getElementById("photo-coverage-note"),
    viewer: document.getElementById("photo-viewer"),
    viewerAttribution: document.getElementById("viewer-attribution"),
    viewerCaption: document.getElementById("viewer-caption"),
    viewerClose: document.getElementById("viewer-close"),
    viewerImage: document.getElementById("viewer-image"),
    viewerImageFallback: document.getElementById("viewer-image-fallback"),
    viewerNext: document.getElementById("viewer-next"),
    viewerPrev: document.getElementById("viewer-prev"),
    viewerSeason: document.getElementById("viewer-season-label"),
    viewerSource: document.getElementById("viewer-source-link"),
    viewerTags: document.getElementById("viewer-tags")
  };

  let photos = [];
  let selectedSeason = new Date().getFullYear();
  let visiblePhotos = [];
  let visibleCount = pageSize;
  let activePhotoIndex = -1;
  const imageFailures = new Set();

  function setGalleryError(message) {
    elements.grid.replaceChildren();
    elements.empty.hidden = false;
    elements.emptyHeading.textContent = "Photo archive unavailable";
    elements.emptyCopy.textContent = message;
    elements.emptyAction.hidden = true;
    elements.resultCount.textContent = "The photo data could not be loaded.";
    console.error(message);
  }

  function normalizePhotos(input) {
    const validPhotos = [];
    const seenIds = new Set();
    const seenImages = new Set();

    input.forEach((photo, index) => {
      const valid = photo && typeof photo.id === "string" && photo.id.trim() &&
        typeof photo.image === "string" && photo.image.trim() &&
        Number.isInteger(photo.season) && photo.season >= 2020 &&
        typeof photo.caption === "string" && photo.caption.trim() &&
        Array.isArray(photo.teams) && Array.isArray(photo.players) &&
        Array.isArray(photo.categories || [photo.category]);
      if (!valid) {
        console.error(`Skipping invalid photo record at manifest index ${index}.`);
        return;
      }

      let imageUrl;
      try {
        imageUrl = new URL(photo.image, document.baseURI);
      } catch (error) {
        console.error(`Skipping photo "${photo.id}" because its image URL is invalid.`, error);
        return;
      }
      if (imageUrl.protocol !== "https:" &&
          !(imageUrl.protocol === location.protocol && imageUrl.origin === location.origin)) {
        console.error(`Skipping photo "${photo.id}" because its image URL is not a safe web URL.`);
        return;
      }
      if (seenIds.has(photo.id) || seenImages.has(imageUrl.href)) {
        console.warn(`Ignoring duplicate photo record "${photo.id}".`);
        return;
      }
      if (photo.sourceUrl) {
        try {
          if (new URL(photo.sourceUrl).protocol !== "https:") throw new Error("Source links must use HTTPS.");
        } catch (error) {
          console.error(`Skipping photo "${photo.id}" because its source URL is invalid.`, error);
          return;
        }
      }

      const categories = Array.isArray(photo.categories) ? photo.categories : [photo.category];
      if (!categories.length || categories.some(category => !categoryNames[category])) {
        console.error(`Skipping photo "${photo.id}" because its category is missing or unsupported.`);
        return;
      }
      if (photo.week !== undefined && (!Number.isInteger(photo.week) || photo.week < 1 || photo.week > 22)) {
        console.error(`Skipping photo "${photo.id}" because its NFL week is invalid.`);
        return;
      }
      if (photo.teams.some(team => !teamNames[team])) {
        console.error(`Skipping photo "${photo.id}" because it contains an unknown team ID.`);
        return;
      }

      seenIds.add(photo.id);
      seenImages.add(imageUrl.href);
      validPhotos.push({ ...photo, categories });
    });
    return validPhotos;
  }

  function formatSeason(season) {
    return `${season} NFL season`;
  }

  function seasonCount(season) {
    return photos.reduce((count, photo) => count + (photo.season === season ? 1 : 0), 0);
  }

  function renderSeasonNavigation() {
    const currentYear = new Date().getFullYear();
    const latestPhotoSeason = photos.reduce((latest, photo) => Math.max(latest, photo.season), 2020);
    const lastSeason = Math.max(currentYear, latestPhotoSeason);
    const seasons = [];

    for (let year = 2020; year <= lastSeason; year += 1) seasons.push(year);
    elements.seasonNav.replaceChildren();

    seasons.forEach(season => {
      const count = seasonCount(season);
      const button = document.createElement("button");
      const year = document.createElement("span");
      const detail = document.createElement("small");
      button.type = "button";
      button.className = "season-nav-button";
      button.dataset.season = String(season);
      button.setAttribute("aria-pressed", String(season === selectedSeason));
      button.setAttribute("aria-label", `${formatSeason(season)}, ${count} ${count === 1 ? "photo" : "photos"}`);
      year.textContent = String(season);
      detail.textContent = count ? `${count} ${count === 1 ? "photo" : "photos"}` : "No photos";
      button.append(year, detail);
      button.addEventListener("click", () => {
        selectedSeason = season;
        renderSeasonNavigation();
        renderGallery();
      });
      elements.seasonNav.appendChild(button);
    });
  }

  function populateFilters() {
    const categories = new Set();
    photos.forEach(photo => {
      photo.categories.forEach(category => categories.add(category));
    });

    Object.keys(teamNames).sort((first, second) => teamNames[first].localeCompare(teamNames[second])).forEach(team => {
      const option = document.createElement("option");
      option.value = team;
      option.textContent = teamNames[team];
      elements.team.appendChild(option);
    });

    if (categories.size > 1) {
      [...categories].sort((first, second) => categoryNames[first].localeCompare(categoryNames[second])).forEach(category => {
        const option = document.createElement("option");
        option.value = category;
        option.textContent = categoryNames[category];
        elements.category.appendChild(option);
      });
      elements.categoryFilter.hidden = false;
    }
  }

  function updateSummary() {
    const seasonsWithPhotos = [...new Set(photos.map(photo => photo.season))].sort((a, b) => a - b);
    const seasonPhrase = seasonsWithPhotos.length === 1
      ? `photos from the ${seasonsWithPhotos[0]} NFL season`
      : `photos across ${seasonsWithPhotos.length} NFL seasons`;
    elements.totalSummary.textContent = `${photos.length} ${photos.length === 1 ? "photo" : "photos"} · ${seasonPhrase}`;
    elements.coverageNote.textContent = seasonsWithPhotos.length
      ? `The manifest currently has ${photos.length} ${photos.length === 1 ? "photo" : "photos"} in ${seasonsWithPhotos.map(formatSeason).join(", ")}. Other season buttons are kept available from 2020 through the current year and show an empty state until verified photos are added.`
      : "There are no verified photo records in the manifest yet. Seasons from 2020 through the current year remain available and will show empty states until photos are added.";
  }

  function photoSearchText(photo) {
    const teamText = photo.teams.map(team => teamNames[team]).join(" ");
    const playerText = photo.players.join(" ");
    return `${photo.season} ${formatSeason(photo.season)} ${photo.week ? `week ${photo.week}` : ""} ${photo.caption} ${teamText} ${playerText} ${photo.event || ""}`.toLocaleLowerCase();
  }

  function getMatchingPhotos() {
    const query = elements.search.value.trim().toLocaleLowerCase();
    const team = elements.team.value;
    const category = elements.category.value;
    return photos
      .filter(photo => photo.season === selectedSeason)
      .filter(photo => !team || photo.teams.includes(team))
      .filter(photo => !category || photo.categories.includes(category))
      .filter(photo => !query || photoSearchText(photo).includes(query))
      .sort((first, second) => (first.week || 0) - (second.week || 0));
  }

  function createPhotoCard(photo, index) {
    const article = document.createElement("article");
    const imageButton = document.createElement("button");
    const image = document.createElement("img");
    const fallback = document.createElement("span");
    const caption = document.createElement("p");
    const metadata = document.createElement("p");
    const byline = document.createElement("p");
    const imageFrame = document.createElement("span");
    const teamLabel = photo.teams.map(team => teamNames[team]).join(" · ");

    article.className = "photo-entry";
    imageButton.type = "button";
    imageButton.className = "photo-image-button";
    imageButton.setAttribute("aria-label", `Open photo: ${photo.caption}`);
    imageFrame.className = "photo-image-frame";
    if (imageFailures.has(photo.id)) imageFrame.classList.add("has-error");
    image.src = photo.image;
    image.alt = photo.caption;
    image.loading = index < 4 ? "eager" : "lazy";
    image.decoding = "async";
    if (index === 0) image.fetchPriority = "high";
    image.addEventListener("error", () => {
      imageFailures.add(photo.id);
      imageFrame.classList.add("has-error");
    }, { once: true });
    fallback.className = "photo-image-fallback";
    fallback.setAttribute("aria-hidden", "true");
    fallback.textContent = "Photo unavailable";
    imageFrame.append(image, fallback);
    imageButton.appendChild(imageFrame);
    imageButton.addEventListener("click", () => openViewer(photo));

    caption.className = "photo-caption";
    caption.textContent = photo.caption;
    metadata.className = "photo-entry-meta";
    metadata.textContent = [photo.week ? `Week ${photo.week}` : null, teamLabel].filter(Boolean).join(" · ");
    byline.className = "photo-entry-source";
    byline.textContent = photo.sourceName ? `Photo source: ${photo.sourceName}` : "";
    if (!photo.sourceName) byline.hidden = true;
    article.append(imageButton, caption, metadata, byline);
    return article;
  }

  function renderGallery() {
    visiblePhotos = getMatchingPhotos();
    visibleCount = pageSize;
    elements.grid.replaceChildren();
    elements.empty.hidden = visiblePhotos.length > 0;
    elements.emptyAction.hidden = false;
    elements.loadMore.hidden = true;
    elements.resultsHeading.textContent = formatSeason(selectedSeason);
    elements.seasonContext.textContent = `${seasonCount(selectedSeason)} ${seasonCount(selectedSeason) === 1 ? "photo" : "photos"}`;

    const selectedCategories = new Set(photos
      .filter(photo => photo.season === selectedSeason)
      .flatMap(photo => photo.categories));
    elements.resultCategory.textContent = elements.category.value
      ? categoryNames[elements.category.value]
      : selectedCategories.size === 1
        ? categoryNames[[...selectedCategories][0]]
        : selectedCategories.size > 1 ? "Multiple categories" : "";
    elements.resultCategory.hidden = !elements.resultCategory.textContent;

    if (!visiblePhotos.length) {
      const hasSeasonPhotos = seasonCount(selectedSeason) > 0;
      elements.emptyHeading.textContent = hasSeasonPhotos ? "No photos match these filters" : `No photos available for ${selectedSeason}`;
      elements.emptyCopy.textContent = hasSeasonPhotos
        ? "Try another team or search term, or clear the filters to see this season’s photos."
        : "There are no verified photos for this NFL season in the archive yet. Choose another season above to browse available photos.";
      elements.emptyAction.hidden = !elements.search.value && !elements.team.value && !elements.category.value;
    } else {
      appendPhotoPage();
    }
    elements.resultCount.textContent = `${visiblePhotos.length} ${visiblePhotos.length === 1 ? "photo" : "photos"}${elements.search.value || elements.team.value || elements.category.value ? " match your filters" : " in this season"}`;
  }

  function appendPhotoPage() {
    const nextPhotos = visiblePhotos.slice(elements.grid.childElementCount, visibleCount);
    nextPhotos.forEach(photo => {
      elements.grid.appendChild(createPhotoCard(photo, elements.grid.childElementCount));
    });
    elements.loadMore.hidden = elements.grid.childElementCount >= visiblePhotos.length;
    elements.loadMore.textContent = `Load more photos (${visiblePhotos.length - elements.grid.childElementCount} remaining)`;
  }

  function updateViewerPhoto() {
    const photo = visiblePhotos[activePhotoIndex];
    if (!photo) return;
    elements.viewerImage.hidden = false;
    elements.viewerImageFallback.hidden = true;
    elements.viewerImage.alt = photo.caption;
    elements.viewerImage.onerror = () => {
      elements.viewerImage.hidden = true;
      elements.viewerImageFallback.hidden = false;
    };
    elements.viewerImage.src = photo.image;
    elements.viewerCaption.textContent = photo.caption;
    elements.viewerSeason.textContent = formatSeason(photo.season);
    const categoryText = photo.categories.map(category => categoryNames[category]).join(", ");
    const teamText = photo.teams.map(team => teamNames[team]).join(" · ");
    const playerText = photo.players.length ? `Players: ${photo.players.join(", ")}` : "";
    elements.viewerTags.textContent = [
      photo.week ? `Week ${photo.week}` : null,
      categoryText,
      teamText,
      playerText
    ].filter(Boolean).join("  /  ");
    elements.viewerAttribution.textContent = photo.attribution || `Source: ${photo.sourceName || "not listed in the original archive"}.`;
    elements.viewerSource.hidden = !photo.sourceUrl;
    if (photo.sourceUrl) elements.viewerSource.href = photo.sourceUrl;
    else elements.viewerSource.removeAttribute("href");
    elements.viewerPrev.disabled = visiblePhotos.length < 2;
    elements.viewerNext.disabled = visiblePhotos.length < 2;
  }

  function openViewer(photo) {
    activePhotoIndex = visiblePhotos.indexOf(photo);
    updateViewerPhoto();
    elements.viewer.showModal();
  }

  function stepViewer(direction) {
    if (visiblePhotos.length < 2) return;
    activePhotoIndex = (activePhotoIndex + direction + visiblePhotos.length) % visiblePhotos.length;
    updateViewerPhoto();
  }

  function clearFilters() {
    elements.search.value = "";
    elements.team.value = "";
    elements.category.value = "";
    renderGallery();
    elements.search.focus();
  }

  elements.search.addEventListener("input", renderGallery);
  elements.team.addEventListener("change", renderGallery);
  elements.category.addEventListener("change", renderGallery);
  elements.clear.addEventListener("click", clearFilters);
  elements.emptyAction.addEventListener("click", clearFilters);
  elements.loadMore.addEventListener("click", () => {
    visibleCount += pageSize;
    appendPhotoPage();
  });
  elements.viewerClose.addEventListener("click", () => elements.viewer.close());
  elements.viewerPrev.addEventListener("click", () => stepViewer(-1));
  elements.viewerNext.addEventListener("click", () => stepViewer(1));
  elements.viewer.addEventListener("click", event => {
    if (event.target === elements.viewer) elements.viewer.close();
  });
  document.addEventListener("keydown", event => {
    if (!elements.viewer.open) return;
    if (event.key === "Escape") {
      elements.viewer.close();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      stepViewer(-1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      stepViewer(1);
    }
  });

  window.toggleMenu = function () {
    const menu = document.getElementById("side-menu");
    const button = document.querySelector(".menu-btn");
    const open = menu.style.width !== "280px";
    menu.style.width = open ? "280px" : "0";
    button.setAttribute("aria-expanded", String(open));
    button.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
  };

  window.toggleTheme = function () {
    const root = document.documentElement;
    const dark = !root.classList.contains("dark-mode");
    root.classList.toggle("dark-mode", dark);
    root.classList.toggle("light-mode", !dark);
    localStorage.setItem("theme", dark ? "dark-mode" : "light-mode");
    document.getElementById("themeToggle").textContent = dark ? "Light" : "Dark";
  };

  window.addEventListener("storage", event => {
    if (event.key === "theme") {
      document.getElementById("themeToggle").textContent =
        document.documentElement.classList.contains("dark-mode") ? "Light" : "Dark";
    }
  });

  document.getElementById("themeToggle").textContent =
    document.documentElement.classList.contains("dark-mode") ? "Light" : "Dark";

  if (!Array.isArray(window.BLITZ_PHOTOS)) {
    setGalleryError("Photo data is missing. Check that photos-data.js is available and reload the page.");
    return;
  }

  photos = normalizePhotos(window.BLITZ_PHOTOS);
  const skippedCount = window.BLITZ_PHOTOS.length - photos.length;
  const availableSeasons = photos.map(photo => photo.season);
  if (availableSeasons.length && !availableSeasons.includes(selectedSeason)) {
    selectedSeason = Math.max(...availableSeasons);
  }
  renderSeasonNavigation();
  populateFilters();
  updateSummary();
  renderGallery();
  if (skippedCount > 0) {
    elements.resultCount.textContent += ` ${skippedCount} invalid or duplicate manifest ${skippedCount === 1 ? "entry was" : "entries were"} excluded.`;
  }
})();
