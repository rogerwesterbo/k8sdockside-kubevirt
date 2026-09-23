// The Nodes page: every node that carries guests or could, in full -- not the
// first twelve the overview has room for. Each one with whether it is well,
// what it runs (kubelet, OS, kernel, CPU model), how much of it the guests'
// launcher pods have asked for, and every guest on it, which a row opens into
// by name.
(function () {
    'use strict';

    var sdk = window.k8sdockside;
    var M = window.KubeVirt;
    var K = window.KubeVirtKit;
    var el = K.el;
    var add = K.add;
    var POLL = 5000;

    var SORTS = [
        { id: 'guests', label: 'Guests' },
        { id: 'cpu', label: 'CPU' },
        { id: 'memory', label: 'Memory' },
        { id: 'name', label: 'Name' },
    ];

    var FILTERS = [
        { id: '', label: 'All' },
        { id: 'look', label: 'Needs a look', tone: 'warn' },
        { id: 'cordoned', label: 'Cordoned' },
        { id: 'idle', label: 'No guests' },
    ];

    var state = { ctx: null, model: null, sig: '', query: '', sort: 'guests', filter: '', open: '' };

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

    function openNode(name) {
        open({ kind: M.KINDS.nodes, namespace: '', name: name });
    }

    // The sort, the filter and which rows are open live in the frame's hash,
    // so switching tabs away and back comes back to them.
    var REMEMBERED = ['sort', 'filter', 'open'];

    function saveHash() {
        var parts = [];
        REMEMBERED.forEach(function (k) {
            if (state[k] && !(k === 'sort' && state[k] === 'guests')) parts.push(k + '=' + encodeURIComponent(state[k]));
        });
        try {
            history.replaceState(null, '', '#' + parts.join('&'));
        } catch (e) {
            // A sandboxed frame may refuse; the page still works.
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
        if (!SORTS.some(function (s) {
            return s.id === state.sort;
        })) state.sort = 'guests';
        if (!FILTERS.some(function (f) {
            return f.id === state.filter;
        })) state.filter = '';
    }

    function openSet() {
        return state.open ? state.open.split(',') : [];
    }

    function isOpen(name) {
        return state.open === '*' || openSet().indexOf(name) >= 0;
    }

    function toggle(name) {
        var names = state.open === '*' ? shown(state.model).map(function (n) {
            return n.name;
        }) : openSet();
        var at = names.indexOf(name);
        if (at >= 0) names.splice(at, 1);
        else names.push(name);
        state.open = names.join(',');
        saveHash();
        draw();
    }

    // ----- what is wrong with a node ---------------------------------------------

    // Worst first, each with a tone: what the row's badges say, and what puts
    // a node under "Needs a look".
    function problems(n) {
        var out = [];
        if (!n.ready) out.push({ tone: 'error', text: 'not ready', icon: 'alert', title: n.readyWhy || 'The kubelet is not reporting Ready' });
        if (n.handler === 'missing') out.push({ tone: 'error', text: 'no virt-handler', icon: 'alert', title: 'No virt-handler pod runs here, so no guest can start on this node' });
        if (n.handler === 'not ready') out.push({ tone: 'error', text: 'virt-handler not ready', icon: 'alert', title: 'virt-handler is not ready here: no guest can start on this node until it is' });
        n.pressure.forEach(function (p) {
            out.push({ tone: 'warn', text: p.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase(), icon: 'alert', title: 'The node reports ' + p });
        });
        if (n.cordoned) out.push({ tone: 'warn', text: 'cordoned', icon: 'lock', title: 'No new guest will be placed here' });
        if (n.known && n.cpu && n.cpuFraction >= 0.8) out.push({ tone: K.fillTone(n.cpuFraction), text: 'CPU ' + K.percent(n.cpuFraction), icon: 'cpu', title: 'Guests have asked for ' + M.cores(n.requested.cpu) + ' of ' + M.cores(n.cpu) + ' cores' });
        if (n.known && n.memory && n.memoryFraction >= 0.8) out.push({ tone: K.fillTone(n.memoryFraction), text: 'memory ' + K.percent(n.memoryFraction), icon: 'memory', title: 'Guests have asked for ' + M.bytes(n.requested.memory) + ' of ' + M.bytes(n.memory) });
        if (n.known && !n.kvm) out.push({ tone: 'muted', text: 'no KVM', icon: 'bolt', title: 'Guests here run under software emulation, which is slow' });
        if (n.known && !n.schedulable && n.guests.length) out.push({ tone: 'muted', text: 'not schedulable', icon: null, title: 'virt-handler does not mark this node kubevirt.io/schedulable' });
        if (n.guests.some(function (m) {
            return m.group === 'failing';
        })) out.push({ tone: 'error', text: 'failing guests', icon: 'alert', title: 'A guest on this node is failing' });
        return out;
    }

    function needsLook(n) {
        return problems(n).some(function (p) {
            return p.tone === 'error' || p.tone === 'warn';
        });
    }

    function matchesFilter(n, filter) {
        if (filter === 'look') return needsLook(n);
        if (filter === 'cordoned') return n.cordoned;
        if (filter === 'idle') return !n.guests.length;
        return true;
    }

    function matchesQuery(n) {
        var q = state.query.trim().toLowerCase();
        if (!q) return true;
        var words = [n.name, n.kubelet, n.os, n.kernel, n.arch, n.runtime, n.cpuModel, n.zone]
            .concat(n.roles, n.taints)
            .concat(
                problems(n).map(function (p) {
                    return p.text;
                }),
            )
            .concat(
                n.guests.map(function (m) {
                    return m.namespace + '/' + m.name;
                }),
            );
        return words.some(function (v) {
            return String(v || '').toLowerCase().indexOf(q) >= 0;
        });
    }

    function sorted(nodes) {
        var by = {
            guests: function (a, b) {
                return b.guests.length - a.guests.length;
            },
            cpu: function (a, b) {
                return b.cpuFraction - a.cpuFraction;
            },
            memory: function (a, b) {
                return b.memoryFraction - a.memoryFraction;
            },
            name: function () {
                return 0;
            },
        }[state.sort];
        return nodes.slice().sort(function (a, b) {
            return by(a, b) || a.name.localeCompare(b.name, undefined, { numeric: true });
        });
    }

    function shown(model) {
        if (!model) return [];
        return sorted(
            model.nodes.filter(function (n) {
                return matchesFilter(n, state.filter) && matchesQuery(n);
            }),
        );
    }

    // ----- the strip -------------------------------------------------------------

    function drawStrip(model) {
        var box = $('nstrip');
        box.textContent = '';
        var nodes = model.nodes;
        var ready = nodes.filter(function (n) {
            return n.ready;
        }).length;
        var look = nodes.filter(needsLook).length;
        var hosting = nodes.filter(function (n) {
            return n.guests.length && !needsLook(n);
        }).length;
        var cordoned = nodes.filter(function (n) {
            return n.cordoned;
        }).length;

        var b = el('div', 'bar-block');
        add(
            b,
            el('div', 'bar-title', 'Nodes by state'),
            K.stackBar(
                [
                    { id: 'ok', label: 'Hosting guests', count: hosting, tone: 'ok' },
                    { id: 'look', label: 'Needs a look', count: look, tone: 'warn' },
                    { id: 'idle', label: 'No guests', count: nodes.length - hosting - look, tone: 'muted' },
                ],
                function (seg) {
                    state.filter = seg.id === 'ok' ? '' : seg.id;
                    saveHash();
                    draw();
                },
            ),
        );
        box.appendChild(b);

        var total = { cpu: 0, memory: 0, reqCpu: 0, reqMemory: 0 };
        nodes.forEach(function (n) {
            if (!n.known) return;
            total.cpu += n.cpu;
            total.memory += n.memory;
            total.reqCpu += n.requested.cpu;
            total.reqMemory += n.requested.memory;
        });
        var facts = el('div', 'facts');
        function fact(iconName, big, small, title) {
            var f = el('div', 'fact');
            add(f, K.icon(iconName), el('strong', '', big), el('span', '', small));
            if (title) f.title = title;
            return f;
        }
        add(
            facts,
            fact('node', ready + ' / ' + nodes.length, 'nodes ready'),
            fact('lock', String(cordoned), 'cordoned'),
            fact('cpu', total.cpu ? K.percent(total.reqCpu / total.cpu) : '—', 'CPU asked for', M.cores(total.reqCpu) + ' of ' + M.cores(total.cpu) + ' cores, by the guests’ launcher pods'),
            fact('memory', total.memory ? K.percent(total.reqMemory / total.memory) : '—', 'memory asked for', M.bytes(total.reqMemory) + ' of ' + M.bytes(total.memory) + ', by the guests’ launcher pods'),
        );
        box.appendChild(facts);
    }

    // ----- the controls ----------------------------------------------------------

    function drawSort() {
        var box = $('sort');
        box.textContent = '';
        box.appendChild(el('span', 'seg-label', 'Sort by'));
        SORTS.forEach(function (s) {
            var b = K.button(s.label, state.sort === s.id ? 'on' : '', null, function () {
                state.sort = s.id;
                saveHash();
                drawSort();
                draw();
            });
            b.setAttribute('aria-pressed', state.sort === s.id ? 'true' : 'false');
            box.appendChild(b);
        });
    }

    function drawFilter(model) {
        var box = $('filter');
        box.textContent = '';
        FILTERS.forEach(function (f) {
            var count = model.nodes.filter(function (n) {
                return matchesFilter(n, f.id);
            }).length;
            var b = K.button('', state.filter === f.id ? 'on' : '', null, function () {
                state.filter = f.id;
                saveHash();
                draw();
            });
            if (f.tone && count) b.appendChild(el('i', 'dot ' + f.tone));
            add(b, el('span', '', f.label), el('span', 'seg-count', String(count)));
            b.setAttribute('aria-pressed', state.filter === f.id ? 'true' : 'false');
            box.appendChild(b);
        });
        var all = $('expand-all');
        all.textContent = '';
        var everyOpen = state.open === '*';
        add(all, K.icon(everyOpen ? 'close' : 'grid'), el('span', '', everyOpen ? 'Collapse all' : 'Expand all'));
    }

    // ----- one node --------------------------------------------------------------

    function spec(n) {
        var parts = [];
        if (n.roles.length) parts.push(n.roles.join(', '));
        if (n.kubelet) parts.push('kubelet ' + n.kubelet);
        if (n.arch) parts.push(n.arch);
        if (n.zone) parts.push(n.zone);
        if (n.created) parts.push('up ' + K.span(n.created));
        return parts.join(' · ');
    }

    function meters(n) {
        var box = el('div', 'host-meters');
        if (!(n.known && n.cpu)) {
            box.appendChild(el('span', 'faint small', 'capacity unknown'));
            return box;
        }
        [
            ['CPU', n.cpuFraction, M.cores(n.requested.cpu) + ' / ' + M.cores(n.cpu), M.cores(n.requested.cpu) + ' of ' + M.cores(n.cpu) + ' cores asked for by guests'],
            ['Memory', n.memoryFraction, M.bytes(n.requested.memory) + ' / ' + M.bytes(n.memory), M.bytes(n.requested.memory) + ' of ' + M.bytes(n.memory) + ' asked for by guests'],
        ].forEach(function (r) {
            var row = el('div', 'meter-row wide');
            row.title = r[3];
            add(row, el('span', 'meter-label', r[0]), K.meter(r[1]), el('span', 'meter-num ' + K.fillTone(r[1]), K.percent(r[1])), el('span', 'meter-abs faint', r[2]));
            box.appendChild(row);
        });
        return box;
    }

    function guestCells(n) {
        var guests = el('div', 'host-guests');
        if (!n.guests.length) guests.appendChild(el('span', 'faint small', 'no guests'));
        n.guests.forEach(function (m) {
            var g = K.button('', 'guest ' + m.tone + ' g-' + m.group, null, function () {
                open(K.machineRef(m));
            });
            g.dataset.key = m.key;
            g.setAttribute('aria-label', m.name + ', ' + m.status);
            guests.appendChild(g);
        });
        if (n.guests.length) guests.appendChild(el('span', 'host-count', M.plural(n.guests.length, 'guest') + ' · ' + M.plural(n.vcpus, 'vCPU') + ' · ' + M.bytes(n.guestMemory)));
        return guests;
    }

    function facts(n) {
        var rows = [
            ['OS', n.os],
            ['Kernel', n.kernel],
            ['Runtime', n.runtime],
            ['CPU model', n.cpuModel],
            ['Allocatable', n.cpu ? M.cores(n.cpu) + ' cores · ' + M.bytes(n.memory) + (n.pods ? ' · ' + n.pods + ' pods' : '') : ''],
            ['virt-handler', n.handler],
            ['Launcher pods', n.launchers ? String(n.launchers) : ''],
            ['Taints', n.taints.join('\n')],
        ].filter(function (r) {
            return r[1];
        });
        var dl = el('dl', 'nfacts');
        rows.forEach(function (r) {
            add(dl, el('dt', '', r[0]), el('dd', r[0] === 'Taints' ? 'mono pre' : '', r[1]));
        });
        return dl;
    }

    function guestTable(n) {
        if (!n.guests.length) return el('p', 'faint small', 'No guest runs on this node.');
        var table = el('table', 'ntable');
        var head = el('tr');
        ['Guest', 'Namespace', 'State', 'vCPUs', 'Memory', 'Address', ''].forEach(function (h) {
            head.appendChild(el('th', '', h));
        });
        add(table, add(el('thead'), head));
        var body = el('tbody');
        n.guests.forEach(function (m) {
            var tr = el('tr');
            var name = el('td', 'ntable-name');
            add(
                name,
                K.screen(m),
                K.link(m.name, function () {
                    open(K.machineRef(m));
                }),
            );
            var st = el('td');
            st.appendChild(K.stateChip(m));
            add(
                tr,
                name,
                el('td', 'faint', m.namespace),
                st,
                el('td', 'num', String(m.cpu.vcpus)),
                el('td', 'num', m.memory.text || '—'),
                el('td', 'mono faint', m.ips[0] || ''),
                el('td', 'faint small', m.uptimeSince ? 'up ' + K.span(m.uptimeSince) : ''),
            );
            body.appendChild(tr);
        });
        table.appendChild(body);
        return table;
    }

    function row(n) {
        var expanded = isOpen(n.name);
        var issues = problems(n);
        var worst = issues.some(function (p) {
            return p.tone === 'error';
        })
            ? 'error'
            : issues.some(function (p) {
                  return p.tone === 'warn';
              })
            ? 'warn'
            : '';
        var li = el('li', 'ncard' + (worst ? ' ' + worst : '') + (n.guests.length ? '' : ' idle') + (expanded ? ' open' : ''));
        li.dataset.node = n.name;

        var host = el('div', 'host');
        var name = el('div', 'host-name');
        var toggleBtn = K.button('', 'icon-button ntoggle', 'arrow', function () {
            toggle(n.name);
        });
        toggleBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        toggleBtn.setAttribute('aria-label', (expanded ? 'Hide ' : 'Show ') + n.name + ' in full');
        var words = el('div', 'nname');
        add(
            words,
            K.link(n.name, function () {
                openNode(n.name);
            }, 'Open ' + n.name + ' in the app'),
            el('div', 'faint small', spec(n)),
        );
        add(name, toggleBtn, words);
        if (issues.length) {
            var badges = el('div', 'host-badges');
            issues.forEach(function (p) {
                badges.appendChild(K.chip(p.text, p.tone, p.icon, p.title));
            });
            name.appendChild(badges);
        }
        add(host, name, guestCells(n), meters(n));
        li.appendChild(host);

        if (expanded) {
            var more = el('div', 'nmore');
            add(more, facts(n), guestTable(n));
            li.appendChild(more);
        }
        return li;
    }

    // ----- putting it together ---------------------------------------------------

    function draw() {
        var model = state.model;
        if (!model || !model.installed) return;
        drawFilter(model);
        var list = $('nlist');
        list.textContent = '';
        var nodes = shown(model);
        if (!model.nodes.length) {
            list.appendChild(el('li', 'quiet', model.nodesKnown ? 'No node is marked kubevirt.io/schedulable and no guest is running. virt-handler labels the nodes it can run guests on.' : 'Nodes could not be read, and no guest is running.'));
            return;
        }
        if (!nodes.length) {
            list.appendChild(el('li', 'quiet', 'No node matches.'));
            return;
        }
        nodes.forEach(function (n) {
            list.appendChild(row(n));
        });
    }

    function drawEmpty(model) {
        var box = $('empty');
        box.textContent = '';
        box.hidden = false;
        var art = el('div', 'empty-art');
        art.appendChild(K.icon('logo'));
        add(box, art, el('h2', '', 'KubeVirt is not installed in ' + state.ctx.contextName), el('p', 'faint', 'This cluster does not serve VirtualMachines, so no node runs guests.'));
        if (model.missing) box.appendChild(el('p', 'faint small', model.missing));
    }

    function render(first) {
        var model = state.model;
        if (!model) return;
        var where = state.ctx.contextName;
        if (model.system.version) where += ' · KubeVirt ' + model.system.version;
        where += ' · ' + M.plural(model.nodes.length, 'node') + ' · ' + M.plural(model.totals.running, 'guest') + ' running';
        $('where').textContent = where;
        if (!model.installed) {
            $('content').hidden = true;
            drawEmpty(model);
            return;
        }
        $('empty').hidden = true;
        $('content').hidden = false;
        if (first) {
            drawStrip(model);
            draw();
            return;
        }
        K.calm($('nstrip'), function () {
            drawStrip(state.model);
        });
        K.calm($('nlist'), draw);
    }

    var timer = null;
    function tick() {
        if (timer) clearTimeout(timer);
        timer = null;
        M.load(sdk)
            .then(function (model) {
                $('error').hidden = true;
                // Ages move even when nothing else does.
                var sig = model.sig + '|' + Math.floor(Date.now() / 60000);
                if (sig === state.sig) return;
                var first = !state.model;
                state.model = model;
                state.sig = sig;
                render(first);
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
        draw();
    });
    $('expand-all').addEventListener('click', function () {
        state.open = state.open === '*' ? '' : '*';
        saveHash();
        draw();
    });
    document.addEventListener('keydown', function (event) {
        if (event.key === '/' && document.activeElement === document.body) {
            event.preventDefault();
            $('query').focus();
        }
    });
    K.tooltip($('nlist'), '.guest', function (g, into) {
        var m = state.model && state.model.machines.find(function (x) {
            return x.key === g.dataset.key;
        });
        return m ? K.describeMachine(m, into) : false;
    });

    loadHash();
    drawSort();

    sdk.ready()
        .then(function (context) {
            state.ctx = context;
            $('where').textContent = context.contextName;
            tick();
        })
        .catch(fail);
})();
