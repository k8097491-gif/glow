(function (root) {
  "use strict";

  var Petropavl = root.Petropavl = root.Petropavl || {};
  var config = Petropavl.config;
  var api = Petropavl.api;
  var globe = null;
  var state = {
    layerCounts: { buildings: 0, roads: 0, water: 0 },
    layerRequests: {},
    searchController: null,
    routeController: null,
    routeOpen: false,
    routePicking: null,
    origin: null,
    destination: null,
    toastTimer: null,
    started: false
  };

  var app = document.getElementById("app");
  var searchForm = document.getElementById("place-search");
  var searchInput = document.getElementById("search-input");
  var searchButton = searchForm.querySelector('button[type="submit"]');
  var searchResults = document.getElementById("search-results");
  var connectionState = document.getElementById("connection-state");
  var connectionLabel = document.getElementById("connection-label");
  var loadingState = document.getElementById("loading-state");
  var loadingCopy = document.getElementById("loading-copy");
  var toast = document.getElementById("toast");
  var cursorCoordinates = document.getElementById("cursor-coordinates");
  var layerStatus = document.getElementById("layer-status");
  var layerTotal = document.getElementById("layer-total");
  var featurePanel = document.getElementById("feature-panel");
  var featureTitle = document.getElementById("feature-title");
  var featureKind = document.getElementById("feature-kind");
  var featureDetails = document.getElementById("feature-details");
  var routePanel = document.getElementById("route-panel");
  var routeToggle = document.getElementById("route-toggle");
  var routeStatus = document.getElementById("route-status");
  var routeFromLabel = document.getElementById("route-from-label");
  var routeToLabel = document.getElementById("route-to-label");
  var routeBuildButton = document.getElementById("route-build");
  var routeResult = document.getElementById("route-result");
  var routeDistance = document.getElementById("route-distance");
  var routeDuration = document.getElementById("route-duration");
  var script = document.getElementById("cesium-runtime");

  function formatCoordinate(value, positive, negative) {
    var direction = value < 0 ? negative : positive;
    return Math.abs(value).toFixed(5) + "° " + direction;
  }

  function coordinateText(point) {
    if (!point || !Number.isFinite(Number(point.latitude)) || !Number.isFinite(Number(point.longitude))) return "Не указано";
    return formatCoordinate(Number(point.latitude), "N", "S") + " · " + formatCoordinate(Number(point.longitude), "E", "W");
  }

  function shortCoordinate(point) {
    return Number(point.latitude).toFixed(4) + "°, " + Number(point.longitude).toFixed(4) + "°";
  }

  function showToast(message) {
    toast.textContent = message;
    toast.hidden = false;
    if (state.toastTimer) root.clearTimeout(state.toastTimer);
    state.toastTimer = root.setTimeout(function () { toast.hidden = true; }, 4800);
  }

  function setConnection(status, message) {
    connectionState.dataset.state = status;
    connectionLabel.textContent = message;
  }

  function addFeatureRow(label, value) {
    var row = document.createElement("div");
    var term = document.createElement("dt");
    var description = document.createElement("dd");
    term.textContent = label;
    description.textContent = value || "Нет данных в OpenStreetMap";
    row.appendChild(term);
    row.appendChild(description);
    featureDetails.appendChild(row);
  }

  function clearFeature() {
    featurePanel.hidden = true;
    featureDetails.textContent = "";
  }

  function categoryLabel(meta) {
    var value = meta.category;
    var translations = {
      house: "жилой дом",
      apartments: "многоквартирный дом",
      residential: "жилой объект",
      commercial: "коммерческое здание",
      retail: "магазин",
      school: "школа",
      hospital: "больница",
      church: "церковь",
      primary: "главная улица",
      secondary: "дорога второго порядка",
      residential_road: "жилой проезд",
      river: "река",
      stream: "ручей",
      water: "водоём",
      wetland: "болотистая местность",
      reservoir: "водохранилище"
    };
    return translations[value] || value || "Не указано в OSM";
  }

  function renderFeature(meta) {
    if (!meta) {
      clearFeature();
      return;
    }
    featureDetails.textContent = "";
    featureTitle.textContent = meta.name || "Объект без названия";
    featureKind.textContent = meta.kind === "building" ? "Здание из OpenStreetMap"
      : meta.kind === "road" ? "Дорога из OpenStreetMap"
        : meta.kind === "water" ? "Водный объект из OpenStreetMap"
          : meta.kind === "search" ? "Результат поиска OpenStreetMap"
            : meta.kind === "route" ? "Маршрут по дорожной сети"
              : "Объект карты";

    if (meta.kind === "route") {
      addFeatureRow("Источник", "OpenStreetMap · OSRM");
      featurePanel.hidden = false;
      return;
    }

    addFeatureRow("Категория", categoryLabel(meta));
    addFeatureRow("Адрес", meta.address || "Нет данных в OpenStreetMap");

    if (meta.kind === "building") {
      if (meta.levels) addFeatureRow("Этажность", String(meta.levels) + " · тег OpenStreetMap");
      else addFeatureRow("Этажность", "Нет данных в OpenStreetMap");
      if (meta.height) {
        var heightText = meta.height.meters.toLocaleString("ru-RU", { maximumFractionDigits: 1 }) + " м";
        if (meta.height.source === "height tag") heightText += " · указано в OSM";
        else heightText = "≈ " + heightText + " · оценка по доступным тегам и контуру";
        addFeatureRow("Высота", heightText);
      }
    }

    addFeatureRow("Координаты", coordinateText(meta));
    if (meta.id) addFeatureRow("Объект OSM", String(meta.osmType || "way") + "/" + String(meta.id));
    featurePanel.hidden = false;
  }

  function hideSearchResults() {
    searchResults.hidden = true;
    searchInput.setAttribute("aria-expanded", "false");
  }

  function showSearchMessage(message) {
    searchResults.textContent = "";
    var empty = document.createElement("div");
    empty.className = "search-empty";
    empty.textContent = message;
    searchResults.appendChild(empty);
    searchResults.hidden = false;
    searchInput.setAttribute("aria-expanded", "true");
  }

  function getAddress(result) {
    var address = result.address || {};
    var parts = [];
    [address.road, address.house_number, address.suburb, address.village, address.town, address.city, address.state].forEach(function (part) {
      if (part && parts.indexOf(part) === -1) parts.push(part);
    });
    return parts.length ? parts.join(", ") : null;
  }

  function resultCategory(result) {
    var address = result.address || {};
    return result.type || result.class || address.amenity || address.building || "географическое место";
  }

  function selectSearchResult(result) {
    var place = {
      latitude: Number(result.lat),
      longitude: Number(result.lon),
      name: result.name || result.display_name || "Найденное место",
      category: resultCategory(result),
      address: getAddress(result) || result.display_name,
      osmType: result.osm_type,
      id: result.osm_id,
      altitude: /city|town|village|hamlet|suburb/.test(result.type || "") ? 10000 : 1700
    };
    hideSearchResults();
    if (globe) globe.showPlace(place);
    renderFeature({
      kind: "search",
      name: place.name,
      category: place.category,
      address: place.address,
      latitude: place.latitude,
      longitude: place.longitude,
      osmType: place.osmType,
      id: place.id
    });
    if (searchInput.value.trim() !== place.name) searchInput.value = place.name;
  }

  function renderSearchResults(results) {
    searchResults.textContent = "";
    if (!results.length) {
      showSearchMessage("В Казахстане ничего не найдено. Попробуйте другой адрес или название.");
      return;
    }
    results.forEach(function (result) {
      var button = document.createElement("button");
      var name = document.createElement("strong");
      var detail = document.createElement("small");
      button.type = "button";
      button.setAttribute("role", "option");
      name.textContent = result.name || result.display_name || "Место без названия";
      detail.textContent = (result.display_name || "Казахстан") + " · " + Number(result.lat).toFixed(4) + ", " + Number(result.lon).toFixed(4);
      button.appendChild(name);
      button.appendChild(detail);
      button.addEventListener("click", function () { selectSearchResult(result); });
      searchResults.appendChild(button);
    });
    searchResults.hidden = false;
    searchInput.setAttribute("aria-expanded", "true");
  }

  async function submitSearch(query) {
    var value = String(query || "").trim();
    if (value.length < 2) {
      showSearchMessage("Введите не меньше двух символов.");
      return;
    }
    if (state.searchController) state.searchController.abort();
    state.searchController = new AbortController();
    var controller = state.searchController;
    searchButton.disabled = true;
    searchButton.textContent = "Ищем…";
    showSearchMessage("Ищем в OpenStreetMap…");
    try {
      var results = await api.searchLocations(value, controller.signal);
      if (controller.signal.aborted) return;
      renderSearchResults(results);
    } catch (error) {
      if (error.name !== "AbortError") {
        showSearchMessage(error.message || "Поиск временно недоступен.");
      }
    } finally {
      if (state.searchController === controller) {
        state.searchController = null;
        searchButton.disabled = false;
        searchButton.textContent = "Найти";
      }
    }
  }

  function updateLayerTotal() {
    var total = state.layerCounts.buildings + state.layerCounts.roads + state.layerCounts.water;
    layerTotal.textContent = total.toLocaleString("ru-RU") + " объектов";
  }

  function layerLabel(name) {
    return config.layers[name] ? config.layers[name].label.toLocaleLowerCase("ru-RU") : "слой";
  }

  async function toggleLayer(name, visible, input) {
    if (!visible) {
      if (state.layerRequests[name]) state.layerRequests[name].abort();
      if (globe) globe.setLayerVisible(name, false);
      if (state.layerCounts[name]) layerStatus.textContent = "Слой «" + layerLabel(name) + "» скрыт. Данные останутся доступны в этой вкладке.";
      else layerStatus.textContent = "Слой «" + layerLabel(name) + "» выключен.";
      return;
    }

    var controller = new AbortController();
    state.layerRequests[name] = controller;
    layerStatus.textContent = "Загружаем " + layerLabel(name) + " Петропавла из OpenStreetMap…";
    input.setAttribute("aria-busy", "true");
    try {
      var data = await api.fetchLayer(name, controller.signal);
      if (controller.signal.aborted || !input.checked) return;
      var count = globe.loadLayer(name, data.elements);
      globe.setLayerVisible(name, true);
      state.layerCounts[name] = count;
      updateLayerTotal();
      layerStatus.textContent = count.toLocaleString("ru-RU") + " объектов в городском фрагменте. Геометрия из OSM; точные высоты есть не у всех зданий.";
    } catch (error) {
      if (error.name !== "AbortError") {
        input.checked = false;
        layerStatus.textContent = error.message || "Не удалось загрузить слой.";
        showToast("Слой не загрузился. Проверьте соединение и попробуйте ещё раз.");
      }
    } finally {
      if (state.layerRequests[name] === controller) {
        delete state.layerRequests[name];
        input.removeAttribute("aria-busy");
      }
    }
  }

  function formatDistance(meters) {
    if (meters < 1000) return Math.round(meters).toLocaleString("ru-RU") + " м";
    return (meters / 1000).toLocaleString("ru-RU", { maximumFractionDigits: 1 }) + " км";
  }

  function formatDuration(seconds) {
    var minutes = Math.max(1, Math.round(seconds / 60));
    if (minutes < 60) return minutes + " мин";
    var hours = Math.floor(minutes / 60);
    var rest = minutes % 60;
    return rest ? hours + " ч " + rest + " мин" : hours + " ч";
  }

  function updateRouteLabels() {
    routeFromLabel.textContent = state.origin ? state.origin.label : "Не выбрано";
    routeToLabel.textContent = state.destination ? state.destination.label : "Не выбрано";
    routeBuildButton.disabled = !state.origin || !state.destination || Boolean(state.routeController);
    if (globe) globe.setRouteMarkers(state.origin, state.destination);
    routeResult.hidden = true;
  }

  function setRouteOpen(open) {
    state.routeOpen = open;
    routePanel.hidden = !open;
    routeToggle.setAttribute("aria-expanded", open ? "true" : "false");
    document.getElementById("route-toggle-mobile").setAttribute("aria-expanded", open ? "true" : "false");
    app.dataset.routeOpen = open ? "true" : "false";
    if (!open) {
      state.routePicking = null;
      app.classList.remove("is-picking-route");
      document.querySelectorAll("[data-route-pick]").forEach(function (button) { button.setAttribute("aria-pressed", "false"); });
    }
  }

  function handleMapClick(meta, coordinate) {
    if (state.routePicking) {
      if (!coordinate) {
        routeStatus.textContent = "Не удалось определить точку. Нажмите на видимую часть карты.";
        return;
      }
      var point = {
        latitude: Number(coordinate.latitude),
        longitude: Number(coordinate.longitude),
        label: meta && meta.name ? meta.name : shortCoordinate(coordinate)
      };
      if (state.routeController) {
        state.routeController.abort();
        state.routeController = null;
      }
      if (state.routePicking === "origin") state.origin = point;
      else state.destination = point;
      state.routePicking = null;
      app.classList.remove("is-picking-route");
      document.querySelectorAll("[data-route-pick]").forEach(function (button) { button.setAttribute("aria-pressed", "false"); });
      updateRouteLabels();
      routeStatus.textContent = state.origin && state.destination ? "Точки указаны. Выберите способ и постройте маршрут." : "Точка добавлена. Укажите вторую точку на карте.";
      return;
    }
    renderFeature(meta);
  }

  function setRoutePicking(endpoint) {
    state.routePicking = endpoint;
    app.classList.add("is-picking-route");
    document.querySelectorAll("[data-route-pick]").forEach(function (button) {
      button.setAttribute("aria-pressed", button.dataset.routePick === endpoint ? "true" : "false");
    });
    var label = endpoint === "origin" ? "начало" : "финиш";
    routeStatus.textContent = "Кликните на карту, чтобы указать " + label + " маршрута.";
    routePanel.hidden = false;
  }

  async function buildRoute() {
    if (!state.origin || !state.destination || state.routeController) return;
    state.routeController = new AbortController();
    var controller = state.routeController;
    routeBuildButton.disabled = true;
    routeBuildButton.textContent = "Считаем маршрут…";
    routeStatus.textContent = "Сервис ищет путь по OpenStreetMap…";
    routeResult.hidden = true;
    try {
      var result = await api.fetchRoute(state.origin, state.destination, document.getElementById("route-mode").value, controller.signal);
      if (controller.signal.aborted) return;
      globe.drawRoute(result, state.origin, state.destination);
      globe.fitRoute();
      routeDistance.textContent = formatDistance(result.route.distance);
      routeDuration.textContent = formatDuration(result.route.duration) + " · расчётное время";
      routeResult.hidden = false;
      routeStatus.textContent = "Маршрут рассчитан по доступной дорожной сети." + (result.dataVersion ? " Данные OSM на " + result.dataVersion.slice(0, 10) + "." : "");
    } catch (error) {
      if (error.name !== "AbortError") routeStatus.textContent = error.message || "Не удалось построить маршрут.";
    } finally {
      if (state.routeController === controller) {
        state.routeController = null;
        routeBuildButton.textContent = "Построить маршрут";
        routeBuildButton.disabled = !state.origin || !state.destination;
      }
    }
  }

  function resetRoute() {
    if (state.routeController) state.routeController.abort();
    state.routeController = null;
    state.origin = null;
    state.destination = null;
    state.routePicking = null;
    app.classList.remove("is-picking-route");
    document.querySelectorAll("[data-route-pick]").forEach(function (button) { button.setAttribute("aria-pressed", "false"); });
    if (globe) globe.clearRoute();
    routeFromLabel.textContent = "Не выбрано";
    routeToLabel.textContent = "Не выбрано";
    routeResult.hidden = true;
    routeBuildButton.disabled = true;
    routeBuildButton.textContent = "Построить маршрут";
    routeStatus.textContent = "Выберите начало и финиш на карте.";
  }

  function bindEvents() {
    searchForm.addEventListener("submit", function (event) {
      event.preventDefault();
      submitSearch(searchInput.value);
    });
    searchInput.addEventListener("input", function () {
      if (!searchInput.value.trim()) hideSearchResults();
    });
    document.addEventListener("click", function (event) {
      if (!searchForm.contains(event.target)) hideSearchResults();
    });

    document.querySelectorAll("[data-view]").forEach(function (button) {
      button.addEventListener("click", function () {
        if (!globe) return;
        globe.flyToView(button.dataset.view);
        document.querySelectorAll("[data-view]").forEach(function (item) { item.removeAttribute("aria-current"); });
        button.setAttribute("aria-current", "page");
      });
    });

    document.querySelectorAll("[data-search-place]").forEach(function (button) {
      button.addEventListener("click", function () {
        var query = button.dataset.searchPlace;
        searchInput.value = query;
        submitSearch(query);
      });
    });

    document.querySelectorAll("[data-layer]").forEach(function (input) {
      input.addEventListener("change", function () { toggleLayer(input.dataset.layer, input.checked, input); });
    });

    document.getElementById("zoom-in").addEventListener("click", function () { if (globe) globe.zoomIn(); });
    document.getElementById("zoom-out").addEventListener("click", function () { if (globe) globe.zoomOut(); });
    document.getElementById("north-up").addEventListener("click", function () { if (globe) globe.northUp(); });
    document.getElementById("toggle-mode").addEventListener("click", function (event) {
      if (!globe) return;
      var is3d = globe.toggle2d();
      event.currentTarget.textContent = is3d ? "2D" : "3D";
      event.currentTarget.setAttribute("aria-pressed", is3d ? "false" : "true");
    });
    document.getElementById("feature-close").addEventListener("click", clearFeature);

    routeToggle.addEventListener("click", function () { setRouteOpen(!state.routeOpen); });
    document.getElementById("route-close").addEventListener("click", function () { setRouteOpen(false); });
    document.getElementById("route-toggle-mobile").addEventListener("click", function () { setRouteOpen(!state.routeOpen); });
    document.querySelectorAll("[data-route-pick]").forEach(function (button) {
      button.addEventListener("click", function () { setRoutePicking(button.dataset.routePick); });
    });
    routeBuildButton.addEventListener("click", buildRoute);
    document.getElementById("route-reset").addEventListener("click", resetRoute);
    document.getElementById("route-mode").addEventListener("change", function () {
      if (globe) globe.setRouteMarkers(state.origin, state.destination);
      routeResult.hidden = true;
      routeStatus.textContent = "Режим изменён. Постройте маршрут повторно.";
    });
  }

  function start() {
    if (state.started) return;
    if (!root.Cesium && !root.__petropavlCesiumFailed) return;
    state.started = true;
    bindEvents();
    if (!root.Cesium) {
      setConnection("error", "Глобус недоступен");
      loadingCopy.textContent = "Не удалось подключить CesiumJS";
      loadingState.classList.add("is-error");
      showToast("Глобус не загрузился. Проверьте интернет-соединение и обновите страницу.");
      return;
    }

    try {
      globe = Petropavl.createGlobe(root.Cesium, document.getElementById("globe"), {
        onReady: function () {
          loadingState.classList.add("is-hidden");
          loadingState.setAttribute("aria-hidden", "true");
          root.setTimeout(function () { loadingState.hidden = true; }, 300);
          setConnection("ready", "Глобус готов");
        },
        onCoordinates: function (coordinate) {
          cursorCoordinates.textContent = coordinate ? coordinateText(coordinate) : "Наведите на глобус";
        },
        onClick: handleMapClick
      });
    } catch (error) {
      setConnection("error", "Глобус недоступен");
      loadingCopy.textContent = "Не удалось запустить карту";
      loadingState.classList.add("is-error");
      showToast("Не удалось открыть 3D-глобус. Обновите страницу или проверьте поддержку WebGL.");
    }
  }

  if (root.Cesium || root.__petropavlCesiumFailed) start();
  else if (script) {
    script.addEventListener("load", start, { once: true });
    script.addEventListener("error", start, { once: true });
    root.setTimeout(function () {
      if (!root.Cesium && !state.started) {
        root.__petropavlCesiumFailed = true;
        start();
      }
    }, 45000);
  } else start();

  root.addEventListener("pagehide", function () {
    Object.keys(state.layerRequests).forEach(function (name) { state.layerRequests[name].abort(); });
    if (state.searchController) state.searchController.abort();
    if (state.routeController) state.routeController.abort();
    if (globe) globe.destroy();
  }, { once: true });
})(window);
