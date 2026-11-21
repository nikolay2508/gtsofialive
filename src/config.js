/* GTFS-only live configuration, aligned with Dimitar5555/sofiatraffic-livemap. */
window.GTSOFIA_LIVEMAP_CONFIG = {
  sources: {
    gtfs: {
      label: 'ЦГМ · GTFS',
      // This is the same v2 GTFS WebSocket endpoint used by the reference map.
      url: 'wss://sofiatraffic-proxy.onrender.com/v2/livemap/',
      // Official Sofia Traffic GTFS-Realtime TripUpdates feed (protobuf).
      tripUpdatesUrl: 'https://gtfs.sofiatraffic.bg/api/v1/trip-updates'
    }
  },
  // The reference route metadata is refreshed online, with data/route-catalog.json as fallback.
  routeCatalogUrl: 'https://raw.githubusercontent.com/Dimitar5555/sofiatraffic-schedules/master/data/routes.json',
  minActiveSpeed: 3,
  refreshStaleAfterMs: 120_000,
  reconnectDelayMs: 2_500,
  mapCenter: [42.6977, 23.3219],
  mapZoom: 13
};
