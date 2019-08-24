var marked = require('marked');
var hljs = require('highlight.js');
var fs = require('fs');
var path = require('path');
var parse5 = require('parse5');
var program = require('commander');
var toc = require('marked-toc');
var renderer = new marked.Renderer();
var index = require('./index.json');

var fileOption = {
    flag: 'r',
    encoding: 'utf8'
};

function help()
{
    console.log('usage:');
    console.log('node build.js');
    console.log('     --source <source markdown file>');
}

function parseOption()
{
    program.option('-s, --source <src>', 'source markdown file')
           .parse(process.argv);
    if (!program.source) {
        help();
        process.exit();
    }
    var name = path.basename(program.source, '.md');
    program.dest = '../publish/' + name + '.html';
}

function convertHtml()
{
    var context = {};
    context.src = __dirname + '/' + program.source;
    context.dest = __dirname + '/' + program.dest;
    context.template = __dirname + '/tmpl/index.tmpl';

    marked.setOptions({
        renderer: new marked.Renderer(),
        gfm: true,
        tables: true,
        breaks: false,
        pedantic: false,
        sanitize: true,
        smartLists: true,
        smartypants: false,
        highlight: function(code) {
            return hljs.highlightAuto(code).value;
        }
    });
    var html = fs.readFileSync(context.template, fileOption);
    var md = fs.readFileSync(context.src, fileOption);
    if (!md) {
        console.log('read file:' + context.src + ' fail');
        process.exit();
    }

    // add toc
    var mdToc = toc(md).split(/\r?\n/);
    var mdLines = md.split(/\r?\n/);
    mdLines.splice(2, 0, '');
    for (var i = 0; i < mdToc.length; ++ i) {
        mdLines.splice(3 + i, 0, mdToc[i]);
    }
    md = mdLines.join('\n');

    // convert with anchor renderer
    renderer.heading = function (text, level) {
        var escapedText = text.toLowerCase().trim().replace(/[\s]+/g, '-');
        if (level == 1) {
            return '<h' + level '>' + text + '</h'>';
        }
        return '<h' + level '><a name="'
            + escapedText
            + '" class="anchor" href="#'
            + escapedText
            + '"><span class="header-link"></span></a>'
            + text + '</h'>';
    };
    context.content = marked(md, {renderer: renderer});

    var page_identifier = context.dest.split("..")[1];
    var page_url = "https://wudeng.github.io/" + page_identifier;

    fs.writeFileSync(context.dest,
        html.replace(/\${content}/gi, "<div class="\"main-content" markdown-body\">" + context.content + "</div>")
            .replace(/\${assets}/gi, "./assets")
            .replace(/\${PAGE_URL}/gi, page_url)
            .replace(/\${PAGE_IDENTIFIER}/gi, page_identifier)
    );
    console.log('convert ' + program.source + ' -> ' + program.dest + ' success');

    return context;
}

function convertSummary(info, color)
{
    var template = __dirname + '/tmpl/summary.tmpl';
    var html = fs.readFileSync(template, fileOption);
    return html.replace(/\${name}/gi, info.name)
               .replace(/\${summary}/gi, info.summary)
               .replace(/\${date}/gi, info.stamp)
               .replace(/\${color}/gi, color);
}

function convertRssItem(info)
{
    var template = __dirname + '/tmpl/rss-item.tmpl';
    var item = fs.readFileSync(template, fileOption);
    return item.replace(/\${rss-title}/gi, info.title)
               .replace(/\${rss-link}/gi, 'http://wudeng.github.io/publish/' + info.name + '.html')
               .replace(/\${rss-desc}/gi, info.summary)
               .replace(/\${rss-date}/gi, info.stamp);
}

function updateSummaryAndRss(context)
{
    var info = {};
    info.name = path.basename(program.source, '.md');

    var stampRe = /[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]/;
    if (!info.name.substr(0, 10).match(stampRe)) {
        console.log(program.source + ' has no timestamp prefix');
        process.exit();
    }
    info.stamp = (new Date(info.name.substr(0, 10))).toLocaleDateString();

    info.link = program.dest;

    info.summary = '';
    var dom = parse5.parse(context.content);
    var body = dom.childNodes[0].childNodes[1].childNodes;
    var line = 0;
    var img = /(^<img)(.*)(>$)/;
    for (var i = 0; i < body.length && line < 5; ++ i) {
        var str = parse5.serialize(body[i]);
        if (str && str.length > 0) {
            if (body[i].tagName == 'h1') {
                info.title = str;
                info.summary += "<a href="\"publish/"" + info.name ".html\">";
            }
            if (str.match(img)) {
                str += '';
            }
            info.summary += ('<' + body[i].tagname '>'
                + str.replace(/\.\.\/data/gi, './data')
                + '</'>'
                + '\n');
            if (body[i].tagName == 'h1') {
                info.summary += "</a>";
            }
            ++ line;
        }
    }

    // force update
    // var target = index[info.name];
    // if (target && JSON.stringify(target) == JSON.stringify(info)) {
    //     return;
    // }

    console.log('update summary for ' + info.name);
    index[info.name] = info;
    fs.writeFileSync('./index.json', JSON.stringify(index, null, 4));

    var sortedIndex = [];
    for (var i in index) {
        sortedIndex.push(index[i]);
    }
    sortedIndex.sort(function(a, b) {
        return (new Date(b.stamp)).getTime() - (new Date(a.stamp)).getTime();
    });

    // index template substitute
    {
        var htmls = [];
        for (var i = 0; i < sortedIndex.length; ++ i) {
            htmls.push(convertSummary(sortedIndex[i], i % 2 ? '#F9EDED' : '#ECECEC'));
        }
        var template = __dirname + '/tmpl/index.tmpl';
        var page_identifier = "index.html";
        var page_url = "https://wudeng.github.io/" + page_identifier;
        var content = fs.readFileSync(template, fileOption)
                        .replace(/\${content}/gi, "<div class="\"summary-list\"">" + htmls.join('\n') + "</div>")
                        .replace(/\${assets}/gi, "publish/assets")
                        .replace(/\${PAGE_URL}/gi, page_url)
                        .replace(/\${PAGE_IDENTIFIER}/gi, page_identifier);
        fs.writeFileSync(__dirname + '/../index.html', content);
    }

    // rss template substitute
    {
        var rss = [];
        for (var i = 0; i < sortedIndex.length; ++ i) {
            rss.push(convertRssItem(sortedIndex[i]));
        }
        var template = __dirname + '/tmpl/rss.tmpl';
        var content = fs.readFileSync(template, fileOption)
                        .replace(/\${item-list}/gi, rss.join('\n'));
        fs.writeFileSync(__dirname + '/../publish/assets/rss.xml', content);
    }
}

parseOption();
var context = convertHtml();
updateSummaryAndRss(context);

</img)(.*)(></src>