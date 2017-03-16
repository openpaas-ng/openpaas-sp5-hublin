var config = require('../../config/default.json');

var fs = require('fs-extra');
var sendTranscript = require('./sendTranscript');
var Client = require('node-rest-client').Client;
var client = new Client({
  connection: {
    rejectUnauthorized: config.externaTranscriptBackend_forbid_selfsigned_cert
  }
});

var KaldiGstreamerURL = config.KaldiGstreamerURL;
var useExternalTranscriptBackend = config.useExternalTranscriptBackend;
var externalTranscriptBackend = config.externalTranscriptBackend;

function mergeTranscripts(confId) {

  var trans_folder = __dirname+'/../transcript_files/';
  var files = fs.readdirSync(trans_folder);

  var combinedTranscript = [];
  var uniqueChunks = [];

  files.filter(
    (file) => file.split('/').slice(-1)[0].startsWith(confId + '_'))
    .forEach(function(file) {
      var data = fs.readFileSync(trans_folder + file);
      var chunks = JSON.parse(data);
      for(var i = 0; i < chunks.length; i++) {
        var chunk = chunks[i];
        var chunkKey = chunk.from + '_' + chunk.until + '_' + chunk.speaker + '_' + chunk.text;
        if(!uniqueChunks.includes(chunkKey)){
          uniqueChunks.push(chunkKey);
          combinedTranscript.push(chunk);
        }
      }
    });

  return combinedTranscript;
}

exports.uploadAudioRecord = function(req, res){

  var data = req.body;
  var audioName = data.name;

  var confIsFinished = data.nbParticipantsLeft == 0;

  var confId = audioName.split('_')[0];
  var speaker = audioName.split('_')[1];

  // create directories if needed
  if (!fs.existsSync(__dirname+'/../recorded_audio/')){
    fs.mkdirSync(__dirname+'/../recorded_audio/');
  };
  if (!fs.existsSync(__dirname+'/../transcript_files/')){
    fs.mkdirSync(__dirname+'/../transcript_files/');
  };

  // Encoding files in base 64
  var fileContents = data.contents.split(',').pop();
  var buf = new Buffer(fileContents, 'base64');
  var audio_file = __dirname+'/../recorded_audio/'+audioName+'_raw.wav';
  fs.writeFile(audio_file, new Buffer(fileContents, 'base64'), function(err) {

    function transcript_callback(result){
      var txtFile = __dirname+'/../transcript_files/'+audioName+'.json';
      fs.writeFileSync(txtFile, JSON.stringify(result));

      if(confIsFinished) {
        // merge all the transcripts of the different participants
        var combined = mergeTranscripts(confId);

        // save combined transcript to disk
        var combinedFile = __dirname+'/../transcript_files/'+confId+'.json';
        fs.writeFile(combinedFile, JSON.stringify(combined));

        // send combined transcript
        sendTranscript.send_transcript(confId, combined);
      }
    }

    if(!useExternalTranscriptBackend) {
      sendRequest_internal(audio_file, transcript_callback);
    } else {
      sendRequest_external(audio_file, transcript_callback);
    }

  });

  function sendRequest_external(file, callback){
    var confId = audioName.split('_')[0];
		var args = {
			path: {},
			parameters: {},
			headers: { "Content-Type": "application/json" }
		};
		client.registerMethod("getTranscript", externalTranscriptBackend+ "/api/transcripts/" + confId , "GET");

		client.methods.getTranscript(args, function (data, response) {
      callback(JSON.parse(data));
		});
  }

  function sendRequest_internal(file, callback){

    var ffmpeg = require('fluent-ffmpeg');
    var fs = require('fs-extra');
    var request = require('superagent');

    ffmpeg.ffprobe(file, function (err, info) {
      var outputfile = __dirname+'/../recorded_audio/'+audioName+'_converted.wav';
      ffmpeg()
        .on('error', function (err) {
          console.log(err);
        })
        .on('end', function () {
          transcribeClip(outputfile,callback);
        })
        .input(file)
        .output(outputfile)
        .setStartTime(0)
        .audioFrequency(16000)
        .audioChannels(1)
        .toFormat('wav')
        .run();
    });

    // Sending audio files to kaldi server
    function transcribeClip(clip, done) {
      fs.readFile(clip, function (err, data) {
        if (err) {
          done(err);
          return;
        }

        // Opening socket to start transcription
        var W3CWebSocket = require('websocket').w3cwebsocket;
        var ws = new W3CWebSocket(KaldiGstreamerURL + "/client/ws/speech");

        var outputContent = [];

        ws.onopen = function (event) {
          console.info('ws to stt module open');
          ws.send(data);
          ws.send("EOS");
        };

        ws.onclose = function (event) {
          console.info('ws to stt module closed');
          callback(outputContent);
        };
        ws.onerror = function (event) {
          console.info('ws to stt module error: ' + event);
        };

        var nbSegment = 0;
        ws.onmessage = function (event) {
          console.log(event.data);
          var hyp = JSON.parse(event.data);
          if (hyp["result"]!= undefined && hyp["result"]["final"]){
            var trans = ((hyp["result"]["hypotheses"])[0])["transcript"];

            var start;
            var end;
            if(hyp["segment-start"] && hyp["segment-length"]) {
              start = JSON.parse(hyp["segment-start"]);
              end = parseFloat(hyp["segment-start"])+parseFloat(hyp["segment-length"]);
            } else {
              start = nbSegment; // TODO set the actual start
              end = nbSegment + 1; // TODO set the actual duration
            }

            outputContent.push({
              from: start,
              until: end,
              speaker: speaker,
              text: trans
            });

            nbSegment += 1;
          }
        };
      });
    };
  };

  res.send('OK');
};
