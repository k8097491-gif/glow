(function (root) {
  "use strict";

  var Petropavl = root.Petropavl = root.Petropavl || {};

  function degrees(Cesium, coordinates) {
    var values = [];
    coordinates.forEach(function (point) {
      values.push(Number(point.lon), Number(point.lat));
    });
    return Cesium.Cartesian3.fromDegreesArray(values);
  }

  function centerOf(geometry) {
    var totalLat = 0;
    var totalLon = 0;
    geometry.forEach(function (point) {
      totalLat += Number(point.lat);
      totalLon += Number(point.lon);
    });
    return { latitude: totalLat / geometry.length, longitude: totalLon / geometry.length };
  }

  function numericTag(value) {
    if (value === undefined || value === null || value === "") return null;
    var match = String(value).replace(",", ".").match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
  }

  function addressFrom(tags) {
    var parts = [];
    if (tags["addr:street"]) parts.push(tags["addr:street"]);
    if (tags["addr:housenumber"]) parts.push(tags["addr:housenumber"]);
    if (tags["addr:place"] && parts.length === 0) parts.push(tags["addr:place"]);
    if (tags["addr:suburb"]) parts.push(tags["addr:suburb"]);
    if (tags["addr:city"]) parts.push(tags["addr:city"]);
    return parts.length ? parts.join(", ") : null;
  }

  function buildingHeight(tags, geometry) {
    var taggedHeight = numericTag(tags.height || tags["building:height"]);
    if (taggedHeight && taggedHeight > 0 && taggedHeight < 350) {
      return { meters: taggedHeight, source: "height tag" };
    }

    var floors = numericTag(tags["building:levels"]);
    if (floors && floors > 0 && floors < 100) {
      return { meters: Math.max(3.2, floors * 3.2), source: "levels estimate", floors: floors };
    }

    var type = String(tags.building || "");
    var area = 0;
    if (geometry.length > 3) {
      for (var index = 0; index < geometry.length - 1; index += 1) {
        var a = geometry[index];
        var b = geometry[index + 1];
        area += Number(a.lon) * Number(b.lat) - Number(b.lon) * Number(a.lat);
      }
      area = Math.abs(area) * 0.5 * 111000 * 111000 * Math.cos(54.87 * Math.PI / 180);
    }

    var estimated;
    if (/church|cathedral|mosque|temple|tower/.test(type)) estimated = 14;
    else if (/apartments|office|hotel|university|hospital|school/.test(type)) estimated = 11;
    else if (/industrial|warehouse|garages/.test(type)) estimated = 7.5;
    else if (area > 1400) estimated = 10;
    else if (area > 500) estimated = 7.5;
    else estimated = 5.5;
    return { meters: estimated, source: "type and footprint estimate" };
  }

  function metaFor(type, element, geometry) {
    var tags = element.tags || {};
    var center = centerOf(geometry);
    var name = tags.name || tags["name:ru"] || tags["name:kk"] || null;
    var height = type === "buildings" ? buildingHeight(tags, geometry) : null;
    return {
      type: type,
      kind: type === "buildings" ? "building" : type === "roads" ? "road" : "water",
      id: element.id,
      osmType: element.type || "way",
      tags: tags,
      name: name,
      category: tags.amenity || tags.shop || tags.office || tags.building || tags.highway || tags.waterway || tags.natural || tags.landuse || "—",
      address: addressFrom(tags),
      latitude: center.latitude,
      longitude: center.longitude,
      height: height,
      levels: numericTag(tags["building:levels"])
    };
  }

  function formatFeatureName(meta, fallback) {
    return meta.name || (meta.kind === "building" ? "Здание без названия" : meta.kind === "road" ? "Улица без названия" : "Водный объект без названия") + (fallback ? " · " + fallback : "");
  }

  function createGlobe(Cesium, element, callbacks) {
    callbacks = callbacks || {};
    var config = Petropavl.config;
    var colors = {
      ink: Cesium.Color.fromCssColorString("#34483a"),
      green: Cesium.Color.fromCssColorString("#526f58"),
      yellow: Cesium.Color.fromCssColorString("#d3aa4e"),
      blue: Cesium.Color.fromCssColorString("#638d9a"),
      white: Cesium.Color.WHITE
    };
    var layerEntities = { buildings: [], roads: [], water: [] };
    var searchEntities = [];
    var routeEntities = [];
    var selectedEntity = null;
    var routeEntity = null;
    var is2dMode = false;
    var last3dPitch = Cesium.Math.toRadians(-52);
    var lastCursorUpdate = 0;
    var handler;

    var imagery = new Cesium.ImageryLayer(new Cesium.OpenStreetMapImageryProvider({ url: config.data.tileUrl }));
    var viewer = new Cesium.Viewer(element, {
      baseLayer: imagery,
      baseLayerPicker: false,
      terrainProvider: new Cesium.EllipsoidTerrainProvider(),
      animation: false,
      timeline: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      vrButton: false,
      shouldAnimate: false,
      requestRenderMode: true,
      maximumRenderTimeChange: Infinity,
      creditContainer: document.getElementById("cesium-credits")
    });

    viewer.scene.globe.enableLighting = true;
    viewer.scene.backgroundColor = Cesium.Color.fromCssColorString("#e3e7df");
    viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString("#edf0e8");
    viewer.scene.globe.showGroundAtmosphere = true;
    viewer.scene.globe.depthTestAgainstTerrain = true;
    viewer.scene.skyAtmosphere.show = true;
    viewer.scene.fog.enabled = true;
    viewer.scene.requestRenderMode = true;
    viewer.scene.screenSpaceCameraController.minimumZoomDistance = 30;
    viewer.scene.screenSpaceCameraController.maximumZoomDistance = 55000000;
    viewer.scene.screenSpaceCameraController.inertiaSpin = 0.8;
    viewer.scene.screenSpaceCameraController.inertiaTranslate = 0.8;
    viewer.scene.screenSpaceCameraController.inertiaZoom = 0.8;

    function flyTo(latitude, longitude, altitude, duration) {
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(longitude, latitude, altitude),
        orientation: {
          heading: 0,
          pitch: Cesium.Math.toRadians(-52),
          roll: 0
        },
        duration: duration === undefined ? 1.3 : duration,
        maximumHeight: 30000000
      });
    }

    function cartesianToCoordinate(cartesian) {
      if (!cartesian) return null;
      var cartographic = Cesium.Cartographic.fromCartesian(cartesian);
      if (!cartographic) return null;
      return {
        latitude: Cesium.Math.toDegrees(cartographic.latitude),
        longitude: Cesium.Math.toDegrees(cartographic.longitude)
      };
    }

    function positionAt(point, height) {
      return Cesium.Cartesian3.fromDegrees(point.longitude, point.latitude, height || 0);
    }

    function clearCollection(collection) {
      collection.forEach(function (entity) { viewer.entities.remove(entity); });
      collection.length = 0;
    }

    function clearSearchMarker() {
      clearCollection(searchEntities);
    }

    function clearRoute() {
      clearCollection(routeEntities);
      routeEntity = null;
    }

    function showPlace(place) {
      clearSearchMarker();
      var point = { latitude: Number(place.latitude), longitude: Number(place.longitude) };
      if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) return;
      var marker = viewer.entities.add({
        name: place.name || "Найденное место",
        position: positionAt(point, 20),
        point: {
          pixelSize: 12,
          color: colors.yellow,
          outlineColor: colors.white,
          outlineWidth: 3,
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        },
        label: {
          text: place.name || "Найденное место",
          font: "12px -apple-system, BlinkMacSystemFont, sans-serif",
          fillColor: colors.ink,
          outlineColor: colors.white,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -18),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 550000),
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        }
      });
      marker._petropavlMeta = {
        type: "search",
        kind: "search",
        name: place.name || "Найденное место",
        category: place.category || place.type || "место",
        address: place.address || null,
        latitude: point.latitude,
        longitude: point.longitude,
        osmType: place.osmType || null,
        id: place.id || null
      };
      searchEntities.push(marker);
      flyTo(point.latitude, point.longitude, place.altitude || 2400, 1.45);
      return marker;
    }

    function roadStyle(tags) {
      var highway = tags.highway || "";
      if (/motorway|trunk|primary/.test(highway)) return { color: Cesium.Color.fromCssColorString("#c68c40"), width: 3.1 };
      if (/secondary|tertiary/.test(highway)) return { color: Cesium.Color.fromCssColorString("#a78957"), width: 2.5 };
      if (/footway|cycleway|pedestrian|track/.test(highway)) return { color: Cesium.Color.fromCssColorString("#728b73"), width: 1.4 };
      return { color: Cesium.Color.fromCssColorString("#87938a"), width: 1.8 };
    }

    function addBuilding(element, geometry) {
      var meta = metaFor("buildings", element, geometry);
      var taggedHeight = meta.height.source === "height tag";
      var fill = taggedHeight ? Cesium.Color.fromCssColorString("#a5ad94") : Cesium.Color.fromCssColorString("#c1b99f");
      var entity = viewer.entities.add({
        name: formatFeatureName(meta, meta.id),
        polygon: {
          hierarchy: degrees(Cesium, geometry),
          height: 0,
          extrudedHeight: Math.min(160, meta.height.meters),
          material: fill.withAlpha(0.91),
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString("#636f5e").withAlpha(0.8),
          closeTop: true,
          closeBottom: true,
          perPositionHeight: false
        }
      });
      entity._petropavlBaseColor = fill.withAlpha(0.91);
      entity._petropavlMeta = meta;
      entity._petropavlLayer = "buildings";
      return entity;
    }

    function addRoad(element, geometry) {
      var meta = metaFor("roads", element, geometry);
      var style = roadStyle(meta.tags);
      var entity = viewer.entities.add({
        name: formatFeatureName(meta, meta.id),
        polyline: {
          positions: degrees(Cesium, geometry),
          width: style.width,
          material: style.color.withAlpha(0.9),
          clampToGround: true
        }
      });
      entity._petropavlBaseColor = style.color.withAlpha(0.9);
      entity._petropavlMeta = meta;
      entity._petropavlLayer = "roads";
      return entity;
    }

    function addWater(element, geometry) {
      var meta = metaFor("water", element, geometry);
      var tags = meta.tags;
      var isArea = geometry.length > 3 && (tags.natural === "water" || tags.natural === "wetland" || tags.landuse === "reservoir" || tags.water || tags.waterway === "riverbank");
      var entity;
      if (isArea) {
        entity = viewer.entities.add({
          name: formatFeatureName(meta, meta.id),
          polygon: {
            hierarchy: degrees(Cesium, geometry),
            height: 0,
            material: colors.blue.withAlpha(0.32),
            outline: true,
            outlineColor: colors.blue.withAlpha(0.78)
          }
        });
      } else {
        entity = viewer.entities.add({
          name: formatFeatureName(meta, meta.id),
          polyline: {
            positions: degrees(Cesium, geometry),
            width: 3,
            material: colors.blue.withAlpha(0.92),
            clampToGround: true
          }
        });
      }
      entity._petropavlBaseColor = colors.blue.withAlpha(isArea ? 0.32 : 0.92);
      entity._petropavlMeta = meta;
      entity._petropavlLayer = "water";
      return entity;
    }

    function validGeometry(element) {
      if (!Array.isArray(element.geometry) || element.geometry.length < 2) return null;
      var points = element.geometry.filter(function (point) {
        return Number.isFinite(Number(point.lat)) && Number.isFinite(Number(point.lon));
      });
      if (points.length < 2) return null;
      return points;
    }

    function loadLayer(name, elements) {
      if (!layerEntities[name]) return 0;
      clearCollection(layerEntities[name]);
      var add = name === "buildings" ? addBuilding : name === "roads" ? addRoad : addWater;
      var count = 0;
      elements.slice(0, config.data.maxFeaturesPerLayer).forEach(function (element) {
        var geometry = validGeometry(element);
        if (!geometry) return;
        if (name === "buildings" && geometry.length < 4) return;
        try {
          var entity = add(element, geometry);
          layerEntities[name].push(entity);
          count += 1;
        } catch (error) {
          // One malformed OSM way must not prevent the rest of the layer from rendering.
        }
      });
      viewer.scene.requestRender();
      return count;
    }

    function setLayerVisible(name, visible) {
      (layerEntities[name] || []).forEach(function (entity) { entity.show = Boolean(visible); });
      viewer.scene.requestRender();
    }

    function updateSelection(entity) {
      if (selectedEntity && selectedEntity.polygon && selectedEntity._petropavlBaseColor) {
        selectedEntity.polygon.material = selectedEntity._petropavlBaseColor;
      }
      selectedEntity = entity || null;
      if (selectedEntity && selectedEntity.polygon) {
        selectedEntity.polygon.material = Cesium.Color.fromCssColorString("#e2c167").withAlpha(0.96);
      }
      viewer.scene.requestRender();
    }

    function pickedEntityAt(position) {
      var picked = viewer.scene.pick(position);
      if (!picked) return null;
      var entity = picked.id && picked.id._petropavlMeta ? picked.id : null;
      return entity && entity.show !== false ? entity : null;
    }

    function pickEllipsoid(position) {
      var cartesian = viewer.camera.pickEllipsoid(position, viewer.scene.globe.ellipsoid);
      return cartesianToCoordinate(cartesian);
    }

    function addRoutePin(point, letter, color) {
      if (!point) return;
      var entity = viewer.entities.add({
        name: letter === "A" ? "Начало маршрута" : "Финиш маршрута",
        position: positionAt(point, 22),
        point: {
          pixelSize: 11,
          color: color,
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 3,
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        },
        label: {
          text: letter,
          font: "600 10px -apple-system, BlinkMacSystemFont, sans-serif",
          fillColor: Cesium.Color.WHITE,
          horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        }
      });
      entity._petropavlMeta = {
        type: "route-point",
        kind: "route-point",
        name: letter === "A" ? "Начало маршрута" : "Финиш маршрута",
        category: letter === "A" ? "Начало" : "Финиш",
        latitude: point.latitude,
        longitude: point.longitude
      };
      routeEntities.push(entity);
    }

    function setRouteMarkers(origin, destination) {
      clearRoute();
      addRoutePin(origin, "A", colors.green);
      addRoutePin(destination, "B", colors.yellow);
      viewer.scene.requestRender();
    }

    function drawRoute(routeData, origin, destination) {
      clearRoute();
      var points = routeData.route.geometry.coordinates.map(function (coordinate) {
        return Cesium.Cartesian3.fromDegrees(Number(coordinate[0]), Number(coordinate[1]), 0);
      });
      routeEntity = viewer.entities.add({
        name: "Маршрут OSRM",
        polyline: {
          positions: points,
          width: 5,
          material: Cesium.Color.fromCssColorString("#385e46"),
          clampToGround: true
        }
      });
      routeEntity._petropavlMeta = { type: "route", kind: "route", name: "Маршрут OSRM", category: "маршрут" };
      routeEntities.push(routeEntity);
      addRoutePin(origin, "A", colors.green);
      addRoutePin(destination, "B", colors.yellow);
      viewer.scene.requestRender();
    }

    function fitRoute() {
      if (!routeEntity || !routeEntity.polyline) return;
      var positions = routeEntity.polyline.positions.getValue(Cesium.JulianDate.now());
      if (!positions || positions.length < 2) return;
      var sphere = Cesium.BoundingSphere.fromPoints(positions);
      viewer.camera.flyToBoundingSphere(sphere, {
        duration: 1.1,
        offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-48), Math.max(1400, sphere.radius * 2.8))
      });
    }

    handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction(function (movement) {
      var now = Date.now();
      if (now - lastCursorUpdate < 80) return;
      lastCursorUpdate = now;
      var ray = viewer.camera.getPickRay(movement.endPosition);
      var cartesian = ray && viewer.scene.globe.pick(ray, viewer.scene);
      var coordinate = cartesianToCoordinate(cartesian);
      if (callbacks.onCoordinates) callbacks.onCoordinates(coordinate);
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    handler.setInputAction(function (click) {
      var entity = pickedEntityAt(click.position);
      var coordinate = entity && entity._petropavlMeta && Number.isFinite(entity._petropavlMeta.latitude)
        ? { latitude: entity._petropavlMeta.latitude, longitude: entity._petropavlMeta.longitude }
        : pickEllipsoid(click.position);
      updateSelection(entity);
      if (callbacks.onClick) callbacks.onClick(entity ? entity._petropavlMeta : null, coordinate);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(config.city.longitude, config.city.latitude, 36000),
      orientation: { heading: 0, pitch: Cesium.Math.toRadians(-52), roll: 0 },
      duration: 3.1,
      complete: function () {
        viewer.scene.requestRender();
        if (callbacks.onReady) callbacks.onReady(viewer);
      },
      cancel: function () {
        viewer.scene.requestRender();
        if (callbacks.onReady) callbacks.onReady(viewer);
      }
    });

    return {
      viewer: viewer,
      flyToView: function (viewName) {
        var view = config.views[viewName];
        if (view) flyTo(view.latitude, view.longitude, view.altitude, viewName === "earth" ? 1.9 : 1.4);
      },
      flyToCoordinate: flyTo,
      zoomIn: function () { viewer.camera.zoomIn(Math.max(150, viewer.camera.positionCartographic.height * 0.24)); },
      zoomOut: function () { viewer.camera.zoomOut(Math.max(250, viewer.camera.positionCartographic.height * 0.24)); },
      northUp: function () {
        var camera = viewer.camera;
        camera.setView({ orientation: { heading: 0, pitch: camera.pitch, roll: 0 } });
      },
      toggle2d: function () {
        var camera = viewer.camera;
        is2dMode = !is2dMode;
        if (is2dMode) last3dPitch = camera.pitch;
        camera.flyTo({
          destination: camera.position,
          orientation: {
            heading: camera.heading,
            pitch: is2dMode ? Cesium.Math.toRadians(-90) : last3dPitch,
            roll: camera.roll
          },
          duration: 0.7,
          complete: function () { viewer.scene.requestRender(); }
        });
        return !is2dMode;
      },
      showPlace: showPlace,
      clearSearchMarker: clearSearchMarker,
      loadLayer: loadLayer,
      setLayerVisible: setLayerVisible,
      selectFeature: function (meta) {
        var entity = viewer.entities.values.find(function (item) { return item._petropavlMeta === meta; });
        updateSelection(entity || null);
      },
      setRouteMarkers: setRouteMarkers,
      drawRoute: drawRoute,
      fitRoute: fitRoute,
      clearRoute: clearRoute,
      destroy: function () {
        if (handler && !handler.isDestroyed()) handler.destroy();
        if (!viewer.isDestroyed()) viewer.destroy();
      }
    };
  }

  Petropavl.createGlobe = createGlobe;
})(window);
