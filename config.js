(function (root) {
  "use strict";

  var Petropavl = root.Petropavl = root.Petropavl || {};

  Petropavl.config = Object.freeze({
    city: Object.freeze({
      name: "Петропавл",
      country: "Республика Казахстан",
      region: "Северо-Казахстанская область",
      latitude: 54.87343,
      longitude: 69.15065
    }),
    views: Object.freeze({
      earth: Object.freeze({ name: "Земля", longitude: 20, latitude: 24, altitude: 27000000 }),
      kazakhstan: Object.freeze({ name: "Казахстан", longitude: 67, latitude: 48, altitude: 1750000 }),
      region: Object.freeze({ name: "Северо-Казахстанская область", longitude: 69.3, latitude: 54.4, altitude: 320000 }),
      petropavl: Object.freeze({ name: "Петропавл", longitude: 69.15065, latitude: 54.87343, altitude: 28000 })
    }),
    data: Object.freeze({
      tileUrl: "https://tile.openstreetmap.org/",
      nominatimUrl: "https://nominatim.openstreetmap.org/search",
      overpassUrls: Object.freeze([
        "https://overpass.private.coffee/api/interpreter",
        "https://ovp.dresel.systems/api-as/interpreter",
        "https://maps.mail.ru/osm/tools/overpass/api/interpreter"
      ]),
      routingBase: "https://routing.openstreetmap.de/routed-",
      bounds: Object.freeze({ south: 54.82, west: 69.08, north: 54.93, east: 69.23 }),
      cachePrefix: "petropavl-osm-v1:",
      cacheTtlMs: 30 * 60 * 1000,
      maxFeaturesPerLayer: 3500
    }),
    layers: Object.freeze({
      buildings: Object.freeze({
        label: "Здания",
        selectors: ['way["building"]']
      }),
      roads: Object.freeze({
        label: "Улицы",
        selectors: ['way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|service|living_street|pedestrian|track|footway|cycleway)$"]']
      }),
      water: Object.freeze({
        label: "Вода",
        selectors: [
          'way["waterway"~"^(river|stream|canal|drain|ditch)$"]',
          'way["natural"~"^(water|wetland)$"]',
          'way["landuse"="reservoir"]'
        ]
      })
    })
  });
})(window);
