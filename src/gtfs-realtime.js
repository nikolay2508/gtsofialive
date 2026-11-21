(() => {
  'use strict';

  const decoder = new TextDecoder();

  function readVarint(state) {
    let result = 0n;
    let shift = 0n;
    while (state.offset < state.bytes.length) {
      const byte = state.bytes[state.offset++];
      result |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return result;
      shift += 7n;
      if (shift > 70n) throw new Error('Invalid protobuf varint');
    }
    throw new Error('Unexpected end of protobuf while reading varint');
  }

  function readFields(input, callback) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    const state = { bytes, offset: 0 };
    while (state.offset < bytes.length) {
      const key = readVarint(state);
      const field = Number(key >> 3n);
      const wire = Number(key & 7n);
      if (!field) throw new Error('Invalid protobuf field number');
      let value;
      if (wire === 0) {
        value = readVarint(state);
      } else if (wire === 1) {
        if (state.offset + 8 > bytes.length) throw new Error('Truncated protobuf fixed64');
        value = new DataView(bytes.buffer, bytes.byteOffset + state.offset, 8).getFloat64(0, true);
        state.offset += 8;
      } else if (wire === 2) {
        const size = Number(readVarint(state));
        if (!Number.isSafeInteger(size) || size < 0 || state.offset + size > bytes.length) {
          throw new Error('Truncated protobuf message');
        }
        value = bytes.subarray(state.offset, state.offset + size);
        state.offset += size;
      } else if (wire === 5) {
        if (state.offset + 4 > bytes.length) throw new Error('Truncated protobuf fixed32');
        value = new DataView(bytes.buffer, bytes.byteOffset + state.offset, 4).getFloat32(0, true);
        state.offset += 4;
      } else {
        throw new Error(`Unsupported protobuf wire type ${wire}`);
      }
      callback(field, wire, value);
    }
  }

  const asNumber = (value) => value === undefined || value === null ? null : Number(value);
  const asString = (value) => value instanceof Uint8Array ? decoder.decode(value) : '';

  function parseHeader(bytes) {
    const header = {};
    readFields(bytes, (field, wire, value) => {
      if (field === 3 && wire === 0) header.timestamp = asNumber(value);
    });
    return header;
  }

  function parseTrip(bytes) {
    const trip = {};
    readFields(bytes, (field, wire, value) => {
      if (wire === 2 && field === 1) trip.trip_id = asString(value);
      else if (wire === 2 && field === 5) trip.route_id = asString(value);
      else if (wire === 0 && field === 4) trip.schedule_relationship = asNumber(value);
      else if (wire === 0 && field === 6) trip.direction_id = asNumber(value);
    });
    return trip;
  }

  function parsePosition(bytes) {
    const position = {};
    readFields(bytes, (field, wire, value) => {
      if (wire !== 5) return;
      if (field === 1) position.lat = value;
      else if (field === 2) position.lon = value;
      else if (field === 3) position.bearing = value;
      else if (field === 5) position.speed = value;
    });
    return position;
  }

  function parseVehicleDescriptor(bytes) {
    const vehicle = {};
    readFields(bytes, (field, wire, value) => {
      if (wire !== 2) return;
      if (field === 1) vehicle.id = asString(value);
      else if (field === 2) vehicle.label = asString(value);
    });
    return vehicle;
  }

  function parseVehiclePosition(bytes, entityId, feedTimestamp) {
    const result = { entityId, timestamp: feedTimestamp };
    readFields(bytes, (field, wire, value) => {
      if (wire === 2 && field === 1) result.trip = parseTrip(value);
      else if (wire === 2 && field === 2) result.position = parsePosition(value);
      else if (wire === 0 && field === 5) result.timestamp = asNumber(value);
      else if (wire === 2 && field === 8) result.vehicle = parseVehicleDescriptor(value);
    });
    return result;
  }

  function parseStopTimeEvent(bytes) {
    const event = {};
    readFields(bytes, (field, wire, value) => {
      if (wire !== 0) return;
      if (field === 1) event.delay = Number((value >> 1n) ^ (-(value & 1n)));
      else if (field === 2) event.time = asNumber(value);
      else if (field === 3) event.uncertainty = asNumber(value);
    });
    return event;
  }

  function parseStopTimeUpdate(bytes) {
    const update = {};
    readFields(bytes, (field, wire, value) => {
      if (wire === 2 && field === 2) update.arrival = parseStopTimeEvent(value);
      else if (wire === 2 && field === 3) update.departure = parseStopTimeEvent(value);
      else if (wire === 2 && field === 4) update.stopId = asString(value);
      else if (wire === 0 && field === 5) update.scheduleRelationship = asNumber(value);
      else if (wire === 0 && field === 1) update.stopSequence = asNumber(value);
    });
    return update;
  }

  function parseTripUpdate(bytes, entityId, feedTimestamp) {
    const result = { entityId, timestamp: feedTimestamp, stopTimeUpdates: [] };
    readFields(bytes, (field, wire, value) => {
      if (wire === 2 && field === 1) result.trip = parseTrip(value);
      else if (wire === 2 && field === 2) result.stopTimeUpdates.push(parseStopTimeUpdate(value));
      else if (wire === 2 && field === 3) result.vehicle = parseVehicleDescriptor(value);
      else if (wire === 0 && field === 4) result.timestamp = asNumber(value);
      else if (wire === 0 && field === 5) result.delay = Number((value >> 1n) ^ (-(value & 1n)));
    });
    return result;
  }

  function parseTripUpdateEntity(bytes, feedTimestamp) {
    let id = '';
    let tripUpdateBytes = null;
    let deleted = false;
    readFields(bytes, (field, wire, value) => {
      if (field === 1 && wire === 2) id = asString(value);
      else if (field === 2 && wire === 0) deleted = value !== 0n;
      else if (field === 3 && wire === 2) tripUpdateBytes = value;
    });
    if (!tripUpdateBytes || deleted) return null;
    const result = parseTripUpdate(tripUpdateBytes, id, feedTimestamp);
    if (!result.trip?.trip_id) return null;
    result.stopTimeUpdates = result.stopTimeUpdates.filter((item) => item.stopId);
    return result;
  }

  function parseEntity(bytes, feedTimestamp) {
    let id = '';
    let vehicleBytes = null;
    let deleted = false;
    readFields(bytes, (field, wire, value) => {
      if (field === 1 && wire === 2) id = asString(value);
      else if (field === 2 && wire === 0) deleted = value !== 0n;
      else if (field === 4 && wire === 2) vehicleBytes = value;
    });
    if (!vehicleBytes || deleted) return null;
    const record = parseVehiclePosition(vehicleBytes, id, feedTimestamp);
    const pos = record.position;
    if (!pos || !Number.isFinite(pos.lat) || !Number.isFinite(pos.lon)) return null;
    if (Math.abs(pos.lat) > 90 || Math.abs(pos.lon) > 180) return null;

    const vehicle = record.vehicle || {};
    const vehicleId = String(vehicle.id || vehicle.label || id || '').trim();
    if (!vehicleId) return null;
    const inventory = String(vehicle.label || vehicle.id || '').trim();
    const timestamp = Number(record.timestamp);
    const raw = {
      id: vehicleId,
      cgm_id: vehicle.id || vehicleId,
      vehicle_id: vehicle.id || vehicleId,
      inv_number: inventory || vehicleId,
      inventory_number: inventory || vehicleId,
      route_id: record.trip?.route_id || '',
      gtfs_route_id: record.trip?.route_id || '',
      trip_id: record.trip?.trip_id || '',
      direction_id: record.trip?.direction_id,
      coords: { lat: pos.lat, lon: pos.lon },
      timestamp: Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null,
      speed: Number.isFinite(pos.speed) ? pos.speed * 3.6 : null,
      bearing: Number.isFinite(pos.bearing) ? pos.bearing : null
    };
    return raw;
  }

  function decodeTripUpdates(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    let feedTimestamp = null;
    const entities = [];
    readFields(bytes, (field, wire, value) => {
      if (field === 1 && wire === 2) feedTimestamp = parseHeader(value).timestamp ?? feedTimestamp;
      else if (field === 2 && wire === 2) entities.push(value);
    });
    return entities.map((entity) => parseTripUpdateEntity(entity, feedTimestamp)).filter(Boolean);
  }

  function decode(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    let feedTimestamp = null;
    const entities = [];
    readFields(bytes, (field, wire, value) => {
      if (field === 1 && wire === 2) feedTimestamp = parseHeader(value).timestamp ?? feedTimestamp;
      else if (field === 2 && wire === 2) entities.push(value);
    });
    return entities.map((entity) => parseEntity(entity, feedTimestamp)).filter(Boolean);
  }

  window.GTSOFIA_GTFS_RT = { decode, decodeTripUpdates };
})();
