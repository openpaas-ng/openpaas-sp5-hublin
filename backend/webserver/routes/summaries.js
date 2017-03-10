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

  var upload = require('../myUpload');
  var transcripts = require('../saveTranscript');

  var fs = require('fs-extra');
  if (!fs.existsSync(__dirname+'/../../json_summary/')){
    fs.mkdirSync(__dirname+'/../../json_summary/');
  };

  var OnlineRecoWSServer = require('../../../config/default.json').OnlineRecoWSServer;

  router.post('/api/record', upload.uploadAudioRecord);

  router.get('/api/transcriptprovider', function(req, res) {
    res.send(OnlineRecoWSServer);
  });

  router.post('/api/summaries/:id', function(req, res){
    logger.debug("received summary for meeting %s: %s",
                 req.params['id'], req.body);

    var resultSummary =  __dirname+'/../../json_summary/'+req.params['id']+'.json';
    fs.writeFileSync(resultSummary, JSON.stringify(req.body));
    transcripts.storeIntoOpenP(req.body);


    // TODO check for error and return adequate response code
    res.send('OK');
  });

  //router to send summary data from backend to frontend
  router.get('/api/summaries/:id', function(req, res){
    fs.readFile(__dirname+'/../../json_summary/' + req.params['id'] + '.json', 'utf8',function(err,result){
      if (err){
        console.log('failed');
        res.send(404);
        return;
      }
      //send result data to client
      // var sumaryContent = JSON.stringify(result);
      // console.log('sumaryContent');
      // console.log(sumaryContent);
      res.json(JSON.parse(result));
    });
  });

  return router;
};
