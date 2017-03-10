
var KaldiGstreamerURL = require('../../config/default.json').KaldiGstreamerURL;

exports.uploadAudioRecord = function(req, res){
  var fs = require('fs-extra');
  var file = req.body;
  var audioName = file.name;
  var fd = __dirname+'/../recorded_audio/'+audioName+'_raw.wav';
  // create a directory to store the audio files
  if (!fs.existsSync(__dirname+'/../recorded_audio/')){
    fs.mkdirSync(__dirname+'/../recorded_audio/');
  };
  // Encoding files in base 64
  var fileContents = file.contents.split(',').pop();
  var buf = new Buffer(fileContents, 'base64');
  fs.writeFile(fd,buf,function(err){
    transcribe(fd);
  });

  // Create the transcribe function
  function transcribe(fd){
    sendRequest(fd, function (err, result) {
      saveResult(result);
    });
  }
  // Saving the transcription result
  function saveResult(result){
    var fs = require('fs-extra');
    var txtFile = __dirname+'/../transcript_files/'+audioName+'.json';
    fs.writeFileSync(txtFile,result.hypotheses[0].utterance);
  };
  // Preparing files to the transcription step
  function sendRequest(file, callback){

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
      var sendTranscript = require('./sendTranscript');
      fs.readFile(clip, function (err, data) {
        if (err) {
          done(err);
          return;
        }

        // Opening socket to start transcription
        var W3CWebSocket = require('websocket').w3cwebsocket;
        var ws = new W3CWebSocket(KaldiGstreamerURL + "/client/ws/speech");
        var transFinal = "";
        var outputContent = "";
        ws.onopen = function (event) {
          console.info('ws to stt module open');
          ws.send(data);
          ws.send("EOS");
        };

        ws.onclose = function (event) {
          console.info('ws to stt module closed');
          var fs = require('fs-extra');
          var TimSort = require('timsort');
          var trans_folder = __dirname+'/../transcript_files/';
          // create directory if it does not exists
          if (!fs.existsSync(trans_folder)){
            fs.mkdirSync(trans_folder);
          };

          var txtFile = trans_folder+audioName+'.json';
          // outputContent =  "[" + outputContent + "]";
          // fs.writeFileSync(txtFile, outputContent);
          // sendTranscript.send_transcript(JSON.parse(outputContent));

          // Saving a transcription file without using Kaldi
          var txtDeb = trans_folder+'39_45_eva_14_microsoft.json';
          fs.writeFileSync(txtFile, fs.readFileSync(txtDeb, 'utf8'));
          sendTranscript.send_transcript(JSON.parse(fs.readFileSync(txtDeb, 'utf8')));
        };
        ws.onerror = function (event) {
          console.info('ws to stt module error: ' + event);
        };

        ws.onmessage = function (event) {
          console.log(event.data);
          var hyp = JSON.parse(event.data);
          if (hyp["result"]!= undefined && hyp["segment-start"] != undefined){
            var trans = ((hyp["result"]["hypotheses"])[0])["transcript"];
            if (hyp["result"]["final"]){
              var end = parseFloat(hyp["segment-start"])+parseFloat(hyp["segment-length"]);
              var start = JSON.parse(hyp["segment-start"]);
              if (outputContent !== "")
                outputContent = outputContent + ',\n';
              outputContent += "{"+"\""+"from"+"\""+": "+start+", "+"\""+"until"+"\""+": "+end+", "+"\""+"speaker"+"\""+": "+"\""+audioName+"\""+", "+"\""+"text"+"\": \""+trans+"\""+"}";
            }
          }
        };
      });
    };
  };

  res.send('OK');
};
