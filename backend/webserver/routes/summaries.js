'use strict';

var express = require('express');
/**
 * This router is responsible of the API for interacting with the summary module
 *
 * @param {function} dependencies
 * @return {Router}
 */
module.exports = function(dependencies) {

  var logger = dependencies('logger');

  var router = express.Router();
  var bodyParser = require('body-parser');

  var transcripts = require('../saveTranscript');

  router.post('/api/summaries/:id', function(req, res){
    logger.debug("received summary for meeting %s: %s",
                 req.params['id'], req.body);
    transcripts.storeIntoOpenP(req.body);
    // TODO check for error and return adequate response code
    res.send('OK');
  });

  router.use(bodyParser.json({type:'application/json'}));

  return router;
};
