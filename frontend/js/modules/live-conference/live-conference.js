'use strict';

angular.module('op.live-conference', [
  'op.liveconference-templates',
  'op.easyrtc',
  'op.websocket',
  'op.notification',
  'meetings.authentication',
  'meetings.session',
  'meetings.conference',
  'meetings.invitation',
  'meetings.report',
  'meetings.wizard'
])
.constant('MAX_RECONNECT_TIMEOUT', 30000)
.constant('EVENTS', {
    beforeunload: 'beforeunload',
    conferenceleft: 'conferenceleft'
})
.controller('conferenceController', [
  '$scope',
  '$log',
  'session',
  'conference',
  'ioConnectionManager',
  '$window',
  'deviceDetector',
  'eventCallbackRegistry',
  'EVENTS',
  '$state',
  function($scope, $log, session, conference, ioConnectionManager, $window, deviceDetector, eventCallbackRegistry, EVENTS, $state) {
    session.ready.then(function() {
      var wsServerURI = '';
      $state.go('app.conference');

      if (conference.configuration && conference.configuration.hosts && conference.configuration.hosts.length) {
        conference.configuration.hosts.forEach(function(host) {
          if ('ws' === host.type) {
            wsServerURI = host.url;
          }
        });
      }

      $scope.wsServerURI = wsServerURI;
      $log.info('Using \'%s\' as the websocket backend.', wsServerURI);

      $log.debug('Connecting to websocket at address \'%s\' for user %s.', $scope.wsServerURI, session.user);
      ioConnectionManager.connect($scope.wsServerURI);
    });

    $scope.conference = conference;
    $scope.process = {
      step: 'configuration'
    };

    $scope.init = function() {
      session.initialized.then(function() {
        $scope.process.step = 'conference';
      });

      session.goodbye.then(function() {
        $scope.process.step = 'goodbye';
      });

      // MEET-363
      // Firefox doesn't allow our custom message to be displayed. It only displays a
      // generic message and the user doesn't understand why this popup is nagging him.
      // To not confuse him/her, we decided to not display the popup on Firefox.
      //
      // More info:
      //  - https://bugzilla.mozilla.org/show_bug.cgi?id=641509
      //  - https://bugzilla.mozilla.org/show_bug.cgi?id=588292
      //
      if (!deviceDetector.raw.browser.firefox) {
        angular.element($window).on(EVENTS.beforeunload, function() {
          if ($scope.process.step === 'conference') {
            var messages,
                callbacks = eventCallbackRegistry[EVENTS.beforeunload];

            if (callbacks && callbacks.length) {
              messages = callbacks.map(function(callback) {
                return callback();
              }).filter(Boolean);
            }

            if (messages && messages.length) {
              return messages.join('\n');
            }
          }
        });
      }
    };

    $scope.init();
  }
])
.factory('eventCallbackRegistry', function() {
    return {};
  })
.factory('eventCallbackService', ['eventCallbackRegistry', function(registry) {
    return {
      on: function(event, callback) {
        if (!angular.isFunction(callback)) {
          throw new Error('The callback parameter must be a function!');
        }

        if (!angular.isArray(registry[event])) {
          registry[event] = [];
        }

        registry[event].push(callback);
      },
      off: function(event, callback) {
        var callbacks = registry[event];

        if (callbacks && callbacks.length) {
          registry[event] = callbacks.filter(function(element) {
            return callback !== element;
          });
        }
      }
    };
  }])
