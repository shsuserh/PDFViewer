module.exports = function (ngModule) {
    ngModule.controller('mainCtrl', ["$scope",
        function ($scope) {
            $scope.pdfViewerAPI = {};
            $scope.pdfURL = "";
            $scope.pdfSearchTerm = "";
            $scope.pdfSearchResultID = 0;
            $scope.pdfSearchNumOccurrences = 0;

            $scope.findNext = function () {
                $scope.pdfViewerAPI.findNext();
            };

            $scope.findPrev = function () {
                $scope.pdfViewerAPI.findPrev();
            };
        }])
};
