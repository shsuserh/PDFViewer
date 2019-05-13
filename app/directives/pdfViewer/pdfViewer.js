module.exports = function (ngModule) {
    ngModule.directive('pdfViewer', [pdfViewerFn]);

    function pdfViewerFn() {
        return {
            restrict: "E",
            scope: {
                src: "@",
                api: "=",
                searchTerm: "@",
                searchResultId: "=",
                searchNumOccurences: "="
            },
            controller: ['$scope', '$element', function ($scope, $element) {

                function trim(str) {
                    return str.replace(/^\s\s*/, '').replace(/\s\s*$/, '');
                }

                var PDF_PAGE_RENDER_FAILED = -1;
                var PDF_PAGE_RENDER_CANCELLED = 0;
                var PDF_PAGE_RENDERED = 1;
                var PDF_PAGE_ALREADY_RENDERED = 2;

                function PDFPage(pdfPage, textContent) {
                    this.id = pdfPage.pageIndex + 1;
                    this.container = angular.element("<div class='page'></div>");
                    this.container.attr("id", "page_" + pdfPage.pageIndex);

                    this.canvas = angular.element("<canvas></canvas>");
                    this.textLayer = angular.element("<div class='text-layer'></div>");

                    this.pdfPage = pdfPage;
                    this.textContent = textContent;
                    this.rendered = false;
                    this.renderTask = null;
                }

                PDFPage.prototype = {
                    clear: function () {
                        if (this.renderTask !== null) {
                            this.renderTask.cancel();
                        }

                        this.rendered = false;
                        this.renderTask = null;
                        this.textLayer.empty();
                        this.container.empty();
                    },
                    resize: function (scale) {
                        var viewport = this.pdfPage.getViewport(scale);

                        this.canvas.attr("width", viewport.width);
                        this.canvas.attr("height", viewport.height);

                        this.container.css("width", viewport.width + "px");
                        this.container.css("height", viewport.height + "px");

                        this.textLayer.css("width", viewport.width + "px");
                        this.textLayer.css("height", viewport.height + "px");
                    },
                    isVisible: function () {
                        var pageContainer = this.container[0];
                        var parentContainer = this.container.parent()[0];

                        var pageTop = pageContainer.offsetTop - parentContainer.scrollTop;
                        var pageBottom = pageTop + pageContainer.offsetHeight;

                        return pageBottom >= 0 && pageTop <= parentContainer.offsetHeight;
                    },
                    highlightTextItem: function (itemID, matchPos, text) {
                        var textLayer = this.textLayer;
                        if (textLayer === null) {
                            return;
                        }

                        var textDivs = textLayer.children();
                        var item = textDivs[itemID];

                        var before = item.childNodes[0].nodeValue.substr(0, matchPos);
                        var middle = item.childNodes[0].nodeValue.substr(matchPos, text.length);
                        var after = document.createTextNode(item.childNodes[0].nodeValue.substr(matchPos + text.length));

                        var highlight_span = document.createElement("span");
                        highlight_span.className = "highlight";

                        highlight_span.appendChild(document.createTextNode(middle));

                        item.childNodes[0].nodeValue = before;
                        item.childNodes[0].parentNode.insertBefore(after, item.childNodes[0].nextSibling);
                        item.childNodes[0].parentNode.insertBefore(highlight_span, item.childNodes[0].nextSibling);

                        // Scroll to item...
                        var parentContainer = this.container.parent()[0];

                        var curScrollTop = parentContainer.scrollTop;
                        var containerHeight = parentContainer.offsetHeight;

                        highlight_span.scrollIntoView();

                        var newScrollTop = parentContainer.scrollTop;

                        var scrolledDown = newScrollTop > curScrollTop;
                        var newScrollPosInOldViewport = curScrollTop + containerHeight > newScrollTop;
                        var scrolledToEnd = newScrollTop >= parentContainer.scrollHeight - containerHeight;

                        if (scrolledDown && newScrollPosInOldViewport && !scrolledToEnd) {
                            parentContainer.scrollTop = curScrollTop;
                        } else {
                            parentContainer.scrollTop -= containerHeight / 4;
                        }
                    },
                    render: function (scale, linkService, callback) {
                        var self = this;
                        if (this.rendered) {
                            if (this.renderTask === null) {
                                if (callback) {
                                    callback(this, PDF_PAGE_ALREADY_RENDERED);
                                }
                            } else {
                                this.renderTask.then(function () {
                                    if (callback) {
                                        callback(self, PDF_PAGE_ALREADY_RENDERED);
                                    }
                                });
                            }

                            return;
                        }

                        var viewport = this.pdfPage.getViewport(scale);

                        this.rendered = true;

                        this.renderTask = this.pdfPage.render({
                            canvasContext: this.canvas[0].getContext('2d'),
                            viewport: viewport
                        });

                        this.renderTask.then(function () {
                            self.rendered = true;
                            self.renderTask = null;

                            self.container.append(self.canvas);

                            if (self.textContent) {
                                // Render the text layer...
                                var textLayerBuilder = new TextLayerBuilder({
                                    textLayerDiv: self.textLayer[0],
                                    pageIndex: self.id,
                                    viewport: viewport
                                });

                                textLayerBuilder.setTextContent(self.textContent);
                                textLayerBuilder.renderLayer();
                                self.container.append(self.textLayer);

                                if (linkService) {
                                    var annotationLayerBuilder = new AnnotationsLayerBuilder({
                                        pageDiv: self.container[0],
                                        pdfPage: self.pdfPage,
                                        linkService: linkService
                                    });

                                    annotationLayerBuilder.setupAnnotations(viewport);
                                }
                            }

                            if (callback) {
                                callback(self, PDF_PAGE_RENDERED);
                            }
                        }, function (message) {
                            self.rendered = false;
                            self.renderTask = null;

                            if (message === "cancelled") {
                                if (callback) {
                                    callback(self, PDF_PAGE_RENDER_CANCELLED);
                                }
                            } else {
                                if (callback) {
                                    callback(self, PDF_PAGE_RENDER_FAILED);
                                }
                            }
                        });
                    }
                };

                function PDFViewer() {
                    this.pdf = null;
                    this.pages = [];
                    this.scale = 4.0;
                    this.searchResults = [];
                    this.searchTerm = "";
                    this.searchHighlightResultID = -1;
                    this.element = null;
                    this.api = new PDFViewerAPI(this);
                    this.onSearch = null;
                }

                PDFViewer.prototype = {
                    setUrl: function (url, element) {
                        this.resetSearch();
                        this.pages = [];
                        this.element = element;

                        var self = this;
                        var getDocumentTask = PDFJS.getDocument(url, null, null, null);
                        getDocumentTask.then(function (pdf) {
                            self.pdf = pdf;

                            self.getAllPages(pdf, function (pageList, pagesRefMap) {
                                self.pages = pageList;
                                self.pagesRefMap = pagesRefMap;

                                for (var iPage = 0; iPage < pageList.length; ++iPage) {
                                    element.append(pageList[iPage].container);
                                }

                                self.setScale(1);
                            });
                        }, function (message) {
                        });
                    },
                    getAPI: function () {
                        return this.api;
                    },
                    getAllPages: function (pdf, callback) {
                        var pageList = [],
                            pagesRefMap = {},
                            numPages = pdf.numPages,
                            remainingPages = numPages;

                        for (var iPage = 0; iPage < numPages; ++iPage) {
                            pageList.push({});

                            var getPageTask = pdf.getPage(iPage + 1);
                            getPageTask.then(function (page) {
                                var refStr = page.ref.num + ' ' + page.ref.gen + ' R';
                                pagesRefMap[refStr] = page.pageIndex + 1;

                                var textContentTask = page.getTextContent();
                                textContentTask.then(function (textContent) {
                                    pageList[page.pageIndex] = new PDFPage(page, textContent);

                                    --remainingPages;
                                    if (remainingPages === 0) {
                                        callback(pageList, pagesRefMap);
                                    }
                                });
                            });
                        }
                    },
                    setScale: function (scale) {
                        this.scale = scale;

                        var numPages = this.pages.length;
                        for (var iPage = 0; iPage < numPages; ++iPage) {
                            this.pages[iPage].clear();
                            this.pages[iPage].resize(scale);
                        }

                        this.highlightSearchResult(this.searchHighlightResultID);
                        this.renderAllVisiblePages(0);
                    },
                    removeDistantPages: function (curPageID, distance) {
                        var numPages = this.pages.length;

                        var firstActivePageID = Math.max(curPageID - distance, 0);
                        var lastActivePageID = Math.min(curPageID + distance, numPages - 1);

                        for (var iPage = 0; iPage < firstActivePageID; ++iPage) {
                            this.pages[iPage].clear();
                        }

                        for (var iPage = lastActivePageID + 1; iPage < numPages; ++iPage) {
                            this.pages[iPage].clear();
                        }
                    },
                    renderAllVisiblePages: function (scrollDir) {
                        var self = this;
                        var numPages = this.pages.length;
                        var currentPageID = 0;

                        var atLeastOnePageInViewport = false;
                        for (var iPage = 0; iPage < numPages; ++iPage) {
                            var page = this.pages[iPage];

                            if (page.isVisible()) {
                                var parentContainer = page.container.parent()[0];
                                var pageTop = page.container[0].offsetTop - parentContainer.scrollTop;
                                if (pageTop <= parentContainer.offsetHeight / 2) {
                                    currentPageID = iPage;
                                }

                                atLeastOnePageInViewport = true;
                                page.render(this.scale, null, function (page, status) {
                                });
                            } else {
                                if (atLeastOnePageInViewport) {
                                    break;
                                }
                            }
                        }

                        if (scrollDir !== 0) {
                            var nextPageID = currentPageID + scrollDir;
                            if (nextPageID >= 0 && nextPageID < numPages) {
                                this.pages[nextPageID].render(this.scale, null, function (page, status) {
                                });
                            }
                        }

                        this.removeDistantPages(currentPageID, 5);

                        this.currentPage = currentPageID + 1;

                    },
                    resetSearch: function () {
                        this.clearLastSearchHighlight();

                        this.searchResults = [];
                        this.searchTerm = "";
                        this.searchHighlightResultID = -1;

                        this.onSearch("reset", 0, 0, "");
                    },
                    search: function (text) {

                        this.resetSearch();
                        this.searchTerm = text;

                        var regex = new RegExp(text, "i");

                        var numPages = this.pages.length;
                        for (var iPage = 0; iPage < numPages; ++iPage) {
                            var pageTextContent = this.pages[iPage].textContent;
                            if (pageTextContent === null) {
                                continue;
                            }

                            var numItems = pageTextContent.items.length;
                            var numItemsSkipped = 0;
                            for (var iItem = 0; iItem < numItems; ++iItem) {
                                var itemStr = pageTextContent.items[iItem].str;
                                itemStr = trim(itemStr);
                                if (itemStr.length === 0) {
                                    numItemsSkipped++;
                                    continue;
                                }

                                var matchPos = itemStr.search(regex);
                                var itemStrStartIndex = 0;
                                while (matchPos > -1) {
                                    this.searchResults.push({
                                        pageID: iPage,
                                        itemID: iItem - numItemsSkipped,
                                        matchPos: itemStrStartIndex + matchPos
                                    });

                                    itemStr = itemStr.substr(matchPos + text.length);
                                    itemStrStartIndex += matchPos + text.length;

                                    matchPos = itemStr.search(regex);
                                }
                            }
                        }

                        var numOccurences = this.searchResults.length;
                        if (numOccurences > 0) {
                            this.highlightSearchResult(0);
                        } else {
                            this.onSearch("done", 0, 0, text);
                        }
                    },
                    highlightSearchResult: function (resultID) {

                        this.clearLastSearchHighlight();

                        if (resultID < 0 || resultID >= this.searchResults.length) {
                            if (resultID === -1 && this.searchResults.length === 0) {
                                this.onSearch("done", -1, 0, this.searchTerm);
                            } else {
                                this.onSearch("failed", resultID, this.searchResults.length, "Invalid search index");
                            }

                            return;
                        }

                        var result = this.searchResults[resultID];
                        if (result.pageID < 0 || result.pageID >= this.pages.length) {
                            this.onSearch("failed", resultID, this.searchResults.length, "Invalid page index");
                            return;
                        }

                        var self = this;
                        this.pages[result.pageID].render(this.scale, null, function (page, status) {
                            page.highlightTextItem(result.itemID, result.matchPos, self.searchTerm);
                            self.searchHighlightResultID = resultID;
                            self.onSearch("done", self.searchHighlightResultID, self.searchResults.length, self.searchTerm);
                        });
                    },
                    clearLastSearchHighlight: function () {
                        var resultID = this.searchHighlightResultID;
                        if (resultID < 0 || resultID >= this.searchResults.length) {
                            return;
                        }

                        this.searchHighlightResultID = -1;

                        var result = this.searchResults[resultID];
                        if (result === null) {
                            return;
                        }

                        var textLayer = this.pages[result.pageID].textLayer;
                        if (textLayer === null) {
                            return;
                        }

                        var textDivs = textLayer.children();
                        if (textDivs === null || textDivs.length === 0) {
                            return;
                        }

                        if (result.itemID < 0 || result.itemID >= textDivs.length) {
                            return;
                        }

                        var item = textDivs[result.itemID];
                        if (item.childNodes.length !== 3) {
                            return;
                        }

                        item.replaceChild(item.childNodes[1].firstChild, item.childNodes[1]);
                        item.normalize();
                    }
                };

                function PDFViewerAPI(viewer) {
                    this.viewer = viewer;
                }

                PDFViewerAPI.prototype = {
                    findNext: function () {
                        if (this.viewer.searchHighlightResultID === -1) {
                            return;
                        }

                        var nextHighlightID = this.viewer.searchHighlightResultID + 1;
                        if (nextHighlightID >= this.viewer.searchResults.length) {
                            nextHighlightID = 0;
                        }

                        this.viewer.highlightSearchResult(nextHighlightID);
                    },
                    findPrev: function () {
                        if (this.viewer.searchHighlightResultID === -1) {
                            return;
                        }

                        var prevHighlightID = this.viewer.searchHighlightResultID - 1;
                        if (prevHighlightID < 0) {
                            prevHighlightID = this.viewer.searchResults.length - 1;
                        }

                        this.viewer.highlightSearchResult(prevHighlightID);
                    }
                };

                $scope.lastScrollY = 0;

                $scope.onSearch = function (status, curResultID, totalResults, message) {
                    if (status === "searching") {
                    } else if (status === "failed") {
                        console.log("Search failed: " + message);
                    } else if (status === "done") {
                        this.searchResultId = curResultID + 1;
                        this.searchNumOccurences = totalResults;
                    } else if (status === "reset") {
                        this.searchResultId = 0;
                        this.searchNumOccurences = 0;
                    }
                };

                $scope.viewer = new PDFViewer();
                $scope.viewer.onSearch = angular.bind($scope, $scope.onSearch);
                $scope.api = $scope.viewer.getAPI();

                $scope.onPDFInit = function () {
                    $element.empty();
                    this.viewer.setUrl(this.src, $element);
                };

                $element.bind("scroll", function (event) {
                    $scope.$apply(function () {
                        var scrollTop = $element[0].scrollTop;

                        var scrollDir = scrollTop - $scope.lastScrollY;
                        $scope.lastScrollY = scrollTop;

                        var normalizedScrollDir = scrollDir > 0 ? 1 : (scrollDir < 0 ? -1 : 0);
                        $scope.viewer.renderAllVisiblePages(normalizedScrollDir);
                    });
                });

            }],
            link: function (scope, element, attrs) {

                if (scope.src !== undefined && scope.src !== null && scope.src !== '') {
                    scope.onPDFInit();
                }

                attrs.$observe("searchTerm", function (searchTerm) {
                    if (searchTerm !== undefined && searchTerm !== null && searchTerm !== '') {
                        scope.viewer.search(searchTerm);
                    } else {
                        scope.viewer.resetSearch();
                    }
                });
            }
        };
    }


};