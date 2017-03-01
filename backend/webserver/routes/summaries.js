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


  var resultSummary =  __dirname+'/../../json_summary/'+'conf'+'.json';
  var fs = require('fs-extra');
  if (!fs.existsSync(__dirname+'/../../json_summary/')){
    fs.mkdirSync(__dirname+'/../../json_summary/');
  };

  router.post('/api/record', upload.uploadAudioRecord);

  router.post('/api/summaries/:id', function(req, res){
    logger.debug("received summary for meeting %s: %s",
                 req.params['id'], req.body);

    fs.writeFile(resultSummary, req.body);
    transcripts.storeIntoOpenP(req.body);


    // TODO check for error and return adequate response code
    res.send('OK');
  });

  //router to send summary data from backend to frontend
  router.get('/api/summaries/', function(req, res){
    console.log(__dirname+'/../../json_summary.json');
    fs.readFile(__dirname+'/../../json_summary.json', 'utf8',function(err,result){
      if (err){
        console.log('failed');
        return res.send(404);
      }
      console.log(result);
      //send result data to client
      // var sumaryContent = JSON.stringify(result);
      // console.log('sumaryContent');
      // console.log(sumaryContent);
      res.json(JSON.parse(result));
    })
  })

  return router;
};
