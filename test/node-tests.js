// Files that will be tested in Node.js 

var when = require('when');

var config = require('./config');
var tsi = require('./src/testServerInstance');

describe('Snoocore Node Tests', function() {

  this.timeout(config.testTimeout);

  before(function() {
    return when.all([
      tsi.standardServer.start(),
      tsi.errorServer.start()
    ]).then(function(result) {
      console.log('started servers', result);
    });
  });

  after(function() {
    return when.all([
      tsi.standardServer.stop(),
      tsi.errorServer.stop()
    ]).then(function(result) {
      console.log('stopped servers', result);
    });
  });

  require('./src/oauth-test');
  require('./src/request-test');
  require('./src/snoocore-behavior-noauth-test');
  require('./src/snoocore-behavior-test');
  require('./src/snoocore-cookie-test');
  require('./src/snoocore-error-test');
  require('./src/snoocore-internal-test');
  require('./src/snoocore-listings-test');
  require('./src/snoocore-oauth-test');

});
