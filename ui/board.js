// The Machines board: every virtual machine as a tile, grouped by state,
// namespace or node and narrowed from a rail of counts -- and one of them in
// full in a drawer: what it is made of, where it runs, its addresses and
// disks, and the plugin's own lifecycle buttons, which the app asks about
// before running.
(function () {
    'use strict';

    var sdk = window.k8sdockside;
    var M = window.KubeVirt;
    var K = window.KubeVirtKit;
    var el = K.el;
    var add = K.add;
    var POLL = 5000;
    var EVENTS_EVERY = 15000;

    var GROUPINGS = [
        { id: 'state', label: 'State' },
        { id: 'namespace', label: 'Namespace' },
        { id: 'node', label: 'Node' },
    ];
    var NO_NODE = '(not running)';

    var state = {
        ctx: null,
        model: null,
        sig: '',
        query: '',
        group: 'state',
        status: '',
        namespace: '',
        node: '',
        selected: '',
        offered: null,
        offeredFor: '',
        events: null,
        eventsFor: '',
        eventsAt: 0,
        busy: false,
        notice: null,
    };

    var $ = function (id) {
        return document.getElementById(id);
    };

    function fail(err) {
        $('error').textContent = (err && err.message) || String(err);
        $('error').hidden = false;
    }

    function open(ref) {
        sdk.open(ref).catch(fail);
    }

    // The filters and the selection live in the frame's own hash, so
    // switching tabs away and back -- which unloads the page -- comes back to
    // them.
    var REMEMBERED = ['group', 'status', 'namespace', 'node', 'selected'];

    function saveHash() {
        var parts = [];
        REMEMBERED.forEach(function (k) {
            if (state[k] && !(k === 'group' && state[k] === 'state')) parts.push(k + '=' + encodeURIComponent(state[k]));
        });
        try {
            history.replaceState(null, '', '#' + parts.join('&'));
        } catch (e) {
            // A sandboxed frame may refuse; the board still works.
        }
    }

    function loadHash() {
        (location.hash || '')
            .replace(/^#/, '')
            .split('&')
            .forEach(function (pair) {
                var cut = pair.indexOf('=');
                if (cut > 0 && REMEMBERED.indexOf(pair.slice(0, cut)) >= 0) state[pair.slice(0, cut)] = decodeURIComponent(pair.slice(cut + 1));
            });
        if (!GROUPINGS.some(function (g) {
            return g.id === state.group;
        })) state.group = 'state';
    }

    function selectedMachine() {
        return (
            (state.model &&
                state.selected &&
                state.model.machines.find(function (m) {
                    return m.key === state.selected;
                })) ||
            null
        );
    }

    function nodeOf(m) {
        return m.node || NO_NODE;
    }

    function matches(m) {
        if (state.status && m.group !== state.status) return false;
        if (state.namespace && m.namespace !== state.namespace) return false;
        if (state.node && nodeOf(m) !== state.node) return false;
        var q = state.query.trim().toLowerCase();
        if (!q) return true;
        return [m.name, m.namespace, m.node, m.status, m.os.pretty, m.os.family, m.instancetype && m.instancetype.name, m.preference]
            .concat(m.ips)
            .some(function (v) {
                return String(v || '').toLowerCase().indexOf(q) >= 0;
            });
    }

    // ----- the rail ----------------------------------------------------------

    function drawRail(model) {
        var rail = $('rail');
        rail.textContent = '';

        function section(title, items, key) {
            var box = el('div', 'rail-section');
            box.appendChild(el('div', 'rail-title', title));
            items.forEach(function (it) {
                var on = state[key] === it.value;
                var b = K.button('', 'rail-item' + (on ? ' on' : '') + (it.count ? '' : ' zero'), null, function () {
                    state[key] = state[key] === it.value ? '' : it.value;
                    saveHash();
                    render();
                });
                b.dataset.filter = key + ':' + it.value;
                b.setAttribute('aria-pressed', on ? 'true' : 'false');
                if (it.tone) b.appendChild(el('i', 'dot ' + it.tone));
                var label = el('span', 'rail-label', it.label);
                if (it.note) label.appendChild(el('span', 'rail-note', ' ' + it.note));
                add(b, label, el('span', 'rail-count', String(it.count)));
                if (it.title) b.title = it.title;
                box.appendChild(b);
            });
            rail.appendChild(box);
        }

        var all = K.button('', 'rail-item all' + (!state.status && !state.namespace && !state.node ? ' on' : ''), null, function () {
            state.status = state.namespace = state.node = '';
            saveHash();
            render();
        });
        add(all, el('span', 'rail-label', 'All machines'), el('span', 'rail-count', String(model.machines.length)));
        rail.appendChild(all);

        section(
            'State',
            M.GROUPS.map(function (g) {
                return { value: g.id, label: g.label, tone: g.tone, count: model.groups[g.id] || 0 };
            }).filter(function (it) {
                return it.count || it.value === 'failing' || it.value === 'running' || it.value === 'stopped' || state.status === it.value;
            }),
            'status',
        );

        function counted(field) {
            var c = {};
            model.machines.forEach(function (m) {
                var v = field(m);
                c[v] = (c[v] || 0) + 1;
            });
            return c;
        }
        var ns = counted(function (m) {
            return m.namespace;
        });
        section(
            'Namespaces',
            Object.keys(ns)
                .sort()
                .map(function (n) {
                    return { value: n, label: n, count: ns[n] };
                }),
            'namespace',
        );
        var nodes = counted(nodeOf);
        section(
            'Nodes',
            Object.keys(nodes)
                .sort(function (a, b) {
                    if (a === NO_NODE) return 1;
                    if (b === NO_NODE) return -1;
                    return a.localeCompare(b);
                })
                .map(function (n) {
                    var info = model.nodes.find(function (x) {
                        return x.name === n;
                    });
                    return { value: n, label: n, count: nodes[n], note: info && info.cordoned ? 'cordoned' : '', title: info && info.cordoned ? n + ' is cordoned' : '' };
                }),
            'node',
        );
    }

    // ----- the tiles ---------------------------------------------------------

    function select(m) {
        state.selected = state.selected === m.key ? '' : m.key;
        state.offered = null;
        state.offeredFor = '';
        state.events = null;
        state.eventsFor = '';
        state.notice = null;
        saveHash();
        drawGroups(state.model);
        drawDrawer(state.model);
        if (state.selected) {
            refreshOffered();
            refreshEvents(true);
        }
    }

    function tile(m) {
        var t = K.button('', 'tile ' + m.tone + ' g-' + m.group + (state.selected === m.key ? ' sel' : ''), null, function () {
            select(m);
        });
        t.dataset.key = m.key;
        var head = el('span', 'tile-head');
        var title = el('span', 'tile-title');
        add(title, el('span', 'tile-name', m.name), el('span', 'tile-sub', m.namespace + (m.node ? ' · ' + m.node : '')));
        add(head, K.screen(m), title);
        if (m.group === 'changing') head.appendChild(K.icon('clock', 'tile-spin'));
        if (m.moving) head.appendChild(K.icon('forward', 'tile-move'));
        t.appendChild(head);
        var chips = el('span', 'tile-chips');
        chips.appendChild(K.stateChip(m));
        if (m.standalone) chips.appendChild(K.chip('instance only', 'muted', null, 'A VirtualMachineInstance with no VirtualMachine of its own'));
        if (m.restartRequired) chips.appendChild(K.chip('restart pending', 'warn', 'repeat'));
        t.appendChild(chips);
        var foot = el('span', 'tile-foot');
        add(foot, K.icon('cpu'), el('span', '', String(m.cpu.vcpus)), K.icon('memory'), el('span', '', m.memory.text || '—'));
        if (m.ips.length) add(foot, K.icon('pin'), el('span', 'mono ip', m.ips[0]));
        else if (m.uptimeSince) add(foot, K.icon('clock'), el('span', '', 'up ' + K.span(m.uptimeSince)));
        t.appendChild(foot);
        if (m.os.pretty) t.title = m.os.pretty;
        return t;
    }

    function groupKey(m) {
        if (state.group === 'namespace') return m.namespace;
        if (state.group === 'node') return nodeOf(m);
        return m.group;
    }

    function groupLabel(k) {
        if (state.group !== 'state') return k;
        var g = M.GROUPS.find(function (x) {
            return x.id === k;
        });
        return g ? g.label : k;
    }

    function drawGroups(model) {
        var root = $('groups');
        root.textContent = '';
        var shown = model.machines.filter(matches);
        if (!shown.length) {
            var none = el('div', 'nothing');
            none.appendChild(el('p', 'quiet', model.machines.length ? 'No machine matches.' : 'No virtual machines in this cluster yet.'));
            if (model.machines.length && (state.query || state.status || state.namespace || state.node)) {
                none.appendChild(
                    K.button('Clear the filters', 'ghost small', 'close', function () {
                        state.query = state.status = state.namespace = state.node = '';
                        $('query').value = '';
                        saveHash();
                        render();
                    }),
                );
            }
            root.appendChild(none);
            return;
        }
        var groups = {};
        var order = [];
        shown.forEach(function (m) {
            var k = groupKey(m);
            if (!groups[k]) {
                groups[k] = [];
                order.push(k);
            }
            groups[k].push(m);
        });
        if (state.group === 'state') {
            order.sort(function (a, b) {
                return M.GROUPS.findIndex(function (g) {
                    return g.id === a;
                }) - M.GROUPS.findIndex(function (g) {
                    return g.id === b;
                });
            });
        } else {
            order.sort(function (a, b) {
                if (a === NO_NODE) return 1;
                if (b === NO_NODE) return -1;
                return M.worstFirst(groups[a][0], groups[b][0]) || a.localeCompare(b);
            });
        }

        order.forEach(function (k) {
            var list = groups[k];
            var sec = el('section', 'group');
            var head = el('div', 'group-head');
            var tally = {};
            list.forEach(function (m) {
                tally[m.tone] = (tally[m.tone] || 0) + 1;
            });
            var bar = el('span', 'mini-bar');
            ['error', 'warn', 'info', 'paused', 'ok', 'muted'].forEach(function (t) {
                if (!tally[t]) return;
                var seg = el('i', 'seg ' + t);
                seg.style.flexGrow = String(tally[t]);
                bar.appendChild(seg);
            });
            var ic = state.group === 'node' ? 'node' : state.group === 'namespace' ? 'layers' : K.GROUP_ICON[k] || 'monitor';
            var vcpus = list.reduce(function (s, m) {
                return s + (m.running ? m.cpu.vcpus : 0);
            }, 0);
            add(head, K.icon(ic), el('h2', '', groupLabel(k)), el('span', 'faint', M.plural(list.length, 'machine')), bar);
            if (vcpus) head.appendChild(el('span', 'faint small group-extra', vcpus + ' vCPUs running'));
            sec.appendChild(head);
            var grid = el('div', 'tiles');
            list.forEach(function (m) {
                grid.appendChild(tile(m));
            });
            sec.appendChild(grid);
            root.appendChild(sec);
        });
    }

    // ----- the drawer --------------------------------------------------------

    function refreshOffered() {
        var m = selectedMachine();
        if (!m) return Promise.resolve();
        var key = m.key;
        return sdk
            .actions(K.machineRef(m))
            .then(
                function (list) {
                    return (list || []).map(function (a) {
                        return { id: a.id, label: a.label, icon: a.icon, tone: a.tone };
                    });
                },
                function () {
                    // An app without the bridge call, or a read that failed:
                    // the manifest's own conditions, read here, are the next
                    // best answer. The app still checks when one is pressed.
                    return M.offered(m);
                },
            )
            .then(function (list) {
                if (state.selected !== key) return;
                var changed = JSON.stringify(list) !== JSON.stringify(state.offered);
                state.offered = list;
                state.offeredFor = key;
                if (changed) drawTools();
            });
    }

    function refreshEvents(force) {
        var m = selectedMachine();
        if (!m) return Promise.resolve();
        if (!force && Date.now() - state.eventsAt < EVENTS_EVERY) return Promise.resolve();
        state.eventsAt = Date.now();
        var key = m.key;
        return M.loadMachineEvents(sdk, m, 8).then(function (events) {
            if (state.selected !== key) return;
            var changed = JSON.stringify(events) !== JSON.stringify(state.events);
            state.events = events;
            state.eventsFor = key;
            if (changed) drawEvents();
        });
    }

    function runAction(action) {
        var m = selectedMachine();
        if (!m || state.busy) return;
        state.busy = true;
        drawTools();
        K.run(sdk, action.id, m)
            .then(function (res) {
                if (res.done) state.notice = { text: 'Asked KubeVirt to ' + action.label.toLowerCase() + ' ' + m.name + (res.created ? ' — created ' + res.created : '') + '.' };
            })
            .catch(function (err) {
                state.notice = { tone: 'error', text: (err && err.message) || String(err) };
            })
            .then(function () {
                state.busy = false;
                if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
                drawTools();
                // Straight away and once more shortly, so the buttons move on as
                // soon as the cluster does rather than on the next poll.
                refreshOffered();
                tick();
                setTimeout(refreshOffered, 1500);
                setTimeout(function () {
                    state.notice = null;
                    var box = $('drawer-tools');
                    if (box) K.calm(box, drawTools);
                }, 7000);
            });
    }

    // The buttons, and the notice under them: redrawn on their own so an
    // answer from the app does not rebuild the whole drawer.
    function drawTools() {
        var box = $('drawer-tools');
        var m = selectedMachine();
        if (!box || !m) return;
        box.textContent = '';
        var row = el('div', 'drawer-tools');
        var list = state.offeredFor === m.key && state.offered ? state.offered : null;
        if (list === null) {
            row.appendChild(el('span', 'faint small', 'Reading what can be done…'));
        } else {
            var safe = list.filter(function (a) {
                return a.tone !== 'danger';
            });
            var danger = list.filter(function (a) {
                return a.tone === 'danger';
            });
            safe.concat(danger).forEach(function (a) {
                var b = K.actionButton(a, '', function () {
                    runAction(a);
                });
                b.disabled = state.busy;
                row.appendChild(b);
            });
            if (!list.length) row.appendChild(el('span', 'faint small', 'Nothing to start or stop while it is ' + m.status.toLowerCase() + '.'));
        }
        box.appendChild(row);
        if (state.notice) {
            var note = el('div', state.notice.tone === 'error' ? 'why error' : 'notice');
            add(note, K.icon(state.notice.tone === 'error' ? 'alert' : 'check'), el('span', '', state.notice.text));
            box.appendChild(note);
        }
    }

    function drawEvents() {
        var box = $('drawer-events');
        var m = selectedMachine();
        if (!box || !m) return;
        box.textContent = '';
        if (state.eventsFor !== m.key || state.events === null) {
            box.appendChild(el('p', 'quiet', 'Reading events…'));
            return;
        }
        if (!state.events.length) {
            box.appendChild(el('p', 'quiet', 'No recent events about this machine.'));
            return;
        }
        box.appendChild(
            K.eventList(state.events, null, { compact: true }),
        );
    }

    function stat(iconName, big, small, title) {
        var s = el('div', 'stat');
        add(s, K.icon(iconName), el('strong', '', big), el('span', '', small));
        if (title) s.title = title;
        return s;
    }

    function table(columns, rows, classes) {
        classes = classes || [];
        var wrap = el('div', 'table-wrap');
        var t = el('table', 'grid-table');
        var thead = el('thead');
        var tr = el('tr');
        columns.forEach(function (c, i) {
            tr.appendChild(el('th', classes[i] || '', c));
        });
        thead.appendChild(tr);
        t.appendChild(thead);
        var tbody = el('tbody');
        rows.forEach(function (r) {
            var row = el('tr');
            r.forEach(function (cell, i) {
                var td = el('td', classes[i] || '');
                if (cell && typeof cell === 'object') td.appendChild(cell);
                else td.textContent = cell === undefined || cell === null || cell === '' ? '—' : String(cell);
                row.appendChild(td);
            });
            tbody.appendChild(row);
        });
        t.appendChild(tbody);
        wrap.appendChild(t);
        return wrap;
    }

    function section(title, extra) {
        var h = el('h3', 'drawer-section', title);
        if (extra) h.appendChild(el('span', 'faint', ' ' + extra));
        return h;
    }

    function topology(m) {
        var t = m.cpu.topology;
        if (!t) return m.instancetype ? 'from ' + m.instancetype.name : 'vCPUs';
        var parts = [];
        if (t.sockets > 1) parts.push(M.plural(t.sockets, 'socket'));
        parts.push(M.plural(t.cores, 'core'));
        if (t.threads > 1) parts.push(M.plural(t.threads, 'thread'));
        return parts.join(' × ');
    }

    function drawDrawer(model) {
        var drawer = $('drawer');
        var m = selectedMachine();
        drawer.hidden = !m;
        $('scrim').hidden = !m;
        document.body.classList.toggle('drawer-open', !!m);
        if (!m) return;
        // A redraw of the same machine keeps the reader where they were.
        var keep = drawer.dataset.key === m.key ? drawer.scrollTop : 0;
        drawer.dataset.key = m.key;
        drawer.textContent = '';
        requestAnimationFrame(function () {
            drawer.scrollTop = keep;
        });

        var head = el('header', 'drawer-head ' + m.tone);
        var title = el('div', 'drawer-title');
        add(title, el('h2', '', m.name), el('div', 'faint small', m.namespace + ' · ' + (m.standalone ? 'VirtualMachineInstance' : 'VirtualMachine')));
        function headButton(iconName, label, onClick) {
            var b = K.button('', 'icon-button', iconName, onClick);
            b.setAttribute('aria-label', label);
            b.title = label;
            return b;
        }
        var headTools = el('div', 'drawer-head-tools');
        add(
            headTools,
            headButton('edit', 'Edit the YAML', function () {
                sdk.edit(K.machineRef(m)).catch(fail);
            }),
            headButton('open', 'Open in the details panel — console, charts and the full object', function () {
                open(K.machineRef(m));
            }),
            headButton('close', 'Close', function () {
                select(m);
            }),
        );
        add(head, K.screen(m, 'large'), title, headTools);
        drawer.appendChild(head);

        var chips = el('div', 'drawer-chips');
        chips.appendChild(K.stateChip(m));
        if (m.runStrategy) chips.appendChild(K.chip('run strategy ' + m.runStrategy, 'muted', 'repeat', 'spec.runStrategy'));
        if (m.instancetype) chips.appendChild(K.chip(m.instancetype.name, 'muted', 'tag', m.instancetype.kind));
        if (m.running) {
            chips.appendChild(m.migratable === 'False' ? K.chip('not live-migratable', 'muted', 'lock', m.migratableWhy) : K.chip('live-migratable', 'ok', 'forward'));
            chips.appendChild(m.agent ? K.chip('guest agent', 'ok', 'agent') : K.chip('no guest agent', 'muted', 'agent', 'Without the agent there are no addresses from inside the guest, and Reboot cannot work'));
        }
        if (m.restartRequired) chips.appendChild(K.chip('restart pending', 'warn', 'repeat', 'Its spec has changed in a way that takes effect on the next restart'));
        drawer.appendChild(chips);

        var tools = el('div', 'drawer-tools-box');
        tools.id = 'drawer-tools';
        drawer.appendChild(tools);
        drawTools();

        if (m.reason && m.group !== 'running') {
            var why = el('div', 'why ' + (m.tone === 'muted' ? 'info' : m.tone));
            add(why, K.icon(m.group === 'failing' || m.stuck ? 'alert' : 'clock'), el('span', '', m.reason));
            drawer.appendChild(why);
        }

        if (m.moving) {
            drawer.appendChild(section('Migrating', m.moving.phase + ' · for ' + K.span(m.moving.started)));
            drawer.appendChild(K.flight(m.moving, function (n) {
                open({ kind: M.KINDS.nodes, namespace: '', name: n });
            }));
        }

        // What it is made of.
        var stats = el('div', 'stats');
        var totalDisk = m.disks.reduce(function (s, d) {
            return s + d.size;
        }, 0);
        add(
            stats,
            stat('cpu', String(m.cpu.vcpus), topology(m), m.cpu.text),
            stat('memory', m.memory.text || '—', 'guest memory'),
            stat('disk', String(m.disks.length), m.disks.length === 1 ? 'disk' + (totalDisk ? ' · ' + M.bytes(totalDisk) : '') : 'disks' + (totalDisk ? ' · ' + M.bytes(totalDisk) : '')),
        );
        drawer.appendChild(stats);
        var os = el('div', 'os-line');
        add(os, K.icon(m.os.family === 'windows' ? 'windows' : m.os.family === 'linux' ? 'linux' : 'monitor'), el('span', '', m.os.pretty || (m.running ? 'The guest does not say what it runs — no guest agent' : m.preference ? 'Preference ' + m.preference : 'Operating system unknown until it runs with a guest agent')));
        drawer.appendChild(os);

        // Where it runs.
        drawer.appendChild(section('Where it runs'));
        if (!m.vmi) {
            drawer.appendChild(
                el(
                    'p',
                    'quiet',
                    m.group === 'stopped'
                        ? 'Nowhere while it is stopped: a stopped machine has no instance, no node and no launcher pod.'
                        : m.group === 'failing'
                        ? 'Nowhere right now: it has no instance, so no node and no launcher pod, until KubeVirt manages to start it.'
                        : 'Nowhere yet: its instance has not been created.',
                ),
            );
        } else {
            var place = el('div', 'place');
            var nodeBox = el('div', 'place-end');
            var nodeInfo = model.nodes.find(function (n) {
                return n.name === m.node;
            });
            var nb = el('div', '');
            nb.appendChild(el('div', 'place-label', 'Node'));
            nb.appendChild(
                m.node
                    ? K.link(m.node, function () {
                          open({ kind: M.KINDS.nodes, namespace: '', name: m.node });
                      })
                    : el('span', 'faint', 'not placed yet'),
            );
            if (nodeInfo && nodeInfo.cordoned) nb.appendChild(K.chip('cordoned', 'warn', 'lock'));
            add(nodeBox, K.icon('node'), nb);
            var podBox = el('div', 'place-end');
            var pb = el('div', '');
            pb.appendChild(el('div', 'place-label', 'Launcher pod'));
            if (m.launcher) {
                var pod = m.launcher;
                pb.appendChild(
                    K.link(pod.metadata.name, function () {
                        open({ kind: M.KINDS.pods, namespace: pod.metadata.namespace, name: pod.metadata.name });
                    }),
                );
                var podLine = el('div', 'place-sub');
                add(
                    podLine,
                    el('span', '', (pod.status && pod.status.phase) || ''),
                    m.qos ? el('span', '', ' · ' + m.qos) : '',
                    ' · ',
                    K.link('logs', function () {
                        sdk.logs({ kind: M.KINDS.pods, namespace: pod.metadata.namespace, name: pod.metadata.name }).catch(fail);
                    }),
                );
                pb.appendChild(podLine);
            } else {
                pb.appendChild(el('span', 'faint', 'none found'));
            }
            add(podBox, K.icon('pod'), pb);
            add(place, nodeBox, K.icon('arrow', 'place-arrow'), podBox);
            if (m.uptimeSince) place.appendChild(el('div', 'place-note', 'Running for ' + K.span(m.uptimeSince) + ', since ' + new Date(m.uptimeSince).toLocaleString()));
            drawer.appendChild(place);
        }

        // Networks.
        if (m.interfaces.length) {
            drawer.appendChild(section('Networks', m.ips.length ? M.plural(m.ips.length, 'address', 'addresses') : ''));
            drawer.appendChild(
                table(
                    ['Interface', 'Network', 'Addresses'],
                    m.interfaces.map(function (i) {
                        var name = el('div', 'cell-stack');
                        add(name, el('strong', '', i.name || i.device || '—'), el('span', 'faint small', [i.binding, i.device].filter(Boolean).join(' · ')), i.mac ? el('span', 'faint small mono', i.mac) : null);
                        var addr = el('div', 'cell-stack');
                        if (i.ips.length) {
                            i.ips.forEach(function (ip) {
                                addr.appendChild(el('span', 'mono', ip));
                            });
                        } else addr.appendChild(el('span', 'faint', m.running ? 'none reported' : '—'));
                        return [name, i.network || '—', addr];
                    }),
                    ['w40', 'w25', ''],
                ),
            );
            if (m.running && !m.ips.length) drawer.appendChild(el('p', 'foot-note', 'A guest reports its addresses through the guest agent; without one, only the pod network address is known, and sometimes not even that.'));
        }

        // Disks.
        drawer.appendChild(section('Disks', m.disks.length ? '' : 'none'));
        if (m.disks.length) {
            drawer.appendChild(
                table(
                    ['Disk', 'Backed by', 'Size'],
                    m.disks.map(function (d) {
                        var back = el('span', 'backing');
                        if (d.backing.ref) {
                            back.appendChild(
                                K.link(d.backing.name, function () {
                                    open(d.backing.ref);
                                }),
                            );
                        } else if (d.backing.name) {
                            back.appendChild(el('span', 'mono', d.backing.name));
                        }
                        back.appendChild(el('span', 'faint small', ' ' + (d.backing.type || '')));
                        if (d.dv && d.dv.phase && d.dv.phase !== 'Succeeded') back.appendChild(K.chip(d.dv.phase + (d.dv.progress && d.dv.progress !== 'N/A' ? ' ' + d.dv.progress : ''), d.dv.phase === 'Failed' ? 'error' : 'info'));
                        var name = el('div', 'cell-stack');
                        add(name, el('strong', '', d.name), el('span', 'faint small', [d.type !== 'disk' ? d.type : '', d.bus, d.target].filter(Boolean).join(' · ')));
                        return [name, back, el('span', 'nowrap', d.size ? M.bytes(d.size) : '—')];
                    }),
                    ['w30', '', 'num'],
                ),
            );
        }

        // Conditions.
        var conds = m.conditions.filter(function (c) {
            return c.type;
        });
        if (conds.length) {
            drawer.appendChild(section('Conditions'));
            var cl = el('ul', 'conds');
            conds.forEach(function (c) {
                var good = c.type === 'Failure' || c.type === 'RestartRequired' || c.type === 'Paused' ? c.status !== 'True' : c.status === 'True';
                var li = el('li', good ? 'ok' : c.type === 'LiveMigratable' || c.type === 'AgentConnected' ? 'muted' : 'warn');
                add(li, K.icon(good ? 'check' : 'alert'), el('span', 'cond-type', c.type), el('span', 'cond-status', c.status));
                // The message already in the box at the top is not repeated.
                var said = c.message || c.reason;
                if (said && !(said === m.reason && m.group !== 'running')) li.appendChild(el('span', 'cond-msg', said));
                else if (said) li.appendChild(el('span', 'cond-msg faint', 'as above'));
                cl.appendChild(li);
            });
            drawer.appendChild(cl);
        }

        // Migrations.
        if (m.migrations.length) {
            drawer.appendChild(section('Migrations', String(m.migrations.length)));
            var ml = el('ul', 'mig-list');
            m.migrations.slice(0, 5).forEach(function (mig) {
                var li = el('li', mig.failed ? 'error' : mig.inFlight ? 'info' : 'ok');
                add(
                    li,
                    K.icon(mig.failed ? 'close' : mig.inFlight ? 'forward' : 'check'),
                    K.link(mig.name, function () {
                        open({ kind: M.KINDS.migrations, namespace: mig.namespace, name: mig.name });
                    }),
                    el('span', 'mig-route', (mig.source || '?') + ' → ' + (mig.target || '?')),
                    el('span', 'faint small', mig.inFlight ? mig.phase : K.ago(mig.ended || mig.created)),
                );
                if (mig.reason) li.title = mig.reason;
                ml.appendChild(li);
            });
            drawer.appendChild(ml);
        }

        drawer.appendChild(section('Events'));
        var ev = el('div', '');
        ev.id = 'drawer-events';
        drawer.appendChild(ev);
        drawEvents();
    }

    // ----- putting it together -----------------------------------------------

    function drawGroupControl() {
        var box = $('group');
        box.textContent = '';
        box.appendChild(el('span', 'seg-label', 'Group by'));
        GROUPINGS.forEach(function (g) {
            var b = K.button(g.label, state.group === g.id ? 'on' : '', null, function () {
                state.group = g.id;
                saveHash();
                drawGroupControl();
                if (state.model) drawGroups(state.model);
            });
            b.setAttribute('aria-pressed', state.group === g.id ? 'true' : 'false');
            box.appendChild(b);
        });
    }

    function drawEmpty(model) {
        var box = $('empty');
        box.textContent = '';
        box.hidden = false;
        var art = el('div', 'empty-art');
        art.appendChild(K.icon('logo'));
        add(box, art, el('h2', '', 'KubeVirt is not installed in ' + state.ctx.contextName), el('p', 'faint', 'This cluster does not serve VirtualMachines, so there is nothing to put on the board.'));
        if (model.missing) box.appendChild(el('p', 'faint small', model.missing));
    }

    function render() {
        var model = state.model;
        if (!model) return;
        var where = state.ctx.contextName;
        if (model.system.version) where += ' · KubeVirt ' + model.system.version;
        where += ' · ' + M.plural(model.machines.length, 'machine') + ' · ' + model.totals.running + ' running';
        $('where').textContent = where;
        if (!model.installed) {
            $('board').hidden = true;
            drawEmpty(model);
            return;
        }
        $('empty').hidden = true;
        $('board').hidden = false;
        drawRail(model);
        drawGroups(model);
        drawDrawer(model);
    }

    // A poll's redraw: each region only when nobody is pointing at it.
    function redraw() {
        var model = state.model;
        if (!model) return;
        if (!model.installed || $('board').hidden) {
            render();
            return;
        }
        var where = state.ctx.contextName + (model.system.version ? ' · KubeVirt ' + model.system.version : '') + ' · ' + M.plural(model.machines.length, 'machine') + ' · ' + model.totals.running + ' running';
        $('where').textContent = where;
        K.calm($('rail'), function () {
            drawRail(state.model);
        });
        K.calm($('groups'), function () {
            drawGroups(state.model);
        });
        // Only the buttons are held while pointed at: the rest of the drawer
        // is read, not clicked, and should say what the machine is doing now.
        K.calm($('drawer-tools') || $('drawer'), function () {
            drawDrawer(state.model);
        });
    }

    var timer = null;
    function tick() {
        if (timer) clearTimeout(timer);
        timer = null;
        M.load(sdk)
            .then(function (model) {
                $('error').hidden = true;
                var sig = model.sig + '|' + Math.floor(Date.now() / 60000);
                var first = !state.model;
                if (sig !== state.sig) {
                    state.model = model;
                    state.sig = sig;
                    if (first) render();
                    else redraw();
                }
                if (state.selected) {
                    if (first) {
                        refreshOffered();
                        refreshEvents(true);
                    } else {
                        refreshOffered();
                        refreshEvents(false);
                    }
                }
            })
            .catch(fail)
            .then(function () {
                timer = setTimeout(tick, POLL);
            });
    }

    $('logo').appendChild(K.icon('logo'));
    $('search-icon').appendChild(K.icon('search'));
    $('query').addEventListener('input', function (event) {
        state.query = event.target.value;
        if (state.model && state.model.installed) drawGroups(state.model);
    });
    $('scrim').addEventListener('click', function () {
        var m = selectedMachine();
        if (m) select(m);
    });
    document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && state.selected) {
            var m = selectedMachine();
            if (m) select(m);
            else {
                state.selected = '';
                saveHash();
            }
        } else if (event.key === '/' && document.activeElement === document.body) {
            event.preventDefault();
            $('query').focus();
        }
    });
    K.tooltip($('groups'), '.tile', function (t, into) {
        var m = state.model && state.model.machines.find(function (x) {
            return x.key === t.dataset.key;
        });
        return m && (m.reason || m.moving) ? K.describeMachine(m, into) : false;
    });

    loadHash();
    drawGroupControl();

    sdk.ready()
        .then(function (context) {
            state.ctx = context;
            $('where').textContent = context.contextName;
            tick();
        })
        .catch(fail);
})();