.directive('liveConference', [
  '$log',
  '$timeout',
  '$interval',
  'session',
  'conferenceAPI',
  'webRTCService',
  'currentConferenceState',
  'LOCAL_VIDEO_ID',
  'REMOTE_VIDEO_IDS',
  'userService',
  'mediaRecorder',
  'liveTranscriber',
  'recommendationHandler',
  'summaryNotifier',
  function($log, $timeout, $interval, session, conferenceAPI, webRTCService, currentConferenceState, LOCAL_VIDEO_ID, REMOTE_VIDEO_IDS, userService, mediaRecorder, liveTranscriber, recommendationHandler, summaryNotifier) {
    function controller($rootScope, $scope, $http) {
      $scope.conference = session.conference;
      $scope.conferenceState = currentConferenceState;
      $scope.conferenceId = $scope.conference._id;
      $scope.reportedAttendee = null;

      $scope.$on('$locationChangeStart', function() {
        webRTCService.leaveRoom($scope.conferenceState.conference);
      });

      $scope.showInvitation = function() {
        $('#invite').modal('show');
      };

      $scope.showReport = function(attendee) {
        $scope.reportedAttendee = attendee;
        $('#reportModal').modal('show');
      };

      $scope.onLeave = function() {
        $log.debug('Leaving the conference');

        mediaRecorder.stopRecording(function(data){

          // compute actual number of attendees lefts
          var nbAttendees = 0;
          for(var i=0; i < $scope.conferenceState.attendees.length; i++) {
            if($scope.conferenceState.attendees[i] != null) {
              nbAttendees += 1;
            }
          }

          var audioData = {
            name: session.conference._id + '_' + userService.getDisplayName(),
            nbParticipantsLeft: nbAttendees - 1,
            type: 'audio/wav',
            contents: data
          };

          $http({
            method: 'POST',
            url: '/api/record',
            data: audioData
          });
        });
        liveTranscriber.close();
        recommendationHandler.clear();

        if(!$rootScope.summaries){
          $rootScope.summaries = {};
        }
        $rootScope.summaries[session.conference._id] = {
          showKeywords: false
        };
        summaryNotifier.start(session.conference._id, function(msg){
          console.log('received summary notif %j', msg);
          summaryNotifier.stop();

          $rootScope.summaries[session.conference._id].summaryKeywords = msg.data;
          $rootScope.summaries[session.conference._id].showKeywords = true;
        });

        webRTCService.leaveRoom($scope.conferenceState.conference);
        session.leave();
      };

      $scope.invite = function(user) {
        $log.debug('Invite user', user);
        conferenceAPI.invite($scope.conferenceId, user._id).then(
          function(response) {
            $log.info('User has been invited', response.data);
          },
          function(error) {
            $log.error('Error while inviting user', error.data);
          }
        );
      };

      $scope.$on('conferencestate:attendees:push', function() {
        conferenceAPI.get($scope.conferenceId).then(function(response) {
          $scope.conferenceState.conference = response.data;
        }, function(err) {
          $log.error('Cannot get conference', $scope.conferenceId, err);
        });

        if ($scope.conferenceState.attendees.length === 2) {
          var video = $('#' + REMOTE_VIDEO_IDS[0]);
          var interval = $interval(function() {
            if (video[0].videoWidth) {
              $scope.conferenceState.updateLocalVideoIdToIndex(1);
              $scope.$apply();
              $interval.cancel(interval);
            }
          }, 100, 30, false);
        }
      });

      $scope.$on('conferencestate:attendees:remove', function(event, data) {
        conferenceAPI.get($scope.conferenceId).then(function(response) {
          $scope.conferenceState.conference = response.data;
        }, function(err) {
          $log.error('Cannot get conference', $scope.conferenceId, err);
        });

        if (data && data.videoIds === $scope.conferenceState.localVideoId) {
          $log.debug('Stream first attendee to main canvas');
          $scope.conferenceState.updateLocalVideoIdToIndex(0);
        }
      });

      // We must wait for the directive holding the template containing videoIds
      // to be displayed in the browser before using easyRTC.
      var unregisterLocalVideoWatch = $scope.$watch(function() {
        return angular.element('#' + LOCAL_VIDEO_ID)[0];
      }, function(video) {
        if (video) {
          webRTCService.connect($scope.conferenceState, function(){
            mediaRecorder.startRecording(webRTCService.getLocalStream());

            var errorReceived = false;
            var liveTranscriberMsgCallback = function(msg) {
              msg = JSON.parse(msg.data);
              switch (msg.type) {
              case 'recommendation':
                recommendationHandler.processRecommendation(msg);
                console.log('> ' + userService.getDisplayName() + ': ' + msg);
                break;
              case 'error':
                if(!errorReceived) {
                  errorReceived = true;
                  $log.error('live transcriber: received error, retrying in 2000ms');
                  liveTranscriber.close();
                  setTimeout(() => {
                    errorReceived = false;
                    liveTranscriber.open($scope.conferenceId,
                                         userService.getDisplayName(),
                                         webRTCService.getLocalStream(),
                                         150,
                                         liveTranscriberMsgCallback);
                  }, 2000);
                }
                break;
              default:
                $log.error('live transcriber: received unexpected message %j', msg);
              }
            };

            liveTranscriber.open($scope.conferenceId,
                                 userService.getDisplayName(),
                                 webRTCService.getLocalStream(),
                                 150,
                                 liveTranscriberMsgCallback);
          });
          unregisterLocalVideoWatch();
        }
      });
    }
    return {
      restrict: 'A',
      controller: controller
    };
  }
])

  .directive('streamVideo', ['currentConferenceState', function(currentConferenceState) {
    return {
      restrict: 'E',
      link: function(scope, element) {
        currentConferenceState.videoElements.forEach(function(video) { element.append(video); });
      }
    };
  }])

  .directive('liveConferenceAutoReconnect', ['webRTCService', 'MAX_RECONNECT_TIMEOUT', '$log', '$timeout',
                                             function(webRTCService, MAX_RECONNECT_TIMEOUT, $log, $timeout) {
                                               function link($scope) {
                                                 webRTCService.addDisconnectCallback(function() {
                                                   function connect() {
                                                     webRTCService.connect($scope.conferenceState, function(err) {
                                                       if (err) {
                                                         reconnectCount++;
                                                         reconnect();
                                                       } else {
                                                         reconnectCount = 0;
                                                         $('#disconnectModal').modal('hide');
                                                       }
                                                     });
                                                   }

                                                   function reconnect() {
                                                     var delay = 1000 << reconnectCount; // jshint ignore:line

                                                     if (delay >= MAX_RECONNECT_TIMEOUT) {
                                                       $scope.toolong = true;
                                                       delay = MAX_RECONNECT_TIMEOUT;
                                                     }
                                                     $log.info('Reconnecting in ' + delay + 'ms');
                                                     $timeout(connect, delay);
                                                   }

                                                   var reconnectCount = 0;
                                                   $scope.toolong = false;
                                                   $('#disconnectModal').modal('show');
                                                   reconnect();
                                                 });
                                               }

                                               return {
                                                 retrict: 'A',
                                                 require: 'liveConference',
                                                 link: link
                                               };

                                             }])
  .directive('liveConferenceNotification', ['$log', 'session', 'notificationFactory', 'livenotification',
                                            function($log, session, notificationFactory, livenotification) {
                                              return {
                                                restrict: 'E',
                                                link: function(scope, element, attrs) {
                                                  function liveNotificationHandler(msg) {
                                                    $log.debug('Got a live notification', msg);
                                                    if (msg.user._id !== session.user._id) {
                                                      notificationFactory.weakInfo('Conference updated!', msg.message);
                                                    }
                                                  }

                                                  var socketIORoom = livenotification('/conferences', attrs.conferenceId)
                                                    .on('notification', liveNotificationHandler);

                                                  scope.$on('$destroy', function() {
                                                    socketIORoom.removeListener('notification', liveNotificationHandler);
                                                  });
                                                }
                                              };
                                            }
                                           ]).directive('disconnectDialog', ['$window', function($window) {
                                             return {
                                               restrict: 'E',
                                               replace: true,
                                               templateUrl: '/views/live-conference/partials/disconnect-dialog.html',
                                               link: function(scope) {
                                                 scope.reloadPage = function() {
                                                   $window.location.reload();
                                                 };
                                               }
                                             };
                                           }])
  .directive('goodbyePageReminders', ['eventCallbackRegistry', function(eventCallbackRegistry) {
    return {
      restrict: 'E',
      replace: true,
      templateUrl: '/views/live-conference/partials/reminders.html',
      link: function(scope) {
        var callbacks = eventCallbackRegistry.conferenceleft;

        if (callbacks && callbacks.length) {
          scope.conferenceLeftActions = callbacks.map(function(callback) {
            return callback();
          }).filter(function(action) {
            return action && action.buttons;
          });
        }
      }
    };
  }])
  .controller('dropDownController', ['$scope', function($scope) {
    var buttonIndex = 0;
    $scope.action.buttons.forEach(function(button, index) {
      if (button.default) {
        buttonIndex = index;
      }
    });

    $scope.setButton = function(n) {
      buttonIndex = n;
      return true;
    };
    $scope.getButton = function() {
      return $scope.action.buttons[buttonIndex];
    };
  }]).factory('mediaRecorder', function(userService, session){

    var chunks = [];
    var localMediaRecorder = null;

    return {
      startRecording: function(mediaStream) {

        var audioStream = new MediaStream(mediaStream.getAudioTracks());
        localMediaRecorder = new MediaRecorder(audioStream);

        localMediaRecorder.ondataavailable = function(e) {
          chunks.push(e.data);
      };

      localMediaRecorder.start();
    },

    stopRecording: function(callback) {

      if(!localMediaRecorder) {
        callback();
      } else {
        localMediaRecorder.onstop = function() {
          var blob = new Blob(chunks, { 'type' : 'audio/ogg; codecs=opus' });
          chunks = [];
          var reader = new FileReader();
          reader.readAsDataURL(blob);
          reader.onload = function(e){
            callback(e.target.result);
          };
        };
        localMediaRecorder.stop();
      }
    }
  };
}).factory('liveTranscriber', [ '$log', '$http', function($log, $http) {
  var recordAtInterval;
  var myWS;
  var mediaRecorder;
  var chunks = [];
  var confId;
  var userId;
  var recordInterval;
  var pause = false;

  function sendAudioToServer(){
    if(chunks.length > 0){
      var blob = new Blob(chunks,
                          { 'type' : 'audio/ogg; codecs=opus' });
      chunks = [];

      var reader = new FileReader();
      reader.readAsDataURL(blob);
      reader.onload = function(e){
        myWS.send(JSON.stringify({
          confId: confId,
          userId: userId,
          type: 'audioData',
          audioContent: e.target.result
        }));
        $log.debug('online reco: sent data to provider');
      };
    }
  }

  function processAudio(stream, interval) {
    mediaRecorder = new MediaRecorder(stream);

    mediaRecorder.ondataavailable = function(e) {
      myWS.send(e.data);
      $log.debug('online reco: sent data to provider');
    };

    mediaRecorder.start(interval);
    $log.debug('online reco: started recording');
  }

  return {
    open: function(conferenceId, usrId, mediaStream, interval, callback) {
      confId = conferenceId;
      userId = usrId;
      $http({
        method: 'GET',
        url: '/api/transcriptprovider'
      }).then(function(providerurl){
        $log.debug('online reco: opening socket to provider');
        myWS = new WebSocket(providerurl.data);
        myWS.onopen = function(e) {
          myWS.send(JSON.stringify({confId: confId, type: 'register', userId: userId}));
          processAudio(mediaStream, interval);
        };
        myWS.onmessage = function(e) {
          $log.debug('online reco: received %j', e);
          callback(e);
        };
      });
    },
    pause: function() {
      pause = true;
      $log.debug('online reco: paused recording');
    },
    resume: function() {
      pause = false;
      $log.debug('online reco: resumed recording');
      recordLoop();
    },
    close: function() {
      clearInterval(recordAtInterval);
      mediaRecorder.stop();
      if(mediaRecorder.stream.stop){
        mediaRecorder.stream.stop();
      }
      myWS.close();
      $log.debug('online reco: closed conenction to provider');
    }
  };
}]).factory('recommendationHandler', [ '$log', 'notificationService', function($log, notificationService){
  var stack_bar_bottom = {
    "dir1": "up",
    "dir2": "right",
    "spacing1": 0,
    "spacing2": 0
  };
  var currentNotification = null;
  return {
    processRecommendation: function(recommendation) {

      var notif_content = '';

      if(recommendation.keywords && recommendation.keywords.length > 0) {
        notif_content += '<h5>mots clés</h5> ';
        for (var i = 0; i < recommendation.keywords.length; i++){
          notif_content += recommendation.keywords[i].key + ', ';
        }
        // remove last ', '
        notif_content = notif_content.substring(0, notif_content.length - 2);
      }

      if(recommendation.wikiarticles && recommendation.wikiarticles.length > 0) {
        notif_content += '<h5>Wikipedia</h5>';
        for(var i = 0; i < recommendation.wikiarticles.length && i < 5; i++) {
          notif_content += '<p><a href=\'' + recommendation.wikiarticles[i].link + '\' target=\'_blank\'>' + recommendation.wikiarticles[i].title + '</a>'; 
        }
      }

      if(recommendation.soArticles && recommendation.soArticles.length > 0) {
        notif_content += '<h5>StackOverflow</h5>';
        var articles = recommendation.soArticles;
        for(var i = 0; i < articles.length && i < 5; i++) {
          notif_content += '<p><a href=\'' + recommendation.soArticles[i].link + '\' target=\'_blank\'>' + recommendation.soArticles[i].title + '</a>'; 
        }
      }

      // update existing notification if it exists and is still open
      // otherwise create a new notification
      if(currentNotification !== null && currentNotification.state != 'closed') {
        currentNotification.update(notif_content);
      } else {
        currentNotification = notificationService.notify({
          title: 'Recommendations',
          text: notif_content,
          type: 'info',
          hide: false,
          addclass: "stack-bar-bottom",
          cornerclass: "",
          width: "30%",
          stack: stack_bar_bottom,
          styling: 'fontawesome'
        });
      }
    },
    clear: function() {
      if(currentNotification !== null) {
        currentNotification.remove();
      }
    }
  };
}]).factory('summaryNotifier', ['$log', 'livenotification', function($log, livenotification) {

  var socketIORoom;
  var handler

  return {
    start: function(confId, callback){

      handler = function(msg) {
        // TODO proper room handling
        if(msg.confId == confId){
          callback(msg);
        }
      };

      socketIORoom = livenotification('/reco')
        .on('summary', handler);
    } ,
    stop: function() {
      socketIORoom.removeListener('summary', handler);
    }
  };
}]);
