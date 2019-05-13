require('./css/pdf-viewer.css');

var angular = require('angular');
var ngRoute = require('angular-route');
var ngSanitize = require('angular-sanitize');


const ngModule = angular.module('app', [ 
    ngRoute,
    ngSanitize
]);

require('./directives')(ngModule);


require('./controllers/main.controller')(ngModule);
