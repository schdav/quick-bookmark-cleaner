var bookmarks = {
    queue: [],
    error: [],
    invalid: [],
    emptyFolder: [],
    local: [],
    redirect: [],
    ok: [],
    duplicate: []
};

var concurrentRequests;
var timeout;
var method;
var ignoreHttps;
var multipleRetries;

var counter = 0;
var finishedCounter = 0;
var totalRequests = 0;
var totalElements = 0;

var $formOptions = document.getElementById('form-options');
var $concurrentRequests = document.getElementById('concurrent-requests');
var $requestTimeout = document.getElementById('request-timeout');
var $httpMethod = document.getElementById('http-method');
var $progress = document.getElementById('progress');
var $testingUrl = document.getElementById('testing-url');
var $filterBookmarks = document.getElementById('filter-bookmarks');
var $deleteAll = document.getElementById('delete-all');
var $updateAll = document.getElementById('update-all');
var $table = document.getElementById('table');
var $ignoreHttps = document.getElementById('ignore-https');
var $optionsSection = document.getElementById('options-section');
var $resultsSection = document.getElementById('results-section');
var $progressSection = document.getElementById('progress-section');
var $multipleRetries = document.getElementById('multiple-retries');
var $footer = document.getElementById('footer');

var allBookmarks = [];
var retries = 0;
var start;
var end;


function readBookmark(node, path) {
    var children = node.children;
    var isLink = !children;

    var opt = {
        title: node.title,
        url: node.url,
        id: node.id,
        fullPath: path.join(' > '),
        status: '?'
        // redirectTo: if 301, 302
    };

    if (isLink) {

        if (!allBookmarks.some(e => isSameUrl(e.url, node.url))) {

            allBookmarks.push(node);

            // Is valid URL?
            try {
                var url = new URL(node.url);
                if (url.protocol === 'file:') {
                    bookmarks.local.push(opt);
                }
                else if (url.host) {
                    bookmarks.queue.push(opt);
                }
                else {
                    bookmarks.invalid.push(opt);
                }
            }
            catch(e) {
                bookmarks.invalid.push(opt);
            }
        } else {
            bookmarks.duplicate.push(opt);
        }

        totalElements++;
        // bookmarks.all.push(opt);
        return;
    }

    // Is folder and title is not empty
    if (node.title) {
        path.push(node.title);
    }

    var i;
    var len = children.length;

    if (!['0', '1', '2'].includes(opt.id)) {
        totalElements++;

        if(!len) {
            bookmarks.emptyFolder.push(opt);
        }
    }

    for (i = 0; i < len; i++) {
        readBookmark(children[i], path.slice(0));
    }
}


function deleteBookmark(id, callback) {
    chrome.bookmarks.remove(id, function() {
        callback(!chrome.runtime.lastError);
    });
}


function updateBookmark(id, opt, callback) {
    chrome.bookmarks.update(id, opt, function() {
        callback(!chrome.runtime.lastError);
    });
}


function isSameUrl(str1, str2) {
    var url1 = new URL(str1);
    var url2 = new URL(str2);
    var protocols = ['http:', 'https:'];

    if (ignoreHttps) {
        return protocols.includes(url1.protocol) &&
            protocols.includes(url2.protocol) &&
            url1.host === url2.host &&
            url1.pathname === url2.pathname &&
            url1.search === url2.search;
    } else {
        return url1.protocol === url2.protocol &&
            url1.host === url2.host &&
            url1.pathname === url2.pathname &&
            url1.search === url2.search;
    }
}


