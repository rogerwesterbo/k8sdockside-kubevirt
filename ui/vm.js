// A virtual machine's own panel in its detail view: its state and how long it
// has been in it, where it runs, its addresses, what is wrong with it if
// anything is, recent migrations, and a button group of the lifecycle actions
// this plugin offers on it right now -- the same ones as on the action bar,
// which the app asks about before running.
(function () {
    'use strict';

    var sdk = window.k8sdockside;
    var M = window.KubeVirt;
    var K = window.KubeVirtKit;
    var el = K.el;
    var add = K.add;
    var POLL = 4000;

    var state = { ctx: null, sig: '', busy: false, last: null, notice: null };

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

    function run(action, m) {
        state.busy = true;
        if (state.last) draw(state.last.m, state.last.offered);
        // The app asks the user before anything is sent.
        sdk.run(action.id)
            .then(function (res) {
                state.notice = action.label + ' asked for' + (res && res.created ? ' — created ' + res.created : '') + '.';
                setTimeout(function () {
                    state.notice = null;
                    state.sig = '';
                    tick(false);
                }, 6000);
            })
            .catch(function (err) {
                if (!/declined/.test((err && err.message) || '')) fail(err);
            })
            .then(function () {
                state.busy = false;
                state.sig = '';
                // The answer to the user's own click: drawn at once, under the
                // pointer or not.
                tick(true);
            });
        void m;
    }

    function fact(list, label, value) {
        list.appendChild(el('dt', '', label));
        var dd = el('dd');
        if (value && typeof value === 'object') dd.appendChild(value);
        else dd.textContent = value || '—';
        list.appendChild(dd);
    }

    function draw(m, offered) {
        state.last = { m: m, offered: offered };
        var root = $('root');
        root.textContent = '';

        var head = el('div', 'panel-head');
        var ident = el('div', 'panel-ident');
        add(ident, K.screen(m), K.stateChip(m));
        var when = m.running && m.uptimeSince ? 'up ' + K.span(m.uptimeSince) : m.since ? 'for ' + K.span(m.since) : 'created ' + K.ago(m.created);
        ident.appendChild(el('span', 'faint small', when));
        head.appendChild(ident);

        // The machine's own button group, drawn from what the plugin offers on
        // it right now. Every press is confirmed by the app.
        var buttons = el('div', 'panel-buttons');
        buttons.setAttribute('role', 'toolbar');
        buttons.setAttribute('aria-label', 'Machine actions');
        (offered || []).forEach(function (a) {
            var b = K.actionButton(a, 'small', function () {
                run(a, m);
            });
            b.disabled = state.busy;
            b.title = a.label;
            buttons.appendChild(b);
        });
        head.appendChild(buttons);
        root.appendChild(head);

        if (state.notice) {
            var note = el('div', 'notice');
            add(note, K.icon('check'), el('span', '', state.notice));
            root.appendChild(note);
        }

        if (m.reason && m.group !== 'running') {
            var why = el('div', 'why ' + (m.tone === 'muted' ? 'info' : m.tone));
            add(why, K.icon(m.group === 'failing' || m.stuck ? 'alert' : 'clock'), el('span', '', m.reason));
            root.appendChild(why);
        }
        if (m.restartRequired) {
            var rr = el('div', 'why warn');
            add(rr, K.icon('repeat'), el('span', '', 'Its spec has changed in a way that only takes effect when the guest restarts.'));
            root.appendChild(rr);
        }

        if (m.moving) {
            var mv = el('div', 'panel-move');
            mv.appendChild(el('span', 'panel-label', 'Migrating'));
            mv.appendChild(K.flight(m.moving, function (n) {
                open({ kind: M.KINDS.nodes, namespace: '', name: n });
            }));
            root.appendChild(mv);
        }

        var facts = el('dl', 'facts-list');
        fact(facts, 'Size', K.specLine(m) + (m.instancetype ? ' · ' + m.instancetype.name : ''));
        fact(facts, 'Run strategy', m.runStrategy);
        if (!m.vmi) {
            fact(facts, 'Instance', 'none — the machine is not running');
        } else {
            fact(
                facts,
                'Node',
                m.node
                    ? K.link(m.node, function () {
                          open({ kind: M.KINDS.nodes, namespace: '', name: m.node });
                      })
                    : 'not placed yet',
            );
            fact(facts, 'Addresses', m.ips.length ? el('span', 'mono', m.ips.join(', ')) : m.running ? 'none reported' + (m.agent ? '' : ' — no guest agent') : '');
            fact(facts, 'Guest OS', m.os.pretty || 'unknown — no guest agent');
            fact(
                facts,
                'Instance',
                K.link(m.vmi.metadata.name, function () {
                    open({ kind: M.KINDS.vmis, namespace: m.namespace, name: m.vmi.metadata.name });
                }),
            );
            if (m.launcher) {
                var pod = m.launcher;
                var podCell = el('span', '');
                add(
                    podCell,
                    K.link(pod.metadata.name, function () {
                        open({ kind: M.KINDS.pods, namespace: pod.metadata.namespace, name: pod.metadata.name });
                    }),
                    el('span', 'faint', ' · '),
                    K.link('logs', function () {
                        sdk.logs({ kind: M.KINDS.pods, namespace: pod.metadata.namespace, name: pod.metadata.name }).catch(fail);
                    }),
                );
                fact(facts, 'Launcher pod', podCell);
            }
            if (m.running) fact(facts, 'Live migration', m.migratable === 'False' ? 'not possible' + (m.migratableWhy ? ' — ' + m.migratableWhy : '') : 'possible');
        }
        root.appendChild(facts);

        var bad = m.conditions.filter(function (c) {
            var good = c.type === 'Failure' || c.type === 'RestartRequired' || c.type === 'Paused' ? c.status !== 'True' : c.status === 'True';
            return c.type && !good && c.type !== 'LiveMigratable' && c.type !== 'AgentConnected';
        });
        if (m.conditions.length) {
            var chips = el('div', 'panel-conds');
            chips.appendChild(el('span', 'panel-label', 'Conditions'));
            m.conditions.forEach(function (c) {
                if (!c.type) return;
                var isBad = bad.indexOf(c) >= 0;
                var ch = K.chip(c.type + ': ' + c.status, isBad ? 'warn' : 'muted', isBad ? 'alert' : null, c.message || c.reason || '');
                chips.appendChild(ch);
            });
            root.appendChild(chips);
        }

        if (m.migrations.length) {
            var ml = el('div', 'panel-migs');
            ml.appendChild(el('span', 'panel-label', 'Migrations'));
            var ul = el('ul', 'mig-list');
            m.migrations.slice(0, 4).forEach(function (mig) {
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
                ul.appendChild(li);
            });
            ml.appendChild(ul);
            root.appendChild(ml);
        }
    }

    function tick(now) {
        Promise.all([
            sdk.object(),
            sdk.actions().catch(function () {
                return null;
            }),
        ])
            .then(function (got) {
                var vm = got[0];
                return M.loadOne(sdk, vm).then(function (m) {
                    $('error').hidden = true;
                    var offered = got[1] === null ? M.offered(m) : got[1];
                    var sig = [
                        vm.metadata.resourceVersion,
                        m.vmi ? m.vmi.metadata.resourceVersion : '',
                        m.launcher ? m.launcher.metadata.resourceVersion : '',
                        m.migrations.map(function (x) {
                            return x.name + x.phase;
                        }).join(','),
                        JSON.stringify(offered),
                        state.busy,
                        state.notice,
                        Math.floor(Date.now() / 60000),
                    ].join('|');
                    if (sig === state.sig) return;
                    state.sig = sig;
                    var root = $('root');
                    if (now === true) {
                        draw(m, offered);
                        return;
                    }
                    // Not under the pointer: a poll must not pull a button out
                    // from under a click.
                    K.calm(root, function () {
                        draw(m, offered);
                    });
                });
            })
            .catch(fail);
    }

    sdk.ready()
        .then(function (context) {
            state.ctx = context;
            if (!context.object) {
                fail(new Error('This page is a panel, drawn for one virtual machine.'));
                return;
            }
            tick(true);
            setInterval(function () {
                if (!state.busy) tick(false);
            }, POLL);
        })
        .catch(fail);
})();
