'use strict';


angular.module('meetings.conference', ['meetings.user', 'meetings.uri', 'meetings.session', 'restangular', 'mgcrea.ngStrap.modal'])
  .run(function(conferenceUserMediaInterceptorService) {
    conferenceUserMediaInterceptorService();
  })
  .factory('conferenceUserMediaInterceptorService', ['$rootScope', '$window', function($rootScope, $window) {
    return function() {
      var getUserMedia = $window.navigator.getUserMedia;

      function interceptStream(callback) {
        return function(mediaStream) {
          $rootScope.$emit('localMediaStream', mediaStream);

          callback(mediaStream);
        };
      }

      $window.navigator.getUserMedia = function(constraints, successCallback, errorCallback) {
        getUserMedia(constraints, interceptStream(successCallback), function(err) {
          getUserMedia({audio: true, video: true}, interceptStream(successCallback), errorCallback);
        });
      };
    };
  }])
  .factory('conferenceService', ['conferenceAPI', 'session', function(conferenceAPI, session) {
    function create(conferenceName, displayName) {
      return conferenceAPI.create(conferenceName, displayName);
    }

    function enter(conferenceName, displayName) {
      return conferenceAPI.get(conferenceName, displayName).then(function(response) {
        session.setConference(response.data);
        return response;
      });
    }

    function addMember() {

    }

    function redirectTo() {

    }

    return {
      create: create,
      enter: enter,
      addMember: addMember,
      redirectTo: redirectTo
    };
  }])
  .factory('conferenceAPI', ['$q', '$window', 'Restangular', function($q, $window, Restangular) {
    function get(id, displayName) {
      var href = $window.location.origin + '/' + encodeURIComponent(id);
      return Restangular.one('conferences', id).get({displayName: displayName}).then(function(response) {
        response.data.href = href;
        return response;
      });
    }

    function getMembers(conferenceId) {
      return Restangular.one('conferences', conferenceId).getList('members');
    }

    function updateMemberField(id, memberId, field, value) {
      return Restangular.one('conferences', id).one('members', memberId).one(field).customPUT({value: value});
    }

    function create(id, displayName) {
      return Restangular.one('conferences', id).put({displayName: displayName});
    }

    function getOrCreate(id, displayName) {
      return Restangular.one('conferences', id).get({displayName: displayName});
    }

    function addMembers(id, members) {
      return Restangular.one('conferences', id).all('members').customPUT(members);
    }

    function createReport(reported, conference, members, description) {
      return Restangular.one('conferences', conference).all('reports').customPOST({
        reported: reported,
        members: members,
        description: description
      });
    }

    function redirectTo(id, tokenUuid) {
      return Restangular.one('conferences').get({token: tokenUuid});
    }

    return {
      get: get,
      create: create,
      getOrCreate: getOrCreate,
      addMembers: addMembers,
      redirectTo: redirectTo,
      getMembers: getMembers,
      updateMemberField: updateMemberField,
      createReport: createReport
    };
  }])
  .factory('feedbackAPI', ['Restangular', function(Restangular) {
    function postFeedback(data) {
      return Restangular.all('api/feedback').post(data);
    }

    return {
      postFeedback: postFeedback
    };
  }])
  .controller('meetingsLandingPageController', ['$scope', '$alert', 'feedbackAPI', function($scope, $alert, feedbackAPI) {
    $scope.alert = function(type, message) {
      $alert({
        content: message,
        container: '.feedback-form',
        placement: 'top',
        type: type,
        duration: 3,
        show: true
      });
    };

    $scope.sendFeedback = function() {
      if ($scope.sendingFeedbackFrom) {
        return;
      }

      $scope.sendingFeedbackFrom = true;

      feedbackAPI.postFeedback($scope.feedbackForm).then(function() {
        $scope.alert('success', 'Your message was sent successfully. Thanks for the feedback!');
      }, function() {
        $scope.alert('warning', 'Oops, this is embarrassing. Please try again later!');
      }).finally(function() {
        $scope.feedbackForm = {};
        $scope.sendingFeedbackFrom = false;
      });
    };
  }])
  .directive('conferenceCreateForm', ['$window', '$log', 'conferenceService', 'URI', 'conferenceNameGenerator',
    function($window, $log, conferenceService, URI, conferenceNameGenerator) {
    return {
      restrict: 'E',
      templateUrl: '/views/modules/conference/conference-create-form.html',
      link: function(scope) {
        function buildUrl(room) {
          return URI('/')
          .query('')
          .fragment('')
          .segmentCoded(room);
        }

        scope.room = conferenceNameGenerator.getName();

        scope.escapeRoomName = function(room) {
          var result = room.replace(/\s+/g, '');

          //removes all url associated characters : , / ? : @ & = + $ #
          //and characters needing encoding : < > [ ] { } " % ; \ ^ | ~ ' `
          result = result.replace(/[,\/\?:@&=\+\$#<>\[\]\{\}“"%;\\^|~'‘`]+/g, '');

          var blackList = [
            'api',
            'components',
            'views',
            'js',
            'css',
            'images',
            'favicon.ico',
            'robots.txt',
            'apple-touch-icon.png',
            'apple-touch-icon-precomposed.png'
          ];
          if (blackList.indexOf(result) >= 0) { result = ''; }

          return result;
        };

        scope.go = function() {
          var escapedName = scope.escapeRoomName(scope.room);
          if (escapedName === '') {
            $window.location.href = buildUrl(conferenceNameGenerator.getName());
          }
          else {
            $window.location.href = buildUrl(escapedName);
          }
        };

        scope.selectMe = function($event) {
          $event.target.select();
        };
      }
    };
  }])
  .controller('goodbyeController', ['$scope', '$window', 'session', function($scope, $window, session) {
    $scope.reopen = function() {
      $window.location.href = '/' + session.conference._id + '?displayName=' + session.user.displayName;
    };
  }])
  .controller('displaySummaryController', ['$scope', '$window', '$http', 'session', function($scope, $window, $http, session){
    console.log("controller display summary");
    $scope.summaryKeywords = '';
    $scope.showKeywords = false;

    $scope.showKeywordsFunc = function(){
      console.log('button display');
      $http({
        method: 'GET',
        url: '/api/summaries/' + session.conference._id
      })
        .then(function successCallback(response) {
          $scope.summaryKeywords = response.data;

          var keyStr = '';
          var curKey;
          for (curKey in $scope.summaryKeywords.keywords){
            keyStr = keyStr+$scope.summaryKeywords.keywords[curKey].key+' - ';
          }
          keyStr = keyStr.substring(0, keyStr.length -3);
          $scope.keyStr = keyStr;
          $scope.showKeywords = true;
        }, function errorCallback(response) {
          console.log('server failed');
        });
    };
  }])
  .directive('usernameForm', [function() {
    return {
      restrict: 'E',
      templateUrl: '/views/modules/live-conference/username-form.html'
    };
  }]).directive('browserAuthorizationDialog', ['$window', 'webRTCService', '$rootScope', function($window, webRTCService, $rootScope) {
    return {
      restrict: 'E',
      templateUrl: '/views/modules/live-conference/browser-authorization-dialog.html',
      replace: true,
      link: function(scope, element) {
        element.modal('show');
        scope.isMediaReady = true;
        webRTCService.setGotMedia(function(gotMediaCB, errorText) {
          element.modal('hide');
          if (errorText) {
            $rootScope.$broadcast('localMediaError', errorText);
            scope.isMediaReady = false;
            element.modal('show');

            return;
          }
          $rootScope.$broadcast('localMediaReady');
        });
      }
    };
  }]).directive('browserErrorDialog', ['$window', '$rootScope', '$log', '$timeout', function($window, $rootScope, $log, $timeout) {
    return {
      restrict: 'E',
      templateUrl: '/views/modules/live-conference/browser-error-dialog.html',
      replace: true,
      link: function(scope, element) {
        scope.$on('localMediaError', function(event, errorText) {
          $log.error(errorText);
          $timeout(function() {scope.errorMessage = errorText;});
          element.modal('show');
        });
      }
    };
  }])
  .constant('conferenceNameGeneratorConstants', {
    adverbs: [
      'adoringly', 'beautifully', 'briskly', 'carefully', 'cheerfully', 'competitively', 'eagerly', 'effortlessly',
      'extravagantly', 'girlishly', 'gracefully', 'happily', 'hungrily', 'joyfully', 'joyously', 'loyally', 'merrily',
      'quickly', 'quietly', 'quizzically', 'really', 'so', 'stylishly', 'unabashedly', 'unevenly', 'urgently', 'well',
      'wishfully', 'swagly', 'yololy', 'positively', 'awesomely', 'breathtakingly', 'magnificently', 'impressively',
      'amazingly', 'astonishingly', 'hublinly', 'omgly', 'wonderfully', 'marvelously', 'superbly', 'toppingly'
    ],
    adjectives: [
      'awesome', 'yolo', 'wooot', 'super', 'magic', 'simple', 'fast', 'open', 'free', 'great', 'cool', 'pretty', 'exquisite',
      'stunning', 'radiant', 'amazing', 'delightful', 'dreamy', 'fine', 'hypnotic', 'marvelous', 'sublime', 'smoking',
      'adorable', 'beautiful', 'handsome', 'lovely', 'bewitching', 'breathtaking', 'charming', 'divine', 'enchanting',
      'fabulous', 'glamorous', 'perfect', 'spectacular', 'wonderful', 'magnificent', 'wondrous', 'miraculous', 'attractive',
      'galvanizing', 'remarkable', 'sensational', 'prodigious'
    ],
    nouns: [
      'toulouse', 'paris', 'lyon', 'montpellier', 'hamburg', 'canada', 'linux', 'mail', 'security', 'store', 'share',
      'software', 'paas', 'angular', 'agile', 'studio', 'config', 'service', 'app', 'video', 'webrtc', 'agenda',
      'calendar', 'montreal', 'vietnam', 'puteaux', 'software', 'node', 'conference', 'team', 'network', 'meeting',
      'website', 'camera', 'grenoble', 'saas', 'iaas', 'france', 'germany', 'social', 'hanoi', 'barbecue', 'babyfoot',
      'petanque', 'pastis', 'confluence', 'penguin', 'labs', 'tunisia', 'djerba', 'party', 'opensource', 'geeks',
      'gathering', 'assembly', 'accumulation', 'conglomerate', 'conclave', 'trust', 'company', 'fellowship', 'group',
      'squad', 'hub', 'rhone', 'herault', 'garonne', 'saone', 'seine', 'fourviere', 'canebiere', 'capitole', 'corsica',
      'brasil', 'belgium', 'italy', 'spain', 'bordeaux', 'strasbourg', 'miami', 'roma', 'firenze', 'beer', 'wine', 'london'
    ]
  })
  .factory('conferenceNameGenerator', ['conferenceNameGeneratorConstants', function(nameGenerator) {
    return {
      getName: function() {
        var adverb = nameGenerator.adverbs[Math.floor(Math.random() * nameGenerator.adverbs.length)];
        var adjective = nameGenerator.adjectives[Math.floor(Math.random() * nameGenerator.adjectives.length)];
        var noun = nameGenerator.nouns[Math.floor(Math.random() * nameGenerator.nouns.length)];
        return adverb + '-' + adjective + '-' + noun;
      }
    };
  }]);
