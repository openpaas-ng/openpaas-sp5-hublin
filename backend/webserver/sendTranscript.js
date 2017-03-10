'use strict';

var RecoSummary = require('../../config/default.json').RecoSummary;
var RecoSummaryCallback = require('../../config/default.json').RecoSummaryCallback;

var Client = require('node-rest-client').Client;
var client = new Client();

// Send transcription from HublIn to recommender summary
exports.send_transcript = function(meeting_id, data) {

		var trans_data = {};
		trans_data["entries"] = data;

		var args = {
				path: {},
			parameters: {"id": meeting_id, "callbackurl": RecoSummaryCallback + '/' + meeting_id},
				headers: { // TODO: remove useless headers once summay module is fixed
					"Content-Type": "application/json",
					"id": meeting_id,
					"callbackurl": RecoSummaryCallback + '/' + meeting_id
				},
				data: trans_data
		};

	  client.registerMethod("send_transcript", RecoSummary, "POST");

		client.methods.send_transcript(args, function (data, response) {
				console.log("data ",response.body);
		});

};
