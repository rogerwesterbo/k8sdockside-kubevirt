// The drawing kit the KubeVirt pages share: icons, chips and buttons, the
// honeycomb of machines, the machine's "screen" badge, meters, the tooltip,
// the charts, and the guard that keeps a poll from redrawing whatever is
// under the user's pointer.
//
// Everything that came from the cluster is written with textContent, never
// innerHTML: the frame is sandboxed, but a page that let a machine's name run
// as markup would be handing that name the bridge.
(function () {
    'use strict';

    var M = window.KubeVirt;
    var SVG = 'http://www.w3.org/2000/svg';
    var FALLBACK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined && text !== null) node.textContent = text;
        return node;
    }

    function add(parent) {
        for (var i = 1; i < arguments.length; i++) {
            var child = arguments[i];
            if (child === null || child === undefined || child === false || child === '') continue;
            parent.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
        }
        return parent;
    }

    function svg(tag, attrs) {
        var node = document.createElementNS(SVG, tag);
        Object.keys(attrs || {}).forEach(function (k) {
            node.setAttribute(k, attrs[k]);
        });
        return node;
    }

    // Single-stroke icons on a 24-unit grid. The action icons carry the same
    // names the manifest gives them (play, pause, repeat, power, forward, stop).
    var ICONS = {
        logo: ['M3 4.5h18v12H3z', 'M8.5 20h7', 'M12 16.5V20', 'M12 7l3.2 1.8v3.6L12 14.2l-3.2-1.8V8.8z', 'M12 10.6l3.2-1.8', 'M12 10.6v3.6', 'M12 10.6L8.8 8.8'],
        monitor: ['M3 5h18v11H3z', 'M8 20h8', 'M12 16v4'],
        play: ['M7 4.5v15l12-7.5z'],
        pause: ['M7 5h3.5v14H7z', 'M13.5 5H17v14h-3.5z'],
        stop: ['M6 6h12v12H6z'],
        power: ['M12 3v8', 'M6.3 6.3a8 8 0 1 0 11.4 0'],
        repeat: ['M17 2l4 4-4 4', 'M3 11V9a4 4 0 0 1 4-4h14', 'M7 22l-4-4 4-4', 'M21 13v2a4 4 0 0 1-4 4H3'],
        forward: ['M3 8h5v8H3z', 'M16 8h5v8h-5z', 'M9.5 12h5', 'M12.5 10l2 2-2 2'],
        alert: ['M12 3l10 18H2z', 'M12 10v4', 'M12 17.5h.01'],
        check: ['M4 12.5l5 5L20 6.5'],
        close: ['M6 6l12 12', 'M18 6L6 18'],
        arrow: ['M5 12h14', 'M13 6l6 6-6 6'],
        open: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v6H4V6h6'],
        edit: ['M4 20h4L19 9l-4-4L4 16z', 'M14 6l4 4'],
        clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7v5l3 2'],
        search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'M20 20l-4-4'],
        cpu: ['M7 7h10v10H7z', 'M10 10h4v4h-4z', 'M9.5 3v4', 'M14.5 3v4', 'M9.5 17v4', 'M14.5 17v4', 'M3 9.5h4', 'M3 14.5h4', 'M17 9.5h4', 'M17 14.5h4'],
        memory: ['M3 7h18v9H3z', 'M7 10v3', 'M11 10v3', 'M15 10v3', 'M6 16v3', 'M10 16v3', 'M14 16v3', 'M18 16v3'],
        disk: ['M3 13.5h18V19H3z', 'M5 13.5L8 5h8l3 8.5', 'M7 16.3h.01', 'M10 16.3h.01'],
        network: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M3.5 12h17', 'M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9', 'M12 3c-2.5 2.5-3.5 5.5-3.5 9s1 6.5 3.5 9'],
        node: ['M4 5h16v5H4z', 'M4 14h16v5H4z', 'M7.5 7.5h.01', 'M7.5 16.5h.01'],
        pod: ['M20 8 12 4 4 8v8l8 4 8-4V8z', 'M4 8l8 4 8-4', 'M12 12v8'],
        windows: ['M4 5.5l7-1V11H4z', 'M13 4.2l7-1V11h-7z', 'M4 13h7v6.5l-7-1z', 'M13 13h7v7.8l-7-1z'],
        linux: ['M4 5h16v14H4z', 'M7.5 9.5l3 2.5-3 2.5', 'M12.5 15h4'],
        activity: ['M3 12h4l3-8 4 16 3-8h4'],
        chart: ['M4 4v16h16', 'M8 15l3-4 3 2 5-6'],
        grid: ['M4 4h7v7H4z', 'M13 4h7v7h-7z', 'M4 13h7v7H4z', 'M13 13h7v7h-7z'],
        logs: ['M5 3.5h14v17H5z', 'M8.5 8h7', 'M8.5 12h7', 'M8.5 16h4'],
        layers: ['M12 3 3 8l9 5 9-5-9-5z', 'M3 13l9 5 9-5'],
        bolt: ['M13 3L5 14h6l-1 7 8-11h-6z'],
        pin: ['M12 21s-7-6.2-7-11a7 7 0 1 1 14 0c0 4.8-7 11-7 11z', 'M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z'],
        tag: ['M3 12V4h8l10 10-8 8z', 'M7.5 8.5h.01'],
        lock: ['M6 11h12v9H6z', 'M8.5 11V8a3.5 3.5 0 0 1 7 0v3'],
        agent: ['M8 4h8v5H8z', 'M5 9h14v11H5z', 'M9 13h.01', 'M15 13h.01', 'M9.5 17h5'],
        settings: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2.1-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2.1 1.2l-2.3-.9-2 3.4 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2.1 1.2L10 21h4l.5-2.6a7 7 0 0 0 2.1-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z'],
    };

    function icon(name, className) {
        var node = svg('svg', { viewBox: '0 0 24 24', class: 'ico' + (className ? ' ' + className : ''), 'aria-hidden': 'true' });
        (ICONS[name] || ICONS.monitor).forEach(function (d) {
            node.appendChild(svg('path', { d: d }));
        });
        return node;
    }

    function chip(text, tone, iconName, title) {
        var node = el('span', 'chip' + (tone ? ' ' + tone : ''));
        if (iconName) node.appendChild(icon(iconName));
        node.appendChild(el('span', '', text));
        if (title) node.title = title;
        return node;
    }

    var GROUP_ICON = { running: 'play', paused: 'pause', migrating: 'forward', changing: 'clock', stopped: 'stop', failing: 'alert' };

    function stateChip(machine) {
        var text = machine.stuck ? machine.status + ' (stuck)' : machine.status;
        return chip(text, machine.tone, GROUP_ICON[machine.group], machine.reason || '');
    }

    function button(text, className, iconName, onClick) {
        var node = el('button', className || '');
        node.type = 'button';
        if (iconName) node.appendChild(icon(iconName));
        if (text) node.appendChild(el('span', '', text));
        if (onClick) node.addEventListener('click', onClick);
        return node;
    }

    function link(text, onClick, title) {
        var node = el('button', 'link', text);
        node.type = 'button';
        if (title) node.title = title;
        node.addEventListener('click', onClick);
        return node;
    }

    function ago(t) {
        if (!t) return '';
        var seconds = Math.max(0, (Date.now() - t) / 1000);
        if (seconds < 10) return 'just now';
        if (seconds < 90) return Math.round(seconds) + 's ago';
        if (seconds < 5400) return Math.round(seconds / 60) + 'm ago';
        if (seconds < 172800) return Math.round(seconds / 3600) + 'h ago';
        return Math.round(seconds / 86400) + 'd ago';
    }

    function span(t) {
        if (!t) return '';
        var seconds = Math.max(0, (Date.now() - t) / 1000);
        if (seconds < 90) return Math.round(seconds) + 's';
        if (seconds < 5400) return Math.round(seconds / 60) + 'm';
        if (seconds < 172800) return Math.round(seconds / 3600) + 'h';
        return Math.round(seconds / 86400) + 'd';
    }

    // The badge a machine is drawn with: a small screen tinted by its state,
    // showing what it runs.
    function screen(machine, size) {
        var node = el('span', 'screen ' + machine.tone + (size ? ' ' + size : '') + (machine.group === 'changing' ? ' busy' : '') + (machine.group === 'migrating' ? ' moving' : ''));
        node.appendChild(icon(machine.os.family === 'windows' ? 'windows' : machine.os.family === 'linux' ? 'linux' : 'monitor'));
        return node;
    }

    // A stacked bar of counts, each segment labelled underneath.
    // segments: [{ label, count, tone, id }]
    function stackBar(segments, onPick) {
        var total = segments.reduce(function (s, x) {
            return s + x.count;
        }, 0);
        var wrap = el('div', 'stack');
        var bar = el('div', 'stack-bar');
        var keys = el('div', 'stack-keys');
        segments.forEach(function (seg) {
            if (!seg.count) return;
            var part = el('i', 'seg ' + seg.tone);
            part.style.flexGrow = String(seg.count);
            part.title = seg.label + ': ' + seg.count;
            bar.appendChild(part);
            var key = onPick
                ? button('', 'stack-key', null, function () {
                      onPick(seg);
                  })
                : el('span', 'stack-key');
            add(key, el('i', 'dot ' + seg.tone), el('span', '', seg.label), el('strong', '', String(seg.count)));
            keys.appendChild(key);
        });
        if (!total) bar.appendChild(el('i', 'seg muted empty'));
        add(wrap, bar, keys);
        return wrap;
    }

    function fillTone(fraction) {
        if (fraction >= 0.95) return 'error';
        if (fraction >= 0.8) return 'warn';
        return 'ok';
    }

    // A thin bar filled to a fraction, tinted by how full it is.
    function meter(fraction, tone) {
        var node = el('span', 'meter ' + (tone || fillTone(fraction)));
        var fill = el('i');
        fill.style.width = fraction > 0 ? Math.min(100, Math.max(2, fraction * 100)) + '%' : '0';
        node.appendChild(fill);
        return node;
    }

    function percent(fraction) {
        if (!isFinite(fraction) || fraction <= 0) return '0%';
        if (fraction < 0.01) return '<1%';
        return Math.round(fraction * 100) + '%';
    }

    // ----- the honeycomb -----------------------------------------------------

    // Every machine as a hexagon, worst first: filled by its state, hollow
    // when it is stopped, a moving rim while it migrates. Sized to fit, so a
    // cluster with four hundred machines gets smaller cells, not a scrollbar.
    // opts: { width, maxHeight, onPick(key) }
    function honeycomb(machines, opts) {
        var width = Math.max(180, opts.width || 400);
        var n = Math.max(1, machines.length);
        var r = 18;
        var cols;
        for (;;) {
            var w0 = Math.sqrt(3) * r;
            cols = Math.max(1, Math.floor((width - w0 / 2) / (w0 + 3)));
            var rows = Math.ceil(n / cols);
            if (rows * (r * 1.5 + 3) < (opts.maxHeight || 230) || r <= 7) break;
            r -= 1;
        }
        // A handful of machines is a short row, not a wide one; and the rows
        // are evened out, so sixteen cells are two rows of eight rather than
        // fifteen and one left over.
        cols = Math.min(cols, n);
        cols = Math.ceil(n / Math.ceil(n / cols));
        var w = Math.sqrt(3) * r;
        var stepX = w + 3;
        var stepY = r * 1.5 + 3;
        var rowsUsed = Math.ceil(machines.length / cols);
        var H = rowsUsed * stepY + r * 0.5 + 6;
        var W = cols * stepX + (rowsUsed > 1 ? stepX / 2 : 0) + 4;

        var node = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'hive', role: 'img' });
        node.setAttribute('aria-label', M.plural(machines.length, 'virtual machine'));
        node.style.maxWidth = W + 'px';

        function hexPath(cx, cy, rr) {
            var pts = [];
            for (var i = 0; i < 6; i++) {
                var a = (Math.PI / 180) * (60 * i - 90);
                pts.push((cx + rr * Math.cos(a)).toFixed(1) + ',' + (cy + rr * Math.sin(a)).toFixed(1));
            }
            return pts.join(' ');
        }

        machines.forEach(function (m, i) {
            var row = Math.floor(i / cols);
            var col = i % cols;
            var cx = col * stepX + w / 2 + 2 + (row % 2 ? stepX / 2 : 0);
            var cy = row * stepY + r + 3;
            var cell = svg('polygon', {
                points: hexPath(cx, cy, r - (m.group === 'stopped' ? 1 : 0)),
                class: 'cell ' + m.tone + ' g-' + m.group + (m.stuck ? ' stuck' : ''),
                tabindex: '0',
                role: 'button',
            });
            cell.setAttribute('aria-label', m.name + ', ' + m.status);
            cell.dataset.key = m.key;
            node.appendChild(cell);
        });

        node.addEventListener('click', function (event) {
            var cell = event.target.closest && event.target.closest('.cell');
            if (cell && opts.onPick) opts.onPick(cell.dataset.key);
        });
        node.addEventListener('keydown', function (event) {
            if ((event.key === 'Enter' || event.key === ' ') && event.target.classList.contains('cell') && opts.onPick) {
                event.preventDefault();
                opts.onPick(event.target.dataset.key);
            }
        });
        return node;
    }

    // ----- the tooltip -------------------------------------------------------

    // One floating tip for a root, filled by `describe` for whatever element
    // matching `selector` is under the pointer.
    function tooltip(root, selector, describe) {
        var tip = el('div', 'tip');
        tip.hidden = true;
        tip.setAttribute('role', 'tooltip');
        document.body.appendChild(tip);

        function place(event) {
            var pad = 14;
            var x = event.clientX + pad;
            var y = event.clientY + pad;
            if (x + tip.offsetWidth > window.innerWidth - 8) x = event.clientX - tip.offsetWidth - pad;
            if (y + tip.offsetHeight > window.innerHeight - 8) y = event.clientY - tip.offsetHeight - pad;
            tip.style.left = Math.max(8, x) + 'px';
            tip.style.top = Math.max(8, y) + 'px';
        }

        root.addEventListener('pointerover', function (event) {
            var target = event.target.closest && event.target.closest(selector);
            if (!target) return;
            tip.textContent = '';
            if (!describe(target, tip)) {
                tip.hidden = true;
                return;
            }
            tip.hidden = false;
            place(event);
        });
        root.addEventListener('pointermove', function (event) {
            if (!tip.hidden) place(event);
        });
        root.addEventListener('pointerout', function (event) {
            var target = event.target.closest && event.target.closest(selector);
            if (target && !target.contains(event.relatedTarget)) tip.hidden = true;
        });
        return tip;
    }

    function specLine(m) {
        return [m.cpu.text, m.memory.text].filter(Boolean).join(' · ');
    }

    function describeMachine(m, into) {
        var head = el('div', 'tip-head');
        add(head, screen(m, 'small'), el('strong', 'tip-title', m.name));
        into.appendChild(head);
        into.appendChild(el('div', 'tip-sub', m.namespace + (m.node ? ' · on ' + m.node : '')));
        var chips = el('div', 'tip-chips');
        chips.appendChild(stateChip(m));
        if (m.os.pretty) chips.appendChild(chip(m.os.pretty, 'muted'));
        into.appendChild(chips);
        var spec = specLine(m);
        if (spec) into.appendChild(el('div', 'tip-sub', spec));
        if (m.ips.length) into.appendChild(el('div', 'tip-sub mono', m.ips.slice(0, 3).join(', ')));
        if (m.moving) into.appendChild(el('div', 'tip-sub', 'Migrating ' + (m.moving.source || '?') + ' → ' + (m.moving.target || '…')));
        if (m.reason && m.group !== 'running') into.appendChild(el('div', 'tip-note', m.reason));
        return true;
    }

    // ----- a migration in flight ---------------------------------------------

    // Source node, a track with a guest moving along it, and the target.
    function flight(migration, onNode) {
        var row = el('div', 'flight' + (migration.failed ? ' failed' : migration.inFlight ? ' live' : ' done'));
        function end(name, cls) {
            var box = el('span', 'flight-node ' + cls);
            box.appendChild(icon('node'));
            if (name && onNode) {
                box.appendChild(
                    link(name, function () {
                        onNode(name);
                    }),
                );
            } else {
                box.appendChild(el('span', 'faint', name || (cls === 'to' ? 'choosing…' : '?')));
            }
            return box;
        }
        var track = el('span', 'flight-track');
        track.appendChild(el('i', 'flight-guest'));
        add(row, end(migration.source, 'from'), track, end(migration.target, 'to'));
        return row;
    }

    // ----- charts ------------------------------------------------------------

    function formatValue(v, unit) {
        if (!isFinite(v)) return '—';
        switch (unit) {
            case 'count':
                return String(Math.round(v));
            case 'cores':
                return v >= 10 ? String(Math.round(v)) : v >= 1 ? v.toFixed(2).replace(/0$/, '') : Math.round(v * 1000) + 'm';
            case 'bytes':
                return M.bytes(v);
            case 'bytes/s':
                return M.bytes(v) + '/s';
            case 'ops/s':
                return (v >= 100 ? Math.round(v) : Math.round(v * 10) / 10) + '/s';
            case 'seconds':
                return v >= 1 ? (Math.round(v * 10) / 10) + 's' : Math.round(v * 1000) + 'ms';
            case 'percent':
                return Math.round(v * 100) + '%';
        }
        return Math.abs(v) >= 100 ? String(Math.round(v)) : String(Math.round(v * 100) / 100);
    }

    function chartColour(i) {
        return 'var(--chart-' + Math.min(i + 1, 8) + ', ' + FALLBACK[Math.min(i, 7)] + ')';
    }

    // One chart as an area per series: y from zero, a gap where Prometheus had
    // no sample, and each series' latest value in the legend.
    // colour(name, i) picks each series' colour.
    function sparkChart(chart, colour) {
        colour = colour || function (name, i) {
            return chartColour(i);
        };
        var card = el('article', 'chart');
        var head = el('div', 'chart-head');
        head.appendChild(el('h3', '', chart.label));
        if (chart.description) head.title = chart.description;
        card.appendChild(head);

        var series = (chart.series || []).filter(function (s) {
            return s.points && s.points.length > 0;
        });
        if (chart.error || series.length === 0) {
            card.classList.add('empty');
            card.appendChild(el('p', 'quiet', chart.error || 'No data for this window.'));
            return card;
        }
        var minT = Infinity;
        var maxT = -Infinity;
        var maxV = 0;
        series.forEach(function (s) {
            s.points.forEach(function (p) {
                minT = Math.min(minT, p.t);
                maxT = Math.max(maxT, p.t);
                if (isFinite(p.v)) maxV = Math.max(maxV, p.v);
            });
        });
        if (maxT === minT) maxT = minT + 1;
        var top = maxV > 0 ? maxV * 1.15 : 1;
        var W = 600;
        var H = 120;
        var x = function (t) {
            return ((t - minT) / (maxT - minT)) * W;
        };
        var y = function (v) {
            return H - (v / top) * H;
        };
        var step = (maxT - minT) / 60;

        var plot = el('div', 'chart-plot');
        var node = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'none', class: 'spark' });
        [0.25, 0.5, 0.75].forEach(function (f) {
            node.appendChild(svg('line', { x1: 0, x2: W, y1: H * f, y2: H * f, class: 'gridline' }));
        });
        series.forEach(function (s, i) {
            var runs = [];
            var run = [];
            s.points.forEach(function (p, j) {
                var gapHere = j > 0 && p.t - s.points[j - 1].t > step * 3;
                if (!isFinite(p.v) || gapHere) {
                    if (run.length) runs.push(run);
                    run = [];
                    if (!isFinite(p.v)) return;
                }
                run.push(p);
            });
            if (run.length) runs.push(run);
            var c = colour(s.name, i);
            runs.forEach(function (r) {
                var line = r
                    .map(function (p, j) {
                        return (j ? 'L' : 'M') + x(p.t).toFixed(1) + ' ' + y(p.v).toFixed(1);
                    })
                    .join(' ');
                var area = svg('path', { d: line + ' L' + x(r[r.length - 1].t).toFixed(1) + ' ' + H + ' L' + x(r[0].t).toFixed(1) + ' ' + H + ' Z', class: 'area' });
                area.style.fill = c;
                node.appendChild(area);
                var stroke = svg('path', { d: line, class: 'line' });
                stroke.style.stroke = c;
                node.appendChild(stroke);
            });
        });
        plot.appendChild(node);
        plot.appendChild(el('span', 'chart-max', formatValue(maxV, chart.unit)));
        card.appendChild(plot);

        var legend = el('div', 'chart-legend');
        series.forEach(function (s, i) {
            var last = s.points[s.points.length - 1];
            var key = el('span', 'key');
            var dot = el('i', 'dot');
            dot.style.background = colour(s.name, i);
            add(key, dot, el('span', 'key-name', s.name || chart.label), el('strong', '', formatValue(last.v, chart.unit)));
            legend.appendChild(key);
        });
        card.appendChild(legend);
        return card;
    }

    // ----- events --------------------------------------------------------------

    var EVENT_ICON = { VirtualMachine: 'monitor', VirtualMachineInstance: 'cpu', VirtualMachineInstanceMigration: 'forward', DataVolume: 'disk', KubeVirt: 'settings' };

    // A timeline of events. onOpen(event) opens what one is about.
    function eventList(events, onOpen, opts) {
        opts = opts || {};
        var list = el('ol', 'timeline' + (opts.compact ? ' compact' : ''));
        events.forEach(function (ev) {
            var item = el('li', 'tl' + (ev.type === 'Warning' ? ' warn' : ''));
            var mark = el('span', 'tl-mark');
            mark.appendChild(icon(ev.type === 'Warning' ? 'alert' : EVENT_ICON[ev.kind] || 'activity'));
            item.appendChild(mark);
            var body = el('div', 'tl-body');
            var line = el('div', 'tl-line');
            if (!opts.hideName && ev.name) {
                line.appendChild(
                    onOpen
                        ? link(ev.name, function () {
                              onOpen(ev);
                          })
                        : el('strong', '', ev.name),
                );
                line.appendChild(document.createTextNode(' '));
            }
            line.appendChild(el('span', '', M.eventText(ev)));
            body.appendChild(line);
            var meta = [ago(ev.when)];
            if (ev.count > 1) meta.push(ev.count + '×');
            if (ev.kind) meta.push(ev.kind.replace(/^VirtualMachine/, 'VM').replace(/^VMInstanceMigration$/, 'Migration').replace(/^VMInstance$/, 'Instance'));
            if (!opts.hideName && ev.namespace) meta.push(ev.namespace);
            if (ev.reason) meta.push(ev.reason);
            body.appendChild(el('div', 'tl-meta', meta.filter(Boolean).join(' · ')));
            item.appendChild(body);
            list.appendChild(item);
        });
        return list;
    }

    // ----- running an action -------------------------------------------------

    // Asks the app to run one of this plugin's actions on a machine. The app
    // asks the user first, every time; a "no" is not an error worth showing.
    function run(sdk, actionId, machine) {
        return sdk.run(actionId, { namespace: machine.namespace, name: machine.name }).then(
            function (res) {
                return { done: true, created: (res && res.created) || '' };
            },
            function (err) {
                if (/declined/.test((err && err.message) || '')) return { done: false, created: '' };
                throw err;
            },
        );
    }

    function actionButton(action, className, onClick) {
        var b = button(action.label, (className || '') + (action.tone === 'danger' ? ' danger' : '') + (action.id === 'start' || action.id === 'unpause' || action.id === 'instance-unpause' ? ' primary' : ''), action.icon, onClick);
        b.dataset.action = action.id;
        return b;
    }

    function machineRef(m) {
        return { kind: m.kind, namespace: m.namespace, name: m.name };
    }

    // ----- not under the pointer ---------------------------------------------

    function busyIn(region) {
        try {
            if (region.matches(':hover')) return true;
            var active = document.activeElement;
            if (!active || active === document.body || !region.contains(active)) return false;
            if (/^(INPUT|SELECT|TEXTAREA)$/.test(active.tagName)) return true;
            return active.matches(':focus-visible');
        } catch (e) {
            return false;
        }
    }

    // Redraws a region with `draw` now, unless the user is pointing at it or
    // typing in it -- then once they have left it. A poll must not pull a
    // button out from under a click, or a row out from under a tooltip.
    function calm(region, draw) {
        if (!region || !busyIn(region)) {
            if (region) region._later = null;
            draw();
            return true;
        }
        region._later = draw;
        if (!region._calmHooked) {
            region._calmHooked = true;
            var retry = function () {
                setTimeout(function () {
                    var later = region._later;
                    if (later && !busyIn(region)) {
                        region._later = null;
                        later();
                    }
                }, 80);
            };
            region.addEventListener('pointerleave', retry);
            region.addEventListener('focusout', retry);
        }
        return false;
    }

    window.KubeVirtKit = {
        el: el,
        add: add,
        svg: svg,
        icon: icon,
        chip: chip,
        stateChip: stateChip,
        GROUP_ICON: GROUP_ICON,
        button: button,
        link: link,
        ago: ago,
        span: span,
        screen: screen,
        specLine: specLine,
        stackBar: stackBar,
        meter: meter,
        fillTone: fillTone,
        percent: percent,
        honeycomb: honeycomb,
        tooltip: tooltip,
        describeMachine: describeMachine,
        flight: flight,
        formatValue: formatValue,
        chartColour: chartColour,
        sparkChart: sparkChart,
        eventList: eventList,
        run: run,
        actionButton: actionButton,
        machineRef: machineRef,
        calm: calm,
    };
})();
