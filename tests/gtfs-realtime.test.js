'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

global.window = {};
require(path.join(__dirname, '..', 'src', 'gtfs-realtime.js'));

function varint(value) {
  let number = BigInt(value);
  const bytes = [];
  while (number > 0x7fn) {
    bytes.push(Number((number & 0x7fn) | 0x80n));
    number >>= 7n;
  }
  bytes.push(Number(number));
  return Uint8Array.from(bytes);
}

function concat(...chunks) {
  const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function bytesField(field, value) {
  const data = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  return concat(varint((field << 3) | 2), varint(data.length), data);
}

function intField(field, value) {
  return concat(varint(field << 3), varint(value));
}

function int32Field(field, value) {
  const encoded = value < 0 ? BigInt.asUintN(64, BigInt(value)) : BigInt(value);
  return concat(varint(field << 3), varint(encoded));
}

const predictedTime = Math.floor(Date.now() / 1000) + 420;
const tripDescriptor = concat(
  bytesField(1, 'trip-abc'),
  intField(4, 0),
  bytesField(5, 'A4'),
  intField(6, 1)
);
const arrivalEvent = concat(intField(1, 180), intField(2, predictedTime));
const stopTimeUpdate = concat(
  bytesField(2, arrivalEvent),
  bytesField(4, '1234'),
  intField(5, 0)
);
const vehicleDescriptor = concat(bytesField(1, 'vehicle-42'), bytesField(2, '1234'));
const tripUpdate = concat(
  bytesField(1, tripDescriptor),
  bytesField(2, stopTimeUpdate),
  bytesField(3, vehicleDescriptor),
  intField(4, predictedTime - 60)
);
const entity = concat(bytesField(1, 'entity-abc'), bytesField(3, tripUpdate));
const feed = bytesField(2, entity);

const result = window.GTSOFIA_GTFS_RT.decodeTripUpdates(feed);
assert.equal(result.length, 1);
assert.equal(result[0].entityId, 'entity-abc');
assert.equal(result[0].trip.trip_id, 'trip-abc');
assert.equal(result[0].trip.route_id, 'A4');
assert.equal(result[0].trip.direction_id, 1);
assert.equal(result[0].trip.schedule_relationship, 0);
assert.equal(result[0].vehicle.id, 'vehicle-42');
assert.equal(result[0].vehicle.label, '1234');
assert.equal(result[0].stopTimeUpdates.length, 1);
assert.equal(result[0].stopTimeUpdates[0].stopId, '1234');
assert.equal(result[0].stopTimeUpdates[0].arrival.time, predictedTime);
assert.equal(result[0].stopTimeUpdates[0].arrival.delay, 180);

// A valid GTFS-RT StopTimeUpdate may contain stop_sequence without stop_id.
const sequenceOnlyStopTime = concat(
  intField(1, 7),
  bytesField(2, concat(int32Field(1, -90), intField(2, predictedTime + 60)))
);
const sequenceOnlyTripUpdate = concat(
  bytesField(1, tripDescriptor),
  bytesField(2, sequenceOnlyStopTime)
);
const sequenceOnlyEntity = concat(bytesField(1, 'entity-sequence-only'), bytesField(3, sequenceOnlyTripUpdate));
const sequenceOnlyFeed = bytesField(2, sequenceOnlyEntity);
const sequenceOnlyResult = window.GTSOFIA_GTFS_RT.decodeTripUpdates(sequenceOnlyFeed);
assert.equal(sequenceOnlyResult.length, 1);
assert.equal(sequenceOnlyResult[0].stopTimeUpdates.length, 1);
assert.equal(sequenceOnlyResult[0].stopTimeUpdates[0].stopId, undefined);
assert.equal(sequenceOnlyResult[0].stopTimeUpdates[0].stopSequence, 7);
assert.equal(sequenceOnlyResult[0].stopTimeUpdates[0].arrival.delay, -90);

console.log('GTFS-RT TripUpdates decoder tests passed.');