function httpRequest() {
    var bookmark = bookmarks.queue.shift();

    if (!bookmark) {
        finished();
        return;
    }

    // Show current url - only first 60 characters
    $testingUrl.innerHTML = bookmark.url.len > 60 ?
        `${htmlEscape(bookmark.url.substring(0, 60))}...` :
        htmlEscape(bookmark.url);

    // Start HTTP request
    var xhr = new XMLHttpRequest();
    xhr.timeout = timeout;
    xhr.open(method, bookmark.url, true);

    xhr.onreadystatechange = function() {
        if (xhr.readyState === XMLHttpRequest.DONE) {
            counter++;

            // Progress bar
            var percentage = Math.round(100 * (counter / totalRequests));
            $progress.value = percentage;

            bookmark.status = xhr.status;

            // 2xx - 3xx
            if (xhr.status >= 200 && xhr.status < 400) {
                // 2xx
                if (isSameUrl(xhr.responseURL, bookmark.url)) {
                    bookmarks.ok.push(bookmark);
                    httpRequest();
                }
                // 3xx
                else {
                    bookmark.status = '3xx';
                    bookmark.redirectTo = xhr.responseURL;
                    bookmarks.redirect.push(bookmark);
                    httpRequest();
                }
            }
            // 1xx and 4xx - 5xx
            else {
                if (retries < multipleRetries) {
                    retries++;
                    bookmarks.queue.unshift(bookmark);
                    counter--;
                    httpRequest();
                } else {
                    bookmarks.error.push(bookmark);
                    httpRequest();
                }
            }
        }
    };
    xhr.send();
}


function finished() {
    finishedCounter++;

    if (finishedCounter < concurrentRequests) {
        // There are still http requests in progress
        return;
    }

    // Now it's over

    // Hide options (timeout, method, etc) and progress bar
    $optionsSection.style.display = 'none';
    $progressSection.style.display = 'none';

    // Show filter (Error, redirected, etc)
    $resultsSection.style.display = 'block';

    // Show counter for each filter
    Array.from($filterBookmarks).forEach(function(e) {
        e.innerHTML += ' (' + bookmarks[e.value].length + ')';
    });

    // Show table via renderTemplate
    $filterBookmarks.dispatchEvent(new Event('change'));
        
    end = new Date();
    
    $footer.style.display = 'block';
    $footer.innerHTML = `Checked ${totalElements} element(s) in ${end - start} ms.`
}


function renderTemplate(list, opt) {
    var tpl;

    opt = opt || {};

    if (!list.length) {
        $table.style.display = 'none';
        $deleteAll.disabled = true;
        $updateAll.disabled = true;
        return;
    } else if (opt.ok) {
        $table.style.display = 'block';
        $deleteAll.disabled = true;
        $updateAll.disabled = true;
    } else if (opt.redirect) {
        $table.style.display = 'block';
        $deleteAll.disabled = false;
        $updateAll.disabled = false;
    } else {
        $table.style.display = 'block';
        $deleteAll.disabled = false;
        $updateAll.disabled = true;
    }

    tpl = '<table>';

    tpl += '<thead>';
    tpl += '<tr>';
    tpl += '<th>Code</th>';
    tpl += '<th>Title</th>';

    if (opt.ok) {
        tpl += '<th colspan="2">URL</th>';
    }
    else if (opt.redirect) {
        tpl += '<th>URL</th>';
        tpl += '<th colspan="4">New URL</th>';
    }
    else {
        tpl += '<th colspan="3">URL</th>';
    }

    tpl += '</tr>';
    tpl += '</thead>';

    tpl += '<tbody>';


    var id;
    var code;
    var title;
    var fullPath;
    var url;
    var redirectTo;
    var editable = 'contentEditable spellcheck="false"';

    for (var i = 0, len = list.length; i < len; i++) {
        id = list[i].id;
        code = list[i].status;
        title = htmlEscape(list[i].title);
        fullPath = htmlEscape(list[i].fullPath);
        url = list[i].url;
        redirectTo = htmlEscape(list[i].redirectTo);

        tpl += '<tr data-id="' + id + '" data-array="' + opt.classTr + '">';
        tpl += '<td>' + code + '</td>';
        tpl += '<td class="td-title" ' + editable + ' title="' +
            fullPath + '">' + title + '</td>';


        if (url) {
            url = htmlEscape(url);
            tpl += '<td ' + editable + '>' + url + '</td>';
        }
        // URL is undefined when bookmark is an empty folder
        else {
            url = 'chrome://bookmarks/?id=' + id;
            tpl += '<td>' + url + '</td>';
        }

        if (opt.redirect) {
            tpl += '<td>' + redirectTo + '</td>';
        }

        tpl += '<td class="td-link" title="Visit link"></td>';

        if (!opt.ok) {
            tpl += '<td class="td-remove" title="Delete bookmark"></td>';
        }

        if (opt.redirect) {
            tpl += '<td class="td-update" title="Update URL to new URL"></td>';
        }

        tpl += '</tr>';
    }

    tpl += '</tbody>';
    tpl += '</table>';

    $table.innerHTML = tpl;
}


