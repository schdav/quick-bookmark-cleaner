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
    };

    if (isLink) {
        if (!allBookmarks.some(e => isSameUrl(e.url, node.url))) {
            allBookmarks.push(node);

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
            catch (e) {
                bookmarks.invalid.push(opt);
            }
        } else {
            bookmarks.duplicate.push(opt);
        }

        totalElements++;
        return;
        // Folder
    } else {
        if (node.title) {
            path.push(node.title);
        }

        if (!['0', '1', '2'].includes(opt.id)) {
            totalElements++;

            if (!children.length) {
                bookmarks.emptyFolder.push(opt);
            }
        }

        for (var i = 0; i < children.length; i++) {
            readBookmark(children[i], path.slice(0));
        }
    }
}


function deleteBookmark(id, callback) {
    chrome.bookmarks.remove(id, function () {
        callback(!chrome.runtime.lastError);
    });
}


function updateBookmark(id, opt, callback) {
    chrome.bookmarks.update(id, opt, function () {
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

    $testingUrl.innerHTML = bookmark.url.len > 60 ?
        `${htmlEscape(bookmark.url.substring(0, 60))}...` :
        htmlEscape(bookmark.url);

    var xhr = new XMLHttpRequest();
    xhr.timeout = timeout;
    xhr.open(method, bookmark.url, true);

    xhr.onreadystatechange = function () {
        if (xhr.readyState === XMLHttpRequest.DONE) {
            counter++;
            $progress.value = Math.round(100 * (counter / totalRequests));

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

    $optionsSection.style.display = 'none';
    $progressSection.style.display = 'none';
    $resultsSection.style.display = 'block';

    Array.from($filterBookmarks).forEach(function (e) {
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

    for (var i = 0; i < list.length; i++) {
        id = list[i].id;
        code = list[i].status;
        title = htmlEscape(list[i].title);
        fullPath = htmlEscape(list[i].fullPath);
        url = list[i].url;
        redirectTo = htmlEscape(list[i].redirectTo);

        tpl += '<tr data-id="' + id + '">';
        tpl += '<td>' + code + '</td>';
        tpl += '<td class="td-title" ' + editable + ' title="' + fullPath + '">' + title + '</td>';

        if (url) {
            url = htmlEscape(url);
            tpl += '<td ' + editable + '>' + url + '</td>';
        }
        // Empty folder
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

    return ('' + str).replace(/[&<>"']/g, function (match) {
        return map[match];
    });
}


function updateBookmarkCount(type, count) {
    var $option = $filterBookmarks.querySelector('[value="' + type + '"]');

    var html = $option.innerHTML.split(' ');
    html.pop();
    html.push('(' + count + ')');
    html = html.join(' ');
    $option.innerHTML = html;

    if (!count) {
        $table.style.display = 'none';
        $deleteAll.disabled = true;
        $updateAll.disabled = true;
    }
}


// Press Start
$formOptions.addEventListener('submit', function (e) {
    e.preventDefault();

    concurrentRequests = Math.abs($concurrentRequests.value);
    timeout = Math.abs($requestTimeout.value) * 1000;
    method = $httpMethod.value;
    ignoreHttps = $ignoreHttps.checked;
    multipleRetries = Math.abs($multipleRetries.value);

    $optionsSection.style.display = 'none';
    $progressSection.style.display = 'block';

    chrome.bookmarks.getTree(function (nodes) {
        start = new Date();

        readBookmark(nodes[0], []);

        totalRequests = bookmarks.queue.length;

        for (var i = 0; i < concurrentRequests; i++) {
            httpRequest();
        }
    });
});


$filterBookmarks.addEventListener('change', function () {
    var value = this.value;
    var isRedirect = value === 'redirect';
    var isOk = value === 'ok';

    renderTemplate(bookmarks[value], { redirect: isRedirect, ok: isOk });
});


$deleteAll.addEventListener('click', function (e) {
    e.preventDefault();

    var type = $filterBookmarks.value;

    if (confirm(`Are you sure? This will delete ${bookmarks[type].length} element(s)!`)) {
        bookmarks[type].forEach(function (bookmark) {
            deleteBookmark(bookmark.id, function () { });
        });

        updateBookmarkCount(type, 0);
    }
});


$updateAll.addEventListener('click', function (e) {
    e.preventDefault();

    var type = $filterBookmarks.value;

    bookmarks[type].forEach(function (bookmark) {
        var opt = { url: bookmark.redirectTo };
        updateBookmark(bookmark.id, opt, function () { });
    });

    updateBookmarkCount(type, 0);
});

$table.addEventListener('click', function (e) {
    var $target = e.target;
    var $parent = $target.parentNode;
    var className = $target.className;
    var bookmarkId = $parent.getAttribute('data-id');

    function deleteElement() {
        var type = $filterBookmarks.value;

        bookmarks[type] = bookmarks[type].filter(function (e) {
            return e.id !== bookmarkId;
        });

        $parent.parentNode.removeChild($parent);

        updateBookmarkCount(type, bookmarks[type].length);
    }

    if (className === 'td-remove') {
        deleteBookmark(bookmarkId, function (success) {
            if (success) {
                deleteElement();
            }
        });
    }
    else if (className === 'td-update') {
        var opt = {
            url: $parent.children[3].innerText
        };

        updateBookmark(bookmarkId, opt, function (success) {
            if (success) {
                deleteElement();
            }
        });
    }
    else if (className === 'td-link') {
        chrome.tabs.create({
            url: $parent.children[2].innerText
        });
    }
});


$table.addEventListener('input', function (e) {
    var $target = e.target;
    var $parent = $target.parentNode;
    var className = $target.className;
    var bookmarkId = $parent.getAttribute('data-id');

    var opt = className === 'td-title' ? { title: $target.innerText } : { url: $target.innerText };

    updateBookmark(bookmarkId, opt, function () { });
});
