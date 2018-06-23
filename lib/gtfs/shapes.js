const _ = require('lodash');

const geojsonUtils = require('../geojson-utils');

const Agency = require('../../models/gtfs/agency');
const Route = require('../../models/gtfs/route');
const Shape = require('../../models/gtfs/shape');
const Trip = require('../../models/gtfs/trip');
const StopTime = require('../../models/gtfs/stop-time');

/*
 * Returns array of shapes that match the query parameters.
 */
exports.getShapes = async (query = {}, projection = '-_id', options = { lean: true, sort: { shape_pt_sequence: 1 } }) => {
  const shapes = [];
  let shapeIds;

  if (_.isString(query.shape_id)) {
    shapeIds = [query.shape_id];
  } else if (_.isObject(query.shape_id) && query.shape_id.$in !== undefined) {
    shapeIds = query.shape_id.$in;
  } else {
    const tripQuery = {};

    if (query.agency_key !== undefined) {
      tripQuery.agency_key = query.agency_key;
    }

    if (query.route_id !== undefined) {
      tripQuery.route_id = query.route_id;
      delete query.route_id;
    }

    if (query.trip_id !== undefined) {
      tripQuery.trip_id = query.trip_id;
      delete query.trip_id;
    }

    if (query.direction_id !== undefined) {
      tripQuery.direction_id = query.direction_id;
      delete query.direction_id;
    }

    if (query.service_id !== undefined) {
      tripQuery.service_id = query.service_id;
      delete query.service_id;
    }
    // NH find all shapeIds filtered by tripQuery
    shapeIds = await Trip.find(tripQuery).distinct('shape_id');
  }
  /*
  * For all shapeId in shapeIds queries the points
  * (return an array of shapes, i.e. an array of array of points)
  */
  await Promise.all(shapeIds.map(async (shapeId) => {
    const shapeQuery = Object.assign({}, query, { shape_id: shapeId });
    const shapePoints = await Shape.find(shapeQuery, projection, options);

    if (shapePoints.length > 0) {
      shapes.push(shapePoints);
    }
  }));

  return shapes;
};

/*
 * Returns geoJSON of the shapes that match the query parameters.
 */
exports.getShapesAsGeoJSON = async (query = {}) => {
  const properties = {};

  if (query.agency_key === undefined) {
    throw new Error('`agency_key` is a required parameter.');
  }

  const agency = await Agency.findOne({
    agency_key: query.agency_key,
  });
  properties.agency_name = agency ? agency.agency_name : '';
  properties.agency_key = agency ? agency.agency_key : '';

  const routeQuery = {
    agency_key: query.agency_key,
  };

  // NH if we do not specify a direction and a route, we take all the routes for the agency
  if (query.route_id !== undefined) {
    routeQuery.route_id = query.route_id;
    delete query.route_id;
  }

  if (query.direction_id !== undefined) {
    properties.direction_id = query.direction_id;
  }
  const routes = await Route.find(routeQuery, '-_id').lean();
  const features = [];

  // NH weird to use a push inside a .map without using the .map but:
  // Necessary because of asynchronous calls
  // NH for all routes we do a query
  await Promise.all(routes.map(async (route) => {
    const shapeQuery = Object.assign({ route_id: route.route_id }, query);
    const shapes = await exports.getShapes(shapeQuery);
    const routeProperties = Object.assign({}, properties, route);
    features.push(...geojsonUtils.shapesToGeoJSONFeatures(shapes, routeProperties));
  }));

  return geojsonUtils.featuresToGeoJSON(features);
};

exports.getShapesWithScheduleAsGeoJSON = async (query = {}) => {
  const properties = {};

  if (query.agency_key === 'undefined') {
    throw new Error('`agency_key` is a required parameter.');
  }

  const routeQuery = {
    agency_key: query.agency_key,
  };

  // NH if we do not specify a direction and a route, we take all the routes for the agency
  if (query.route_id !== undefined) {
    routeQuery.route_id = query.route_id;
    delete query.route_id;
  }

  if (query.direction_id !== undefined) {
    properties.direction_id = query.direction_id;
  }
  const routes = await Route.find(routeQuery, '-_id').lean();
  const features = [];
  const projectionStopTimes = {
    _id: 0, trip_id: 0, pickup_type: 0, stop_sequence: 0, drop_off_type: 0, agency_key: 0,
  };

  await Promise.all(routes.map(async (route) => {
    const shapeQuery = Object.assign({ route_id: route.route_id }, query);
    const tripQuery = Object.assign({ route_id: route.route_id }, query);
    const shapes = await exports.getShapes(shapeQuery);
    const trips = await Trip.find(tripQuery, { trip_id: 1, route_id: 1 });
    const stopTimesList = [];
    await Promise.all(trips.map(async (trip) => {
      const stopTimes = await StopTime.find({ trip_id: trip.trip_id }, projectionStopTimes);
      stopTimesList.push(stopTimes);
    }));
    const routeProperties = Object.assign({}, properties, route);
    routeProperties.stopTimes = stopTimesList;
    features.push(...geojsonUtils.shapesToGeoJSONFeatures(shapes, routeProperties));
  }));
  return geojsonUtils.featuresToGeoJSON(features);
};

exports.getShapesId = async () => Trip.find({}).distinct('shape_id');