function htmlEscape(str) {
    var map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&#34;',
        "'": '&#39;'
    };

    return ('' + str).replace(/[&<>"']/g, function(match) {
        return map[match];
    });
}

function addEvent(obj, type, callback) {
    obj.addEventListener(type, callback);
}

function updateBookmarkCount(type, count) {
    var $option = $filterBookmarks.querySelector('[value="' + type + '"]');

    // Remove current counter from <option>
    var html = $option.innerHTML.split(' ');
    html.pop();

    // Set new counter to <option>
    html.push('(' + count + ')');
    html = html.join(' ');
    $option.innerHTML = html;

    if (!count) {
        $table.style.display = 'none';
    }
}


// Press Start
addEvent($formOptions, 'submit', function(e) {
    e.preventDefault();

    // Set options
    concurrentRequests = +$concurrentRequests.value;
    timeout = $requestTimeout.value * 1000;
    method = $httpMethod.value;
    ignoreHttps = $ignoreHttps.checked;
    multipleRetries = $multipleRetries.value;

    $optionsSection.style.display = 'none';
    $progressSection.style.display = 'block';

    chrome.bookmarks.getTree(function(nodes) {
        start = new Date();

        // Read all bookmarks recursively and set the variable bookmarks.queue
        readBookmark(nodes[0], []);

        totalRequests = bookmarks.queue.length;

        for (var i = 0; i < concurrentRequests; i++) {
            httpRequest();
        }
    });
});


// Change filter
addEvent($filterBookmarks, 'change', function() {
    var value = this.value;
    var isRedirect = value === 'redirect';
    var isOk = value === 'ok';

    renderTemplate(bookmarks[value], {
        classTr: value,
        redirect: isRedirect,
        ok: isOk
    });
});


// Delete all
addEvent($deleteAll, 'click', function(e) {
    e.preventDefault();

    var type = $filterBookmarks.value;

    if (confirm(`Are you sure? This will delete ${bookmarks[type].length} element(s)!`)) {
        bookmarks[type].forEach(function(bookmark) {
            deleteBookmark(bookmark.id, function() { });
        });

        updateBookmarkCount(type, 0);
    }
});

// Update all
addEvent($updateAll, 'click', function(e) {
    e.preventDefault();

    var type = $filterBookmarks.value;

    bookmarks[type].forEach(function(bookmark) {
        var opt = { url: bookmark.redirectTo };
        updateBookmark(bookmark.id, opt, function() { });
    });

    updateBookmarkCount(type, 0);
});

// Click remove, update or link
addEvent($table, 'click', function(e) {
    var $target = e.target;
    var $parent = $target.parentNode;
    var className = $target.className;
    var bookmarkId;
    var bookmarkUrl;
    var bookmarkRedirectUrl;

    function deleteElement() {
        var type = $parent.getAttribute('data-array');

        // Remove element from or bookmarks.error, etc...
        bookmarks[type] = bookmarks[type].filter(function(e) {
            return e.id !== bookmarkId;
        });

        // Remove line from HTML
        $parent.parentNode.removeChild($parent);

        var count = bookmarks[type].length;

        updateBookmarkCount(type, count);
    }

    if (className === 'td-remove') {
        bookmarkId = $parent.getAttribute('data-id');

        deleteBookmark(bookmarkId, function(success) {
            if (success) {
                deleteElement();
            }
        });
    }

    else if (className === 'td-update') {
        bookmarkId = $parent.getAttribute('data-id');
        bookmarkRedirectUrl = $parent.children[3].innerText;

        var opt = {
            url: bookmarkRedirectUrl
        };

        updateBookmark(bookmarkId, opt, function(success) {
            if (success) {
                deleteElement();
            }
        });
    }

    else if (className === 'td-link') {
        bookmarkUrl = $parent.children[2].innerText;

        chrome.tabs.create({
            url: bookmarkUrl
        });
    }
});


// Change title or URL
addEvent($table, 'input', function(e) {
    var $target = e.target;
    var $parent = $target.parentNode;
    var className = $target.className;

    var bookmarkId = $parent.getAttribute('data-id');
    var text = $target.innerText;

    // Changing title or URL
    var opt = className === 'td-title' ? { title: text } : { url: text };

    updateBookmark(bookmarkId, opt, function() { });
});
