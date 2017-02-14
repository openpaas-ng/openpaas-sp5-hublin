var OpenPaasStore = require('../../config/default.json').OpenPaasStore;
var Client = require('node-rest-client').Client;

var client = new Client();

// Store the result of the summary module into OpenPaaS Storage
exports.storeIntoOpenP = function (trans_data) {

    // TODO set actual user data
    trans_data['users'] = [];

		var args = {
				path: {},
				parameters: {},
				headers: { "Content-Type": "application/json" },
				data: trans_data
		};
		client.registerMethod("sendToOpenP", OpenPaasStore + "/summary", "POST");

		client.methods.sendToOpenP(args, function (data, response) {
			// TODO chack response code for error
		});
}
