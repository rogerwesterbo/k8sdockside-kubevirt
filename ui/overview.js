// KubeVirt's own overview, in place of the page the app generates for every
// plugin. It says first whether KubeVirt is in this cluster at all and whether
// it is healthy, then what the generated page could not: every machine at
// once, the ones that need a person with the button that fixes each, the nodes
// carrying the guests and how full they are, what is migrating, what KubeVirt
// has been doing, and its charts.
(function () {
    'use strict';

    var sdk = window.k8sdockside;
    var M = window.KubeVirt;
    var K = window.KubeVirtKit;
    var el = K.el;
    var add = K.add;

    var POLL = 5000;
    var EVENTS_EVERY = 15000;
    var SUMMARY_EVERY = 30000;
    var CHARTS_EVERY = 60000;
    var HISTORY_MINUTES = 360;
    var INSTALL_URL = 'https://kubevirt.io/user-guide/cluster_admin/installation/';

    var state = { ctx: null, model: null, sig: '', summary: null, panel: null, events: null, notice: null, needsAll: false };
    var NEEDS_SHOWN = 6;

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

    function openView(id) {
        sdk.openView(id).catch(fail);
    }

    function openNode(name) {
        open({ kind: M.KINDS.nodes, namespace: '', name: name });
    }

    function byKey(key) {
        return (
            (state.model &&
                state.model.machines.find(function (m) {
                    return m.key === key;
                })) ||
            null
        );
    }

    function act(machine, verb) {
        var action = M.offer(machine, verb);
        if (!action) return;
        K.run(sdk, action.id, machine)
            .then(function (res) {
                if (!res.done) return;
                state.notice = { tone: 'ok', text: 'Asked KubeVirt to ' + action.label.toLowerCase() + ' ' + machine.name + (res.created ? ' — created ' + res.created : '') + '.' };
                drawNeeds(state.model, true);
                // Going away on a timer is not the user's doing, so it waits
                // for the pointer like any other redraw.
                setTimeout(function () {
                    state.notice = null;
                    if (state.model) drawNeeds(state.model);
                }, 6000);
            })
            .catch(fail);
    }

    // A series named after a state wears that state's colour, as it does
    // everywhere else on the page; anything else takes the chart colours in
    // order.
    var SERIES_TONE = {
        Running: 'var(--k-ok)',
        Pending: 'var(--k-info)',
        Scheduling: 'var(--k-info)',
        Scheduled: 'var(--k-info)',
        Failed: 'var(--k-error)',
        Succeeded: 'var(--k-faint)',
        Unknown: 'var(--k-warn)',
    };

    function seriesColour(name, i) {
        return SERIES_TONE[name] || K.chartColour(i);
    }

    // ----- the hero ----------------------------------------------------------

    function verdict(model) {
        var sys = model.system;
        var n = model.machines.length;
        var failing = {};
        var wanting = {};
        model.attention.forEach(function (a) {
            wanting[a.machine.key] = true;
            if (a.tone === 'error') failing[a.machine.key] = true;
        });
        var nFail = Object.keys(failing).length;
        var nWant = Object.keys(wanting).length;
        // "Failing" only when every red item is a machine that is failing;
        // a guest that cannot leave a cordoned node is urgent, not failing.
        var allFailing = Object.keys(failing).every(function (k) {
            return model.machines.some(function (m) {
                return m.key === k && m.group === 'failing';
            });
        });
        if (sys.tone === 'error') return { tone: 'error', icon: 'alert', text: 'KubeVirt itself is not healthy' };
        if (n === 0) return { tone: sys.tone === 'warn' ? 'warn' : 'ok', icon: 'check', text: 'KubeVirt is ready — no virtual machines yet' };
        if (nFail) return { tone: 'error', icon: 'alert', text: allFailing ? M.plural(nFail, 'machine is', 'machines are') + ' failing' : M.plural(nWant, 'machine needs', 'machines need') + ' you' };
        if (nWant) return { tone: 'warn', icon: 'alert', text: M.plural(nWant, 'machine needs', 'machines need') + ' a look' };
        if (sys.tone === 'warn') return { tone: 'warn', icon: 'alert', text: 'KubeVirt itself needs a look' };
        var running = model.totals.running;
        if (running === n) return { tone: 'ok', icon: 'check', text: n === 1 ? 'The machine is running' : 'All ' + n + ' machines are running' };
        return { tone: 'ok', icon: 'check', text: 'Every machine is where it should be' };
    }

    function story(model) {
        var p = el('p', 'story');
        function b(text, cls) {
            return el('strong', cls || '', text);
        }
        var t = model.totals;
        var g = model.groups;
        if (!model.machines.length) {
            add(p, 'Nothing is running on KubeVirt yet. Create a VirtualMachine and it will appear here, with where it runs and what it is doing.');
            return p;
        }
        add(p, b(t.running + ' of ' + M.plural(t.machines, 'machine')), ' ' + (t.running === 1 ? 'is' : 'are') + ' running');
        if (t.running) add(p, ' on ', b(M.plural(t.hosts, 'node')), ', with ', b(M.plural(t.vcpus, 'vCPU')), ' and ', b(M.bytes(t.memory)), ' of guest memory between them');
        add(p, '.');
        var rest = [];
        if (g.failing) rest.push(el('strong', 'bad', g.failing + ' failing'));
        if (g.changing) rest.push(el('strong', 'busy', g.changing + ' starting or stopping'));
        if (g.migrating) rest.push(el('strong', 'busy', g.migrating + ' migrating'));
        if (g.paused) rest.push(el('strong', 'paused', g.paused + ' paused'));
        if (g.stopped) rest.push(b(g.stopped + ' stopped'));
        if (rest.length) {
            add(p, ' ');
            rest.forEach(function (r, i) {
                if (i) add(p, i === rest.length - 1 ? ' and ' : ', ');
                p.appendChild(r);
            });
            add(p, '.');
        }
        return p;
    }

    function systemLine(model) {
        var sys = model.system;
        var line = el('div', 'sys-line ' + sys.tone);
        if (!sys.known) {
            add(line, K.icon('settings'), el('span', '', 'KubeVirt’s own components could not be read.'));
            return line;
        }
        var ready = sys.components.filter(function (c) {
            return c.ready === c.total;
        }).length;
        add(line, K.icon(sys.tone === 'ok' ? 'check' : 'alert'), el('span', '', sys.tone === 'ok' ? 'KubeVirt is healthy: ' + ready + ' of ' + M.plural(sys.components.length, 'component') + ' ready' : sys.problems[0] ? sys.problems[0].text : 'KubeVirt needs a look'));
        return line;
    }

    function drawHero(model) {
        var hero = $('hero');
        hero.textContent = '';
        var v = verdict(model);
        hero.className = 'hero ' + v.tone;

        var main = el('div', 'hero-main');
        var eyebrow = el('div', 'eyebrow');
        var logo = el('span', 'logo');
        logo.appendChild(K.icon('logo'));
        add(eyebrow, logo, el('span', '', 'KubeVirt' + (model.system.version ? ' ' + model.system.version : '')), el('span', 'faint', '· ' + state.ctx.contextName + (model.system.namespace ? ' · ' + model.system.namespace : '')));
        var dots = el('span', 'comp-dots');
        model.system.components.forEach(function (c) {
            var d = el('span', 'comp-dot ' + c.tone);
            add(d, el('i'), el('span', '', c.name.replace(/^virt-/, '')));
            d.title = c.name + ': ' + c.ready + ' of ' + c.total + ' ready';
            dots.appendChild(d);
        });
        eyebrow.appendChild(dots);
        main.appendChild(eyebrow);

        var head = el('h1', 'verdict ' + v.tone);
        add(head, K.icon(v.icon), el('span', '', v.text));
        main.appendChild(head);
        main.appendChild(story(model));
        main.appendChild(systemLine(model));

        var cta = el('div', 'cta');
        add(
            cta,
            K.button('Open machines', 'primary', 'grid', function () {
                openView('machines');
            }),
            K.button('Virtual machines', 'ghost', 'monitor', function () {
                openView('virtualmachines');
            }),
        );
        main.appendChild(cta);
        hero.appendChild(main);

        var side = el('div', 'hero-side');
        if (model.machines.length) {
            var hiveBox = el('div', 'hive-box');
            var heroWidth = hero.clientWidth || 900;
            var width = heroWidth < 920 ? Math.max(220, heroWidth - 64) : Math.min(540, Math.max(240, heroWidth * 0.42));
            hiveBox.appendChild(
                K.honeycomb(model.machines, {
                    width: width,
                    maxHeight: 220,
                    onPick: function (key) {
                        var m = byKey(key);
                        if (m) open(K.machineRef(m));
                    },
                }),
            );
            side.appendChild(hiveBox);
            var legend = el('div', 'hive-legend');
            M.GROUPS.forEach(function (g) {
                if (!model.groups[g.id]) return;
                var key = el('span', 'key');
                add(key, el('i', 'hex ' + g.tone + ' g-' + g.id), el('span', '', g.label), el('strong', '', String(model.groups[g.id])));
                legend.appendChild(key);
            });
            side.appendChild(legend);
        } else {
            var art = el('div', 'empty-art');
            art.appendChild(K.icon('logo'));
            side.appendChild(art);
            side.appendChild(el('p', 'faint small center', 'Machines appear here as a honeycomb, one cell each, coloured by what they are doing.'));
        }
        hero.appendChild(side);
    }

    // ----- the strip ---------------------------------------------------------

    function drawStrip(model) {
        var box = $('strip');
        box.textContent = '';
        box.hidden = model.machines.length === 0;
        if (box.hidden) return;
        var g = model.groups;
        var b = el('div', 'bar-block');
        add(
            b,
            el('div', 'bar-title', 'Machines by state'),
            K.stackBar(
                M.GROUPS.map(function (x) {
                    return { id: x.id, label: x.label, count: g[x.id] || 0, tone: x.tone };
                }),
            ),
        );
        box.appendChild(b);

        var facts = el('div', 'facts');
        function fact(iconName, big, small, title) {
            var f = el('div', 'fact');
            add(f, K.icon(iconName), el('strong', '', big), el('span', '', small));
            if (title) f.title = title;
            return f;
        }
        var t = model.totals;
        var schedulable = model.nodes.filter(function (n) {
            return n.schedulable;
        }).length;
        add(
            facts,
            fact('cpu', String(t.vcpus), 'vCPUs running'),
            fact('memory', M.bytes(t.memory), 'guest memory'),
            fact('node', t.hosts + (schedulable ? ' / ' + schedulable : ''), schedulable ? 'nodes hosting / able' : 'nodes hosting', 'Nodes with a running guest, of the nodes KubeVirt marks schedulable'),
            fact('forward', String(model.inFlight.length), model.inFlight.length === 1 ? 'migration in flight' : 'migrations in flight'),
        );
        box.appendChild(facts);
    }

    // ----- needs you ---------------------------------------------------------

    function drawNeeds(model, force) {
        var box = $('needs');
        var draw = function () {
            box.textContent = '';
            var list = model.attention;
            box.className = 'card needs' + (list.length ? '' : ' clear');
            var head = el('div', 'card-head');
            add(head, K.icon(list.length ? 'alert' : 'check'), el('h2', '', list.length ? 'Needs you' : 'Nothing needs you'));
            if (list.length) head.appendChild(el('span', 'count', String(list.length)));
            box.appendChild(head);

            if (state.notice) {
                var note = el('div', 'notice');
                add(note, K.icon('check'), el('span', '', state.notice.text));
                box.appendChild(note);
            }
            if (!list.length) {
                box.appendChild(el('p', 'quiet', model.machines.length ? 'Every machine is running, stopped on purpose, or on its way. None is failing, stuck, paused, or waiting for a restart.' : 'No machines yet.'));
                return;
            }
            var ul = el('ul', 'needs-list');
            list.slice(0, state.needsAll ? list.length : NEEDS_SHOWN).forEach(function (item) {
                var m = item.machine;
                var li = el('li', 'need ' + item.tone);
                li.appendChild(K.screen(m, 'small'));
                var body = el('div', 'need-body');
                var title = el('div', 'need-title');
                add(
                    title,
                    K.link(m.name, function () {
                        open(K.machineRef(m));
                    }),
                    el('span', 'faint small', m.namespace),
                    el('span', 'need-what ' + item.tone, item.what),
                );
                var text = el('div', 'need-text', item.text);
                text.title = item.text;
                add(body, title, text);
                li.appendChild(body);
                var tools = el('div', 'need-tools');
                if (item.fix) {
                    var action = M.offer(m, item.fix);
                    if (action) {
                        tools.appendChild(
                            K.actionButton(action, 'small', function () {
                                act(m, item.fix);
                            }),
                        );
                    }
                }
                var go = K.button('', 'icon-button', 'open', function () {
                    open(K.machineRef(m));
                });
                go.title = 'Open ' + m.name;
                go.setAttribute('aria-label', 'Open ' + m.name);
                tools.appendChild(go);
                li.appendChild(tools);
                ul.appendChild(li);
            });
            box.appendChild(ul);
            if (list.length > NEEDS_SHOWN) {
                box.appendChild(
                    K.button(state.needsAll ? 'Show fewer' : 'Show all ' + list.length, 'ghost small', state.needsAll ? 'close' : 'arrow', function () {
                        state.needsAll = !state.needsAll;
                        drawNeeds(state.model, true);
                    }),
                );
            }
        };
        if (force) draw();
        else K.calm(box, draw);
    }

    // ----- the nodes ---------------------------------------------------------

    function drawNodes(model) {
        var box = $('nodes');
        K.calm(box, function () {
            box.textContent = '';
            var head = el('div', 'card-head');
            add(head, K.icon('node'), el('h2', '', 'Where they run'));
            var kvm = model.nodes.filter(function (n) {
                return n.kvm;
            }).length;
            var able = model.nodes.filter(function (n) {
                return n.schedulable;
            }).length;
            if (able) head.appendChild(el('span', 'faint small', M.plural(able, 'node') + ' can run VMs' + (kvm < able ? ' · ' + kvm + ' with KVM' : '')));
            box.appendChild(head);

            if (!model.nodes.length) {
                box.appendChild(el('p', 'quiet', model.nodesKnown ? 'No node is marked kubevirt.io/schedulable and no guest is running, so there is nothing to show yet. virt-handler labels the nodes it can run guests on.' : 'Nodes could not be read, and no guest is running.'));
                return;
            }
            var ul = el('ul', 'hosts');
            model.nodes.slice(0, 12).forEach(function (n) {
                var li = el('li', 'host' + (n.guests.length ? '' : ' idle'));
                var name = el('div', 'host-name');
                add(
                    name,
                    K.icon('node'),
                    K.link(n.name, function () {
                        openNode(n.name);
                    }),
                );
                var badges = el('div', 'host-badges');
                if (!n.ready) badges.appendChild(K.chip('not ready', 'error', 'alert'));
                if (n.cordoned) badges.appendChild(K.chip('cordoned', 'warn', 'lock', 'No new guest will be placed here'));
                if (n.known && !n.kvm) badges.appendChild(K.chip('no KVM', 'muted', 'bolt', 'Guests here run under software emulation, which is slow'));
                if (n.known && !n.schedulable && n.guests.length) badges.appendChild(K.chip('not schedulable', 'muted', null, 'virt-handler does not mark this node kubevirt.io/schedulable'));
                name.appendChild(badges);
                li.appendChild(name);

                var guests = el('div', 'host-guests');
                if (!n.guests.length) guests.appendChild(el('span', 'faint small', 'no guests'));
                n.guests.slice(0, 40).forEach(function (m) {
                    var g = K.button('', 'guest ' + m.tone + ' g-' + m.group, null, function () {
                        open(K.machineRef(m));
                    });
                    g.dataset.key = m.key;
                    g.setAttribute('aria-label', m.name + ', ' + m.status);
                    guests.appendChild(g);
                });
                if (n.guests.length > 40) guests.appendChild(el('span', 'faint small', '+' + (n.guests.length - 40)));
                if (n.guests.length) guests.appendChild(el('span', 'host-count', M.plural(n.vcpus, 'vCPU') + ' · ' + M.bytes(n.guestMemory)));
                li.appendChild(guests);

                var meters = el('div', 'host-meters');
                if (n.known && n.cpu) {
                    [
                        ['CPU', n.cpuFraction, M.cores(n.requested.cpu) + ' of ' + M.cores(n.cpu) + ' cores asked for by guests'],
                        ['Memory', n.memoryFraction, M.bytes(n.requested.memory) + ' of ' + M.bytes(n.memory) + ' asked for by guests'],
                    ].forEach(function (r) {
                        var row = el('div', 'meter-row');
                        row.title = r[2];
                        add(row, el('span', 'meter-label', r[0]), K.meter(r[1]), el('span', 'meter-num ' + K.fillTone(r[1]), K.percent(r[1])));
                        meters.appendChild(row);
                    });
                } else {
                    meters.appendChild(el('span', 'faint small', 'capacity unknown'));
                }
                li.appendChild(meters);
                ul.appendChild(li);
            });
            box.appendChild(ul);
            if (model.nodes.length > 12) box.appendChild(el('p', 'faint small', 'and ' + (model.nodes.length - 12) + ' more nodes'));
            box.appendChild(el('p', 'foot-note', 'The bars are what the guests’ virt-launcher pods ask the scheduler for, against what each node can give.'));
        });
    }

    // ----- migrations --------------------------------------------------------

    function drawMigrations(model) {
        var box = $('migrations');
        K.calm(box, function () {
            box.textContent = '';
            var head = el('div', 'card-head');
            add(head, K.icon('forward'), el('h2', '', 'Live migrations'));
            if (model.inFlight.length) head.appendChild(el('span', 'count info', String(model.inFlight.length)));
            box.appendChild(head);
            if (!model.migrationsKnown) {
                box.appendChild(el('p', 'quiet', 'This cluster does not serve VirtualMachineInstanceMigrations, or they could not be read.'));
                return;
            }
            var day = Date.now() - 24 * 3600 * 1000;
            var recent = model.migrations.filter(function (m) {
                return !m.inFlight && (m.ended || m.created) > day;
            });
            if (!model.inFlight.length && !recent.length) {
                var last = model.migrations[0];
                box.appendChild(el('p', 'quiet', 'Nothing is moving' + (last ? ', and nothing has in the last day. The last migration finished ' + K.ago(last.ended || last.created) + '.' : ', and no migration has been recorded.') + ' A guest moves when somebody migrates it or when its node is drained.'));
            }
            model.inFlight.forEach(function (mig) {
                var row = el('div', 'mig live');
                var line = el('div', 'mig-line');
                var m = byKey(mig.namespace + '/' + mig.vmi);
                add(
                    line,
                    K.link(mig.vmi, function () {
                        open(m ? K.machineRef(m) : { kind: M.KINDS.vmis, namespace: mig.namespace, name: mig.vmi });
                    }),
                    K.chip(mig.phase, 'info', 'forward'),
                    el('span', 'faint small', 'for ' + K.span(mig.started)),
                );
                add(row, line, K.flight(mig, openNode));
                box.appendChild(row);
            });
            if (recent.length) {
                box.appendChild(el('div', 'sub-title', 'In the last day'));
                var ul = el('ul', 'mig-list');
                recent.slice(0, 5).forEach(function (mig) {
                    var li = el('li', mig.failed ? 'error' : 'ok');
                    add(
                        li,
                        K.icon(mig.failed ? 'close' : 'check'),
                        K.link(mig.vmi, function () {
                            open({ kind: M.KINDS.migrations, namespace: mig.namespace, name: mig.name });
                        }),
                        el('span', 'mig-route', (mig.source || '?') + ' → ' + (mig.target || '?')),
                        el('span', 'faint small', K.ago(mig.ended || mig.created)),
                    );
                    if (mig.failed && mig.reason) li.title = mig.reason;
                    ul.appendChild(li);
                });
                box.appendChild(ul);
            }
            box.appendChild(
                K.button('All migrations', 'ghost small', 'arrow', function () {
                    openView('migrations');
                }),
            );
        });
    }

    // ----- KubeVirt itself ---------------------------------------------------

    function componentList(list) {
        var ul = el('ul', 'components');
        list.forEach(function (c) {
            var li = el('li', 'component ' + c.tone);
            var dots = el('span', 'pod-dots');
            for (var i = 0; i < c.total && i < 24; i++) dots.appendChild(el('i', i < c.ready ? 'ok' : 'error'));
            add(li, el('span', 'component-name', c.name), dots, el('span', 'component-count', c.ready + ' / ' + c.total));
            if (c.restarts > 0) li.appendChild(K.chip(M.plural(c.restarts, 'restart'), c.restarts > 5 ? 'warn' : 'muted', 'repeat'));
            li.title = c.pods
                .map(function (p) {
                    return p.metadata.name + (p.spec && p.spec.nodeName ? ' on ' + p.spec.nodeName : '');
                })
                .join('\n');
            ul.appendChild(li);
        });
        return ul;
    }

    function drawSystem(model) {
        var box = $('system');
        K.calm(box, function () {
            var sys = model.system;
            box.textContent = '';
            box.className = 'card system ' + sys.tone;
            var head = el('div', 'card-head');
            add(head, K.icon('settings'), el('h2', '', 'KubeVirt itself'));
            if (sys.phase) head.appendChild(K.chip(sys.phase, sys.phase === 'Deployed' ? 'ok' : 'warn'));
            if (sys.version) head.appendChild(el('code', 'rev', sys.version));
            box.appendChild(head);
            if (!sys.known) {
                box.appendChild(el('p', 'quiet', 'No KubeVirt resource and no pods labelled kubevirt.io=virt-api, virt-controller, virt-handler or virt-operator could be read, so KubeVirt’s own health cannot be shown.'));
                return;
            }
            sys.problems.forEach(function (p) {
                var why = el('div', 'why ' + p.tone);
                add(why, K.icon('alert'), el('span', '', p.text));
                box.appendChild(why);
            });
            if (sys.components.length) box.appendChild(componentList(sys.components));
            if (sys.cdi.length) {
                box.appendChild(el('div', 'sub-title', 'Containerized Data Importer'));
                box.appendChild(componentList(sys.cdi));
            }
            var tools = el('div', 'card-tools');
            add(
                tools,
                K.button("KubeVirt's own workloads", 'ghost small', 'arrow', function () {
                    openView('components');
                }),
                K.button('Settings', 'ghost small', 'settings', function () {
                    if (sys.cr) open({ kind: M.KINDS.kubevirts, namespace: sys.cr.metadata.namespace, name: sys.cr.metadata.name });
                    else openView('settings');
                }),
            );
            box.appendChild(tools);
        });
    }

    // ----- activity ----------------------------------------------------------

    function openEvent(ev) {
        var kinds = { VirtualMachine: M.KINDS.vms, VirtualMachineInstance: M.KINDS.vmis, VirtualMachineInstanceMigration: M.KINDS.migrations, DataVolume: M.KINDS.datavolumes, KubeVirt: M.KINDS.kubevirts };
        var kind = kinds[ev.kind];
        if (kind) open({ kind: kind, namespace: ev.namespace, name: ev.name });
    }

    function drawActivity() {
        var box = $('activity');
        K.calm(box, function () {
            box.textContent = '';
            var head = el('div', 'card-head');
            add(head, K.icon('activity'), el('h2', '', 'Recent activity'));
            box.appendChild(head);
            if (state.events === null) {
                box.appendChild(el('p', 'quiet', 'Reading events…'));
                return;
            }
            if (!state.events.length) {
                box.appendChild(el('p', 'quiet', 'Nothing from KubeVirt lately. Kubernetes keeps events for about an hour, so a quiet cluster reads as an empty list.'));
                return;
            }
            box.appendChild(K.eventList(state.events, openEvent));
        });
    }

    // ----- history -----------------------------------------------------------

    function drawHistory() {
        var box = $('history');
        var panel = state.panel;
        box.textContent = '';
        box.hidden = !panel || !panel.attached;
        if (box.hidden) return;
        var head = el('div', 'section-head');
        add(head, K.icon('chart'), el('h2', '', 'Over the last ' + Math.round(HISTORY_MINUTES / 60) + ' hours'));
        box.appendChild(head);
        if (!panel.source || !panel.source.available) {
            var note = el('div', 'quiet-card');
            add(note, K.icon('chart'), el('span', '', 'No Prometheus was found in this cluster, so there is no history to draw. Everything above works without one. ' + ((panel.source && panel.source.error) || 'If yours lives somewhere the app did not look, set it in the cluster settings panel.')));
            box.appendChild(note);
            return;
        }
        var row = el('div', 'chart-row');
        panel.charts.forEach(function (c) {
            row.appendChild(K.sparkChart(c, seriesColour));
        });
        box.appendChild(row);
        if (panel.source.describe) box.appendChild(el('p', 'foot-note', 'From ' + panel.source.describe));
    }

    // ----- the foot ----------------------------------------------------------

    var DESTINATIONS = [
        { id: 'machines', label: 'Machines', icon: 'grid' },
        { id: 'virtualmachines', label: 'Virtual machines', icon: 'monitor' },
        { id: 'instances', label: 'Instances', icon: 'cpu' },
        { id: 'migrations', label: 'Migrations', icon: 'forward' },
        { id: 'datavolumes', label: 'Data volumes', icon: 'disk' },
        { id: 'instancetypes', label: 'Instance types', icon: 'tag' },
        { id: 'snapshots', label: 'Snapshots', icon: 'layers' },
        { id: 'networks', label: 'Networks', icon: 'network' },
        { id: 'settings', label: 'KubeVirt settings', icon: 'settings' },
    ];

    function drawFoot() {
        var box = $('foot');
        box.textContent = '';
        box.hidden = false;
        var go = el('div', 'go');
        DESTINATIONS.forEach(function (d) {
            go.appendChild(
                K.button(d.label, 'go-tile', d.icon, function () {
                    openView(d.id);
                }),
            );
        });
        box.appendChild(go);
        if (state.summary && state.summary.requirements && state.summary.requirements.length) {
            var reqs = el('div', 'reqs');
            reqs.appendChild(el('span', 'reqs-label', 'This cluster serves'));
            state.summary.requirements.forEach(function (r) {
                reqs.appendChild(K.chip(r.label, r.error ? 'warn' : r.served ? 'ok' : r.optional ? 'muted' : 'error', r.error ? 'alert' : r.served ? 'check' : 'close', r.error || r.kind));
            });
            box.appendChild(reqs);
        }
        var about = aboutPlugin();
        if (about) box.appendChild(about);
    }

    // What the manifest says about this plugin -- its version and its links --
    // as the app hands it over. An older app hands over nothing, and then
    // there is nothing to draw.
    function aboutPlugin() {
        var p = state.ctx && state.ctx.plugin;
        if (!p) return null;
        var links = (p.links || []).filter(function (l) {
            return l && /^https?:\/\//.test(l.url || '');
        });
        if (p.docs && /^https?:\/\//.test(p.docs) && !links.some(function (l) {
            return l.url === p.docs;
        })) {
            links.push({ label: 'Documentation', url: p.docs });
        }
        if (!links.length && !p.version) return null;
        var row = el('div', 'about');
        row.appendChild(el('span', 'about-name', (p.name || 'This plugin') + ' plugin' + (p.version ? ' ' + p.version : '')));
        links.forEach(function (l) {
            var b = K.button(l.label || l.url.replace(/^https?:\/\//, ''), 'link-chip', 'open', function () {
                sdk.openUrl(l.url).catch(fail);
            });
            b.title = l.url;
            row.appendChild(b);
        });
        return row;
    }

    // ----- not here, or not reachable ----------------------------------------

    function drawAbsent(summary, model) {
        var hero = $('hero');
        hero.textContent = '';
        hero.className = 'hero absent';
        ['strip', 'columns', 'lower', 'history', 'foot'].forEach(function (id) {
            $(id).hidden = true;
        });
        var main = el('div', 'hero-main');
        var art = el('div', 'empty-art');
        art.appendChild(K.icon('logo'));
        main.appendChild(art);
        var unreachable = summary && !summary.checked;
        main.appendChild(el('h1', 'verdict', unreachable ? 'This cluster did not answer' : 'KubeVirt is not installed in ' + state.ctx.contextName));
        main.appendChild(
            el(
                'p',
                'story',
                unreachable
                    ? 'Whether KubeVirt is here could not be checked, which is not the same as it being absent. ' + (summary.error || '')
                    : 'This cluster does not serve VirtualMachines, so nothing here runs virtual machines through KubeVirt. The plugin stays in the sidebar for the clusters that do.',
            ),
        );
        if (summary && summary.requirements && summary.requirements.length) {
            var ul = el('ul', 'req-list');
            summary.requirements.forEach(function (r) {
                var li = el('li', r.served ? 'ok' : r.optional ? 'muted' : 'error');
                add(li, K.icon(r.served ? 'check' : 'close'), el('span', '', r.label), el('code', 'faint', r.kind.replace(/^crd:/, '')));
                if (r.optional) li.appendChild(el('span', 'faint small', 'optional'));
                ul.appendChild(li);
            });
            main.appendChild(ul);
        } else if (model && model.missing) {
            main.appendChild(el('p', 'faint small', model.missing));
        }
        if (!unreachable) {
            var cta = el('div', 'cta');
            cta.appendChild(
                K.button('How to install KubeVirt', 'primary', 'open', function () {
                    sdk.openUrl(INSTALL_URL).catch(fail);
                }),
            );
            main.appendChild(cta);
        }
        var about = aboutPlugin();
        if (about) main.appendChild(about);
        hero.appendChild(main);
    }

    // ----- putting it together -----------------------------------------------

    function render() {
        var model = state.model;
        var summary = state.summary;
        if (summary && (!summary.checked || !summary.installed)) {
            drawAbsent(summary, model);
            return;
        }
        if (!model) return;
        if (!model.installed) {
            drawAbsent(summary, model);
            return;
        }
        $('columns').hidden = false;
        $('lower').hidden = false;
        arrange(model);
        K.calm($('hero'), function () {
            drawHero(model);
        });
        drawStrip(model);
        drawNeeds(model);
        drawNodes(model);
        drawMigrations(model);
        drawSystem(model);
        drawActivity();
        drawHistory();
        drawFoot();
    }

    // With nothing needing anyone the left column is one short card; KubeVirt
    // itself moves up under it, and the activity gets the lower row to itself.
    function arrange(model) {
        var calmPage = model.attention.length === 0;
        var system = $('system');
        if (calmPage && system.parentNode !== $('left')) $('left').appendChild(system);
        if (!calmPage && system.parentNode !== $('lower')) $('lower').insertBefore(system, $('activity'));
        $('lower').classList.toggle('single', calmPage);
    }

    function every(ms, fn) {
        function tick() {
            Promise.resolve()
                .then(fn)
                .catch(fail)
                .then(function () {
                    setTimeout(tick, ms);
                });
        }
        tick();
    }

    function refreshEvents() {
        if (!state.model || !state.model.installed) return null;
        return M.loadEvents(sdk, state.model, 10).then(function (events) {
            var changed = JSON.stringify(events) !== JSON.stringify(state.events);
            state.events = events;
            if (changed) drawActivity();
        });
    }

    K.tooltip($('hero'), '.cell', function (cell, into) {
        var m = byKey(cell.dataset.key);
        return m ? K.describeMachine(m, into) : false;
    });
    K.tooltip($('nodes'), '.guest', function (g, into) {
        var m = byKey(g.dataset.key);
        return m ? K.describeMachine(m, into) : false;
    });

    var lastWidth = 0;
    if (typeof ResizeObserver === 'function') {
        new ResizeObserver(function () {
            // The honeycomb is laid out for a width; redraw it when that moves.
            var w = document.body.clientWidth;
            if (Math.abs(w - lastWidth) > 40 && state.model && state.model.installed && !(state.summary && !state.summary.installed)) {
                lastWidth = w;
                drawHero(state.model);
            }
        }).observe(document.body);
    }

    sdk.ready()
        .then(function (context) {
            state.ctx = context;
            every(POLL, function () {
                return M.load(sdk).then(function (model) {
                    $('error').hidden = true;
                    // Ages move even when nothing else does, so a minute's
                    // change counts as a change.
                    var sig = model.sig + '|' + Math.floor(Date.now() / 60000);
                    if (sig === state.sig) return;
                    var first = !state.model;
                    state.model = model;
                    state.sig = sig;
                    render();
                    if (first) refreshEvents();
                });
            });
            every(SUMMARY_EVERY, function () {
                return sdk.summary().then(function (summary) {
                    var changed = JSON.stringify(summary) !== JSON.stringify(state.summary);
                    state.summary = summary;
                    if (changed) render();
                });
            });
            every(CHARTS_EVERY, function () {
                if (!sdk.charts) return null;
                return sdk.charts({ minutes: HISTORY_MINUTES }).then(function (panel) {
                    state.panel = panel;
                    if (state.model && state.model.installed && !(state.summary && !state.summary.installed)) drawHistory();
                });
            });
            setInterval(function () {
                Promise.resolve(refreshEvents()).catch(fail);
            }, EVENTS_EVERY);
        })
        .catch(fail);
})();
