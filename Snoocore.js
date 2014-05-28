"use strict";

var when = require('when')
, delay = require('when/delay')
, request = require('superagent')
, lodash = require('lodash')
, rawApi = require('reddit-api-generator');

module.exports = Snoocore;

Snoocore.oauth = require('./oauth');

function Snoocore(config) {

	// Attach the API calls to self for dot-syntax
	var self = buildRedditApi(rawApi);

	self._userAgent = config.userAgent || 'snoocore-default-User-Agent';

	self._throttle = config.throttle || 2000;

	self._isNode = typeof config.browser !== 'undefined'
		? !config.browser
		: (typeof require === "function" &&
			typeof exports === "object" &&
			typeof module === "object" &&
			typeof window === "undefined");

	self._modhash = ''; // The current mod hash of whatever user we have
	self._cookie = ''; // The current cookie of the user we have
	self._authData = {}; // Set if user has authenticated with OAuth

	function isAuthenticated() {
		return typeof self._authData.access_token !== 'undefined' &&
			typeof self._authData.token_type !== 'undefined';
	}

	function isLoggedIn() {
		return self._modhash;
	}

	function replaceUrlParams(endpointUrl, givenArgs) {
		// nothing to replace!
		if (endpointUrl.indexOf('$') === -1) {
			return endpointUrl;
		}

		// pull out variables from the url
		var params = endpointUrl.match(/\$[\w\.]+/g);

		// replace with the argument provided
		params.forEach(function(param) {
			if (typeof givenArgs[param] === 'undefined') {
				throw new Error('missing required url parameter ' + param);
			}
			endpointUrl = endpointUrl.replace(param, givenArgs[param]);
		});

		return endpointUrl;
	}

	function addUrlExtension(endpointUrl, endpointExtensions) {
		endpointExtensions = endpointExtensions || [];
		// add ".json" if we have an url path that needs it specified
		if (endpointExtensions.length === 0) { return endpointUrl; }

		if (endpointExtensions.indexOf('.json') === -1) {
			throw new Error(
				'Invalid extension types specified, unable to use ' +
				'this endpoint!');
		}

		endpointUrl += '.json';
		return endpointUrl;
	}

	function getAuthOrStandardUrl(endpoint) {
		if (isAuthenticated() && endpoint.url.oauth) {
			return endpoint.url.oauth;
		}
		return endpoint.url.standard;
	}


	// Builds the URL that we will query taking into account any
	// variables in the url containing `$`
	function buildUrl(givenArgs, endpoint) {
		var url = getAuthOrStandardUrl(endpoint);
		url = replaceUrlParams(url, givenArgs);
		url = addUrlExtension(url, endpoint.extensions);
		return url;
	}


	function buildArgs(endpointArgs) {
		var args = {};

		// Skip any url parameters (e.g. items that begin with $)
		for (var key in endpointArgs) {
			if (key.substring(0, 1) !== '$') {
				args[key] = endpointArgs[key];
			}
		}

		// Set the user agent in an extra "app" variable for browsers
		// that can't set the User-Agent
		if (!self._isNode && !args.app) {
			args.app = self._userAgent;
		}

		return args;
	}

	// The current throttle delay before a request will go through
	// increments every time a call is made, and is reduced when a
	// call finishes.
	//
	// Time is added / removed based on the self._throttle variable.
	self._throttleDelay = 1;

	// Build a single API call
	function buildCall(endpoint) {

		return function callRedditApi(givenArgs) {

			self._throttleDelay += self._throttle;

			// Wait for the throttle delay amount, then call the Reddit API
			return delay(self._throttleDelay - self._throttle).then(function() {

				var redditCall = when.defer()
				, method = endpoint.method.toLowerCase()
				, url = buildUrl(givenArgs, endpoint)
				, args = buildArgs(givenArgs);

				var call = request[method](url);

				// Can't set User-Agent in browser based JavaScript!
				if (self._isNode) {
					call.set('User-Agent', config.userAgent);
				}

				// If we're logged in, set the modhash & cookie
				if (isLoggedIn()) {
					call.set('X-Modhash', self._modhash);
					if (self._isNode) {
						call.set('Cookie', self._cookie);
					}
				}

				// if we're authenticated, set the authorization header
				if (isAuthenticated()) {
					call.set('Authorization',
						self._authData.token_type + ' ' +
						self._authData.access_token);
				}

				// Handle arguments
				if (method === 'get') {
					call.query(args);
				} else {
					call.type('form');
					// Handle file uploads
					if (typeof args.file !== 'undefined') {
						var file = args.file;
						delete args.file;
						for (var field in args) {
							console.log(field, args[field]); void('debug');
							call.field(field, args[field]);
						}
						call.attach('file', file);
					}
					// standard request without file uploads
					else {
						call.send(args);
					}
				}

				// If we encounter any error, follow Reddit's style of
				// error notification and resolve with an object with an
				// "error" field.
				call.end(function(error, response) {

					if (error) {
						return redditCall.resolve({
							error: error
						});
					}

					var data;

					try { data = JSON.parse(response.text); }
					catch(e) {
						return redditCall.resolve({
							error: response.text
						});
					}

					// set the modhash if the data contains it
					if (typeof data !== 'undefined' &&
						typeof data.json !== 'undefined' &&
						typeof data.json.data !== 'undefined' &&
						typeof data.json.data.modhash !== 'undefined')
					{
						self._modhash = data.json.data.modhash;
					}

					// set the cookie if it is in the response
					if (typeof response.headers['set-cookie'] !== 'undefined') {
						self._cookie = response.headers['set-cookie'];
					}

					return redditCall.resolve(data);
				});

				// If we have any "errors", convert them into rejections
				return redditCall.promise.then(function(data) {
					if (data.hasOwnProperty('error')) {
						throw new Error(String(data.error));
					}
					return data;
				});
			}).finally(function() {
				// decrement the throttle delay
				self._throttleDelay -= self._throttle;
			});

		};

	}

	// Build the API calls
	function buildRedditApi(rawApi) {
		var reddit = {};

		rawApi.forEach(function(endpoint) {
			var pathSections = endpoint.path.substring(1).split('/');
			var leaf = reddit; // start at the root

			// move down to where we need to be in the chain for this endpoint
			pathSections.forEach(function(section) {
				if (typeof leaf[section] === 'undefined') {
					leaf[section] = {};
				}
				leaf = leaf[section];
			});

			// set the appropriate method call in the chain
			switch (endpoint.method.toLowerCase()) {
				case 'get':
					leaf.get = buildCall(endpoint); break;
				case 'post':
					leaf.post = buildCall(endpoint); break;
				case 'put':
					leaf.put = buildCall(endpoint); break;
				case 'patch':
					leaf.patch = buildCall(endpoint); break;
				case 'delete':
					leaf.delete = buildCall(endpoint); break;
				case 'update':
					leaf.update = buildCall(endpoint); break;
			}
		});

		return reddit;
	}

	// Build support for the raw API calls
	self.raw = function(url) {

		function build(method) {
			var endpoint = {
				url: { standard: url },
				method: method
			};
			return buildCall(endpoint);
		}

		return {
			get: build('get'),
			post: build('post'),
			put: build('put'),
			patch: build('patch'),
			delete: build('delete'),
			update: build('update')
		};
	};

	// Path syntax support. Gets back the object that has the restful verbs
	// attached to them to call
	self.path = function(path) {

		var errorMessage =
			'Invalid path provided! This endpoint does not exist. Make ' +
			'sure that your call matches the routes that are defined ' +
			'in Reddit\'s API documentation';

		path = path.replace(/^\//, ''); // remove leading slash if any
		var sections = path.split('/'); // sections to traverse down
		var endpoint = self;

		// Travel down the dot-syntax until we get to the call we want
		for (var i = 0, len = sections.length; i < len; ++i) {
			endpoint = endpoint[sections[i]];
			if (typeof endpoint === 'undefined') {
				throw new Error(errorMessage);
			}
		}

		// check that at least one rest method is defined
		var isValid = (
			typeof endpoint.get === 'function' ||
			typeof endpoint.post === 'function' ||
			typeof endpoint.put === 'function' ||
			typeof endpoint.patch === 'function' ||
			typeof endpoint.delete === 'function' ||
			typeof endpoint.update === 'function'
		);

		if (!isValid) {
			throw new Error(errorMessage);
		}

		return endpoint;
	};

	// Sets the modhash & cookie to allow for cookie-based calls
	self.login = function(options) {

		if (!options.username || !options.password) {
			return when.reject(new Error(
				'login expects either a username/password, or a ' +
				'cookie/modhash'));
		}

		var rem = typeof options.rem !== 'undefined'
			? options.rem
			: true;

		var api_type = typeof options.api_type !== 'undefined'
			? options.api_type
			: 'json';

		return self.api.login.post({
			user: options.username,
			passwd: options.password,
			rem: rem,
			api_type: api_type
		});
	};

	// Clears the modhash & cookie that was set
	self.logout = function() {
		var getModhash = self._modhash
			? when.resolve(self._modhash)
			: self.api['me.json'].get().then(function(result) {
				return result.data ? result.data.modhash : void 0;
			});

		return getModhash.then(function(modhash) {
			// If we don't have a modhash, there is no need to logout
			if (!modhash) { return; }

			var defer = when.defer();

			request.post('http://www.reddit.com/logout')
			.set('X-Modhash', self._modhash)
			.type('form')
			.send({ uh: modhash })
			.end(function(error, res) {
				return error ? defer.reject(error) : defer.resolve(res);
			});

			return defer.promise.then(function() {
				self._modhash = '';
				self._cookie = '';
			});
		});
	};

	// Sets the auth data from the oauth module to allow OAuth calls
	self.auth = function(authenticationData) {
		return when(authenticationData).then(function(authData) {
			self._authData = authData;
		});
	};

	// Clears any authentication data / removes OAuth call ability
	self.deauth = function() {
		self._authData = {};
		return when.resolve();
	};

	// expose functions for testing
	self._test = {
		isAuthenticated: isAuthenticated,
		getAuthOrStandardUrl: getAuthOrStandardUrl,
		replaceUrlParams: replaceUrlParams,
		addUrlExtension: addUrlExtension,
		buildUrl: buildUrl,
		buildArgs: buildArgs,
		buildCall: buildCall
	};

	return lodash.assign(self.path, self);
}
