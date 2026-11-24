(function (root) {
  "use strict";

  var Petropavl = root.Petropavl = root.Petropavl || {};
  var config = Petropavl.config;
  var lastSearchAt = 0;
  var lastRouteAt = 0;

  function delay(milliseconds) {
    return new Promise(function (resolve) { root.setTimeout(resolve, milliseconds); });
  }

  function cacheRead(key) {
    try {
      var raw = root.sessionStorage.getItem(config.data.cachePrefix + key);
      if (!raw) return null;
      var item = JSON.parse(raw);
      if (!item || Date.now() - item.savedAt > config.data.cacheTtlMs) {
        root.sessionStorage.removeItem(config.data.cachePrefix + key);
        return null;
      }
      return item.value;
    } catch (error) {
      return null;
    }
  }

  function cacheWrite(key, value) {
    try {
      root.sessionStorage.setItem(config.data.cachePrefix + key, JSON.stringify({ savedAt: Date.now(), value: value }));
    } catch (error) {
      // A browser may block session storage or reach its quota; the live response is still usable.
    }
  }

  async function responseJson(response, serviceName) {
    if (!response.ok) {
      if (response.status === 429) throw new Error(serviceName + " временно ограничил частоту запросов. Попробуйте позже.");
      if (response.status >= 500) throw new Error(serviceName + " временно недоступен.");
      throw new Error(serviceName + " вернул ошибку " + response.status + ".");
    }
    try {
      return await response.json();
    } catch (error) {
      throw new Error("Не удалось прочитать ответ сервиса " + serviceName + ".");
    }
  }

  async function searchLocations(query, signal) {
    var cleaned = String(query || "").trim();
    if (cleaned.length < 2) return [];

    var remaining = 1100 - (Date.now() - lastSearchAt);
    if (remaining > 0) await delay(remaining);
    if (signal && signal.aborted) throw new DOMException("Отменено", "AbortError");

    var url = new URL(config.data.nominatimUrl);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("limit", "5");
    url.searchParams.set("countrycodes", "kz");
    url.searchParams.set("viewbox", [config.data.bounds.west, config.data.bounds.north, config.data.bounds.east, config.data.bounds.south].join(","));
    url.searchParams.set("q", cleaned);

    lastSearchAt = Date.now();
    var response = await fetch(url.toString(), {
      method: "GET",
      headers: { "Accept": "application/json", "Accept-Language": "ru,en" },
      signal: signal
    });
    var results = await responseJson(response, "Поиск OpenStreetMap");
    return Array.isArray(results) ? results : [];
  }

  function boundsString() {
    var bounds = config.data.bounds;
    return [bounds.south, bounds.west, bounds.north, bounds.east].map(function (value) { return value.toFixed(5); }).join(",");
  }

  async function fetchLayer(layerName, signal) {
    var layer = config.layers[layerName];
    if (!layer) throw new Error("Неизвестный слой карты.");

    var key = "layer:" + layerName;
    var cached = cacheRead(key);
    if (cached && Array.isArray(cached.elements)) return cached;

    var bbox = boundsString();
    var selectors = layer.selectors.map(function (selector) { return selector + "(" + bbox + ")"; });
    var query = "[out:json][timeout:20];(" + selectors.join(";") + ";);out tags geom;";
    var lastError = null;
    for (var index = 0; index < config.data.overpassUrls.length; index += 1) {
      if (signal && signal.aborted) throw new DOMException("Отменено", "AbortError");
      var attemptController = new AbortController();
      var callerAborted = false;
      var abortFromCaller = function () {
        callerAborted = true;
        attemptController.abort();
      };
      if (signal) signal.addEventListener("abort", abortFromCaller, { once: true });
      var timeoutId = root.setTimeout(function () { attemptController.abort(); }, 14000);
      try {
        var response = await fetch(config.data.overpassUrls[index], {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
            "Accept": "application/json"
          },
          body: new URLSearchParams({ data: query }).toString(),
          signal: attemptController.signal
        });
        var data = await responseJson(response, "Геоданные OpenStreetMap");
        if (!Array.isArray(data.elements)) throw new Error("В ответе OpenStreetMap нет списка объектов.");
        cacheWrite(key, data);
        return data;
      } catch (error) {
        if (callerAborted || (signal && signal.aborted)) throw new DOMException("Отменено", "AbortError");
        lastError = attemptController.signal.aborted ? new Error("Истекло время ожидания ответа геосервера.") : error;
        if (/вернул ошибку 400|списка объектов|прочитать ответ/.test(error.message || "")) break;
      } finally {
        root.clearTimeout(timeoutId);
        if (signal) signal.removeEventListener("abort", abortFromCaller);
      }
    }
    throw lastError || new Error("Геоданные OpenStreetMap временно недоступны.");
  }

  async function fetchRoute(origin, destination, mode, signal) {
    var validModes = { car: "car", foot: "foot", bike: "bike" };
    var serviceMode = validModes[mode];
    if (!serviceMode) throw new Error("Этот способ передвижения не поддерживается.");

    var remaining = 1050 - (Date.now() - lastRouteAt);
    if (remaining > 0) await delay(remaining);
    if (signal && signal.aborted) throw new DOMException("Отменено", "AbortError");

    var coordinates = [origin.longitude, origin.latitude, destination.longitude, destination.latitude]
      .map(function (value) { return Number(value).toFixed(6); });
    var url = config.data.routingBase + serviceMode + "/route/v1/driving/" + coordinates[0] + "," + coordinates[1] + ";" + coordinates[2] + "," + coordinates[3];
    url += "?overview=full&geometries=geojson&steps=false";

    lastRouteAt = Date.now();
    var response = await fetch(url, {
      method: "GET",
      headers: { "Accept": "application/json" },
      signal: signal
    });
    var data = await responseJson(response, "Маршрутизация OSRM");
    if (data.code !== "Ok" || !data.routes || !data.routes[0] || !data.routes[0].geometry || !Array.isArray(data.routes[0].geometry.coordinates)) {
      var messages = {
        NoRoute: "Для этих точек маршрут не найден.",
        NoSegment: "Одна из точек находится далеко от доступной дороги.",
        NotImplemented: "Этот режим маршрута сейчас недоступен."
      };
      throw new Error(messages[data.code] || "Сервис не смог построить маршрут.");
    }
    return { route: data.routes[0], dataVersion: data.data_version || null };
  }

  Petropavl.api = Object.freeze({
    searchLocations: searchLocations,
    fetchLayer: fetchLayer,
    fetchRoute: fetchRoute
  });
})(window);
