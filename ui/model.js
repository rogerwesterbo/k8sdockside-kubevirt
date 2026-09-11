// The KubeVirt model every page of this plugin draws from: the virtual
// machines and their running instances joined into one "machine" each, the
// nodes carrying them, the live migrations, and how KubeVirt's own
// components are doing. Read once per poll through the k8sdockside bridge and
// worked out here, so the pages only have to draw.
//
// Nothing in this file touches the document. It is loaded by the pages as a
// classic script (window.KubeVirt) and by the unit tests in node.
(function () {
    'use strict';

    var KINDS = {
        vms: 'crd:virtualmachines.kubevirt.io',
        vmis: 'crd:virtualmachineinstances.kubevirt.io',
        migrations: 'crd:virtualmachineinstancemigrations.kubevirt.io',
        kubevirts: 'crd:kubevirts.kubevirt.io',
        datavolumes: 'crd:datavolumes.cdi.kubevirt.io',
        instancetypes: 'crd:virtualmachineinstancetypes.instancetype.kubevirt.io',
        clusterinstancetypes: 'crd:virtualmachineclusterinstancetypes.instancetype.kubevirt.io',
        pods: 'pods',
        nodes: 'nodes',
        events: 'events',
        pvcs: 'persistentvolumeclaims',
    };

    // The pods KubeVirt runs itself, by the kubevirt.io label its operator
    // puts on every one, wherever it was installed.
    var COMPONENTS = ['virt-operator', 'virt-api', 'virt-controller', 'virt-handler', 'virt-exportproxy', 'virt-synchronization-controller'];
    var COMPONENT_SELECTOR = 'kubevirt.io in (' + COMPONENTS.join(',') + ')';
    // CDI's, for the disks it imports. Optional: plenty of clusters have none.
    var CDI_COMPONENTS = ['cdi-operator', 'cdi-apiserver', 'cdi-deployment', 'cdi-uploadproxy'];
    var CDI_SELECTOR = 'cdi.kubevirt.io in (' + CDI_COMPONENTS.join(',') + ')';
    var LAUNCHER_SELECTOR = 'kubevirt.io=virt-launcher';

    // A machine that has been starting or stopping for longer than this is
    // stuck, not busy.
    var STUCK_AFTER = 10 * 60 * 1000;
    // A failed migration is worth a line for this long, unless the machine has
    // moved successfully since.
    var MIGRATION_MEMORY = 6 * 60 * 60 * 1000;

    // What each printableStatus KubeVirt writes on a VirtualMachine means: its
    // tone, and the group the pages file it under.
    var STATUS = {
        Running: { tone: 'ok', group: 'running' },
        Paused: { tone: 'paused', group: 'paused' },
        Migrating: { tone: 'info', group: 'migrating' },
        Starting: { tone: 'info', group: 'changing' },
        Provisioning: { tone: 'info', group: 'changing' },
        WaitingForVolumeBinding: { tone: 'info', group: 'changing' },
        WaitingForReceiver: { tone: 'info', group: 'changing' },
        Stopping: { tone: 'info', group: 'changing' },
        Terminating: { tone: 'info', group: 'changing' },
        Stopped: { tone: 'muted', group: 'stopped' },
        CrashLoopBackOff: { tone: 'error', group: 'failing' },
        ErrorUnschedulable: { tone: 'error', group: 'failing' },
        ErrImagePull: { tone: 'error', group: 'failing' },
        ImagePullBackOff: { tone: 'error', group: 'failing' },
        ErrorPvcNotFound: { tone: 'error', group: 'failing' },
        DataVolumeError: { tone: 'error', group: 'failing' },
        Unknown: { tone: 'warn', group: 'failing' },
    };

    // The same for an instance with no VirtualMachine of its own.
    var PHASE_STATUS = { Running: 'Running', Pending: 'Starting', Scheduling: 'Starting', Scheduled: 'Starting', Succeeded: 'Stopped', Failed: 'Failed', Unknown: 'Unknown' };

    // Worst first, everywhere.
    var GROUPS = [
        { id: 'failing', label: 'Failing', tone: 'error' },
        { id: 'changing', label: 'Starting or stopping', tone: 'info' },
        { id: 'migrating', label: 'Migrating', tone: 'info' },
        { id: 'paused', label: 'Paused', tone: 'paused' },
        { id: 'running', label: 'Running', tone: 'ok' },
        { id: 'stopped', label: 'Stopped', tone: 'muted' },
    ];
    var GROUP_RANK = {};
    GROUPS.forEach(function (g, i) {
        GROUP_RANK[g.id] = i;
    });

    // What a failing status is, in words.
    var STATUS_WORDS = {
        CrashLoopBackOff: 'Keeps crashing',
        ErrorUnschedulable: 'Cannot be placed',
        ErrImagePull: 'Image cannot be pulled',
        ImagePullBackOff: 'Image cannot be pulled',
        ErrorPvcNotFound: 'A disk is missing',
        DataVolumeError: 'A disk failed to import',
        Unknown: 'State unknown',
        Failed: 'Failed',
        WaitingForVolumeBinding: 'Waiting for its disks',
        WaitingForReceiver: 'Waiting for a receiver',
        Provisioning: 'Preparing its disks',
    };

    var STATUS_EXPLAINED = {
        CrashLoopBackOff: 'The guest keeps failing to start, and KubeVirt is backing off between tries.',
        ErrorUnschedulable: 'No node can take it — usually for want of memory, CPU or a device it asks for.',
        ErrImagePull: 'A container disk image could not be pulled.',
        ImagePullBackOff: 'A container disk image could not be pulled, and the kubelet is backing off.',
        ErrorPvcNotFound: 'A PersistentVolumeClaim one of its disks names does not exist.',
        DataVolumeError: 'CDI could not import or clone one of its disks.',
        Unknown: 'KubeVirt cannot tell what the machine is doing; its node may have stopped answering.',
        Failed: 'The instance ended in failure.',
    };

    // ----- the actions, as plugin.json declares them ---------------------------

    // The same buttons and the same conditions as the manifest, so the pages
    // can tell which one fixes a machine without asking the app about every
    // machine on every poll. The app still decides: it reads the object again
    // when a button is pressed and refuses one whose conditions no longer hold.
    // model.test.js checks this table against plugin.json.
    var ACTIONS = [
        { id: 'start', kind: KINDS.vms, label: 'Start', icon: 'play', when: [{ field: 'status.printableStatus', in: ['Stopped'] }] },
        { id: 'pause', kind: KINDS.vms, label: 'Pause', icon: 'pause', when: [{ field: 'status.printableStatus', in: ['Running'] }] },
        { id: 'unpause', kind: KINDS.vms, label: 'Resume', icon: 'play', when: [{ field: 'status.printableStatus', in: ['Paused'] }] },
        { id: 'restart', kind: KINDS.vms, label: 'Restart', icon: 'repeat', when: [{ field: 'status.printableStatus', in: ['Running', 'Paused'] }] },
        { id: 'softreboot', kind: KINDS.vms, label: 'Reboot', icon: 'power', when: [{ field: 'status.printableStatus', in: ['Running'] }] },
        {
            id: 'migrate',
            kind: KINDS.vms,
            label: 'Migrate',
            icon: 'forward',
            when: [
                { field: 'status.printableStatus', in: ['Running'] },
                { field: 'status.conditions[LiveMigratable]', notIn: ['False'] },
            ],
        },
        { id: 'stop', kind: KINDS.vms, label: 'Stop', icon: 'stop', tone: 'danger', when: [{ field: 'status.printableStatus', notIn: ['Stopped', 'Stopping', 'Terminating'] }] },
        {
            id: 'instance-pause',
            kind: KINDS.vmis,
            label: 'Pause',
            icon: 'pause',
            when: [
                { field: 'status.phase', in: ['Running'] },
                { field: 'status.conditions[Paused]', notIn: ['True'] },
            ],
        },
        { id: 'instance-unpause', kind: KINDS.vmis, label: 'Resume', icon: 'play', when: [{ field: 'status.conditions[Paused]', in: ['True'] }] },
        { id: 'instance-restart', kind: KINDS.vmis, label: 'Restart', icon: 'repeat', when: [{ field: 'status.phase', in: ['Running'] }] },
        {
            id: 'instance-softreboot',
            kind: KINDS.vmis,
            label: 'Reboot',
            icon: 'power',
            when: [
                { field: 'status.phase', in: ['Running'] },
                { field: 'status.conditions[Paused]', notIn: ['True'] },
            ],
        },
        {
            id: 'instance-migrate',
            kind: KINDS.vmis,
            label: 'Migrate',
            icon: 'forward',
            when: [
                { field: 'status.phase', in: ['Running'] },
                { field: 'status.conditions[Paused]', notIn: ['True'] },
                { field: 'status.conditions[LiveMigratable]', notIn: ['False'] },
            ],
        },
        { id: 'instance-stop', kind: KINDS.vmis, label: 'Stop', icon: 'stop', tone: 'danger', when: [{ field: 'status.phase', notIn: ['Succeeded', 'Failed'] }] },
    ];

    // A field path as the app evaluates it: a dotted path to a string, or
    // `status.conditions[Type]` for that condition's status. Anything that is
    // not a string reads as absent, exactly as in the app.
    function fieldValue(obj, path) {
        var open = path.indexOf('[');
        if (open >= 0 && path.charAt(path.length - 1) === ']') {
            var want = path.slice(open + 1, -1).toLowerCase();
            var list = dig(obj, path.slice(0, open));
            if (!Array.isArray(list)) return '';
            for (var i = 0; i < list.length; i++) {
                if (list[i] && String(list[i].type || '').toLowerCase() === want) return typeof list[i].status === 'string' ? list[i].status : '';
            }
            return '';
        }
        var v = dig(obj, path);
        return typeof v === 'string' ? v : '';
    }

    function offers(action, obj) {
        return (action.when || []).every(function (c) {
            var v = fieldValue(obj, c.field);
            if (c.in && c.in.length && c.in.indexOf(v) < 0) return false;
            if (c.notIn && c.notIn.indexOf(v) >= 0) return false;
            if (!(c.in && c.in.length) && !(c.notIn && c.notIn.length) && v === '') return false;
            return true;
        });
    }

    // What this plugin offers on a machine right now, by the object the
    // buttons act on: the VirtualMachine, or a lone instance.
    function offered(machine) {
        var obj = machine.standalone ? machine.vmi : machine.obj;
        return ACTIONS.filter(function (a) {
            return a.kind === machine.kind && offers(a, obj);
        });
    }

    // The action with this verb for a machine -- 'stop' is 'instance-stop' on a
    // lone instance -- if it is offered right now.
    function offer(machine, verb) {
        var id = machine.standalone ? 'instance-' + verb : verb;
        return (
            offered(machine).find(function (a) {
                return a.id === id;
            }) || null
        );
    }

    function actionById(id) {
        return (
            ACTIONS.find(function (a) {
                return a.id === id;
            }) || null
        );
    }

    // ----- small readers ---------------------------------------------------------

    function dig(obj, path) {
        var at = obj;
        var keys = path.split('.');
        for (var i = 0; i < keys.length; i++) {
            if (at === null || at === undefined) return undefined;
            at = at[keys[i]];
        }
        return at;
    }

    function labelsOf(obj) {
        return (obj && obj.metadata && obj.metadata.labels) || {};
    }

    function annotationsOf(obj) {
        return (obj && obj.metadata && obj.metadata.annotations) || {};
    }

    function conditionOf(obj, type) {
        var list = dig(obj, 'status.conditions') || [];
        for (var i = 0; i < list.length; i++) {
            if (list[i] && list[i].type === type) return list[i];
        }
        return null;
    }

    function conditionIs(obj, type, status) {
        var c = conditionOf(obj, type);
        return !!c && c.status === status;
    }

    function time(ts) {
        var t = ts ? new Date(ts).getTime() : 0;
        return isFinite(t) ? t : 0;
    }

    var SUFFIX = {
        Ki: 1024,
        Mi: 1048576,
        Gi: 1073741824,
        Ti: 1099511627776,
        Pi: 1125899906842624,
        Ei: 1152921504606846976,
        n: 1e-9,
        u: 1e-6,
        m: 1e-3,
        '': 1,
        k: 1e3,
        M: 1e6,
        G: 1e9,
        T: 1e12,
        P: 1e15,
        E: 1e18,
    };

    // A Kubernetes quantity as a number: "8Gi" -> 8589934592, "1500m" -> 1.5.
    function quantity(q) {
        if (typeof q === 'number') return isFinite(q) ? q : 0;
        var m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*([a-zA-Z]{0,2})\s*$/.exec(String(q === undefined || q === null ? '' : q));
        if (!m) return 0;
        var mult = SUFFIX[m[2]];
        if (mult === undefined) return 0;
        return parseFloat(m[1]) * mult;
    }

    function bytes(n) {
        if (!n || n < 0) return '0 B';
        var units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
        var i = 0;
        while (n >= 1024 && i < units.length - 1) {
            n /= 1024;
            i++;
        }
        var v = n >= 100 || Math.abs(n - Math.round(n)) < 0.05 ? String(Math.round(n)) : n.toFixed(1);
        return v + ' ' + units[i];
    }

    function cores(n) {
        if (!n) return '0';
        if (n < 1) return Math.round(n * 1000) + 'm';
        return Math.abs(n - Math.round(n)) < 0.05 ? String(Math.round(n)) : n.toFixed(1);
    }

    function plural(n, one, many) {
        return n + ' ' + (n === 1 ? one : many || one + 's');
    }

    // ----- one machine -----------------------------------------------------------

    // The spec a machine is described by: the VirtualMachine's template, or a
    // lone instance's own spec.
    function specOf(vm, vmi) {
        return dig(vm, 'spec.template.spec') || dig(vmi, 'spec') || {};
    }

    function instancetypeOf(vm, lookups) {
        var ref = dig(vm, 'spec.instancetype');
        if (!ref || !ref.name) return null;
        var kind = ref.kind || 'VirtualMachineClusterInstancetype';
        var cluster = /cluster/i.test(kind);
        var found = null;
        if (lookups) {
            var list = cluster ? lookups.clusterInstancetypes : lookups.instancetypes;
            found =
                (list || []).find(function (it) {
                    return it.metadata.name === ref.name && (cluster || it.metadata.namespace === vm.metadata.namespace);
                }) || null;
        }
        return { name: ref.name, kind: kind, cluster: cluster, obj: found };
    }

    // How many vCPUs the guest has, from wherever KubeVirt lets it be said:
    // the topology a running guest reports, the domain's cpu block, an
    // instance type, or plain resource requests.
    function cpuOf(vm, vmi, itype) {
        var topo = dig(vmi, 'status.currentCPUTopology');
        var sources = [topo, dig(vmi, 'spec.domain.cpu'), dig(vm, 'spec.template.spec.domain.cpu')];
        for (var i = 0; i < sources.length; i++) {
            var c = sources[i];
            if (c && (c.cores || c.sockets || c.threads)) {
                var total = (c.cores || 1) * (c.sockets || 1) * (c.threads || 1);
                return { vcpus: total, topology: { cores: c.cores || 1, sockets: c.sockets || 1, threads: c.threads || 1 }, text: plural(total, 'vCPU') };
            }
        }
        var guest = itype && itype.obj ? dig(itype.obj, 'spec.cpu.guest') : 0;
        if (guest) return { vcpus: guest, topology: null, text: plural(guest, 'vCPU') };
        var req = dig(vmi, 'spec.domain.resources.requests.cpu') || dig(vm, 'spec.template.spec.domain.resources.requests.cpu');
        if (req) {
            var n = quantity(req);
            return { vcpus: n >= 1 ? Math.round(n) : 1, topology: null, text: cores(n) + ' CPU requested' };
        }
        // KubeVirt's own default for a guest that says nothing.
        return { vcpus: 1, topology: null, text: '1 vCPU' };
    }

    function memoryOf(vm, vmi, itype) {
        var candidates = [
            dig(vmi, 'status.memory.guestCurrent'),
            dig(vmi, 'spec.domain.memory.guest'),
            dig(vm, 'spec.template.spec.domain.memory.guest'),
            itype && itype.obj ? dig(itype.obj, 'spec.memory.guest') : '',
            dig(vmi, 'spec.domain.resources.requests.memory'),
            dig(vm, 'spec.template.spec.domain.resources.requests.memory'),
        ];
        for (var i = 0; i < candidates.length; i++) {
            if (candidates[i]) {
                var b = quantity(candidates[i]);
                return { bytes: b, text: bytes(b) };
            }
        }
        return { bytes: 0, text: '' };
    }

    // The guest's network interfaces: what the spec asks for joined with what
    // the running guest reports, which is the only place its addresses are.
    function interfacesOf(spec, vmi) {
        var byName = {};
        var order = [];
        function slot(name) {
            if (!byName[name]) {
                byName[name] = { name: name, binding: '', network: '', networkType: '', ips: [], mac: '', device: '', reported: false };
                order.push(name);
            }
            return byName[name];
        }
        (dig(spec, 'domain.devices.interfaces') || []).forEach(function (i) {
            var s = slot(i.name || '');
            s.binding = ['masquerade', 'bridge', 'sriov', 'passt', 'slirp', 'macvtap'].find(function (b) {
                return i[b] !== undefined;
            }) || (i.binding && i.binding.name) || '';
            if (i.macAddress) s.mac = i.macAddress;
        });
        (spec.networks || []).forEach(function (n) {
            var s = slot(n.name || '');
            if (n.pod) {
                s.networkType = 'pod';
                s.network = 'pod network';
            } else if (n.multus) {
                s.networkType = 'multus';
                s.network = n.multus.networkName || '';
            }
        });
        (dig(vmi, 'status.interfaces') || []).forEach(function (i) {
            var s = slot(i.name || i.interfaceName || 'interface ' + (order.length + 1));
            s.reported = true;
            var ips = (i.ipAddresses || []).filter(Boolean);
            if (!ips.length && i.ipAddress) ips = [i.ipAddress];
            s.ips = ips;
            if (i.mac) s.mac = i.mac;
            if (i.interfaceName) s.device = i.interfaceName;
        });
        return order.map(function (n) {
            return byName[n];
        });
    }

    // What backs one volume, with the object it names where there is one.
    function backingOf(volume, namespace) {
        if (!volume) return { type: '', name: '', ref: null };
        if (volume.dataVolume) return { type: 'DataVolume', name: volume.dataVolume.name, ref: { kind: KINDS.datavolumes, namespace: namespace, name: volume.dataVolume.name } };
        if (volume.persistentVolumeClaim) return { type: 'PVC', name: volume.persistentVolumeClaim.claimName, ref: { kind: KINDS.pvcs, namespace: namespace, name: volume.persistentVolumeClaim.claimName } };
        if (volume.containerDisk) return { type: 'container disk', name: volume.containerDisk.image || '', ref: null };
        if (volume.cloudInitNoCloud || volume.cloudInitConfigDrive) return { type: 'cloud-init', name: '', ref: null };
        if (volume.sysprep) return { type: 'sysprep', name: '', ref: null };
        // A Secret is only ever named, never read.
        if (volume.secret) return { type: 'Secret', name: volume.secret.secretName || '', ref: null };
        if (volume.configMap) return { type: 'ConfigMap', name: volume.configMap.name || '', ref: null };
        var keys = ['emptyDisk', 'ephemeral', 'hostDisk', 'downwardAPI', 'serviceAccount', 'memoryDump', 'downwardMetrics'];
        for (var i = 0; i < keys.length; i++) {
            if (volume[keys[i]]) return { type: keys[i], name: '', ref: null };
        }
        return { type: '', name: '', ref: null };
    }

    function disksOf(vm, vmi, spec, dvs) {
        var namespace = (vm || vmi).metadata.namespace || '';
        var volumes = {};
        (spec.volumes || []).forEach(function (v) {
            volumes[v.name] = v;
        });
        var status = {};
        (dig(vmi, 'status.volumeStatus') || []).forEach(function (s) {
            status[s.name] = s;
        });
        var templates = {};
        (dig(vm, 'spec.dataVolumeTemplates') || []).forEach(function (t) {
            if (t && t.metadata) templates[t.metadata.name] = t;
        });
        return (dig(spec, 'domain.devices.disks') || []).map(function (d) {
            var type = ['disk', 'cdrom', 'lun', 'floppy'].find(function (k) {
                return d[k] !== undefined;
            }) || 'disk';
            var bus = (d[type] && d[type].bus) || '';
            var backing = backingOf(volumes[d.name], namespace);
            var st = status[d.name] || {};
            var size = dig(st, 'persistentVolumeClaimInfo.capacity.storage') || '';
            var dv = null;
            if (backing.type === 'DataVolume') {
                var obj = (dvs || []).find(function (x) {
                    return x.metadata.name === backing.name && x.metadata.namespace === namespace;
                });
                var tpl = templates[backing.name];
                if (!size) size = dig(obj, 'spec.storage.resources.requests.storage') || dig(obj, 'spec.pvc.resources.requests.storage') || dig(tpl, 'spec.storage.resources.requests.storage') || dig(tpl, 'spec.pvc.resources.requests.storage') || '';
                if (obj) dv = { phase: dig(obj, 'status.phase') || '', progress: dig(obj, 'status.progress') || '' };
            }
            return {
                name: d.name,
                type: type,
                bus: bus,
                target: st.target || '',
                boot: d.bootOrder || 0,
                backing: backing,
                size: size ? quantity(size) : 0,
                dv: dv,
            };
        });
    }

    // Which OS a machine is: the guest agent's answer when there is one, else
    // what the machine was created as.
    function osOf(vm, vmi) {
        var info = dig(vmi, 'status.guestOSInfo') || {};
        var pretty = info.prettyName || [info.name, info.version].filter(Boolean).join(' ');
        var hints = [info.id, info.name, dig(vm, 'spec.preference.name'), annotationsOf(vm)['vm.kubevirt.io/os'], labelsOf(vm)['kubevirt.io/os']];
        Object.keys(labelsOf(vm)).forEach(function (k) {
            if (k.indexOf('os.template.kubevirt.io/') === 0) hints.push(k.slice(24));
        });
        var text = hints.filter(Boolean).join(' ').toLowerCase();
        var family = /win/.test(text) ? 'windows' : /(linux|fedora|ubuntu|debian|centos|rhel|alpine|cirros|suse|rocky|alma|arch|coreos|opensuse)/.test(text) ? 'linux' : '';
        return { pretty: pretty, family: family, agent: !!pretty };
    }

    // Why a machine that is not well is not well, in KubeVirt's own words.
    function reasonOf(vm, vmi, status) {
        var objs = [vm, vmi];
        var prefer = ['Failure', 'PodScheduled', 'Ready', 'Synchronized', 'DataVolumesReady'];
        for (var p = 0; p < prefer.length; p++) {
            for (var o = 0; o < objs.length; o++) {
                var c = conditionOf(objs[o], prefer[p]);
                if (!c) continue;
                var bad = prefer[p] === 'Failure' ? c.status === 'True' : c.status === 'False';
                if (bad && (c.message || c.reason)) return c.message || c.reason;
            }
        }
        var sf = dig(vm, 'status.startFailure');
        if (sf && sf.consecutiveFailCount) return 'Failed to start ' + plural(sf.consecutiveFailCount, 'time') + ' in a row.';
        return STATUS_EXPLAINED[status] || '';
    }

    // When the machine last changed what it was doing, as near as the objects
    // say: the instance's last phase change, or its Ready condition.
    function sinceOf(vm, vmi) {
        var t = 0;
        (dig(vmi, 'status.phaseTransitionTimestamps') || []).forEach(function (p) {
            t = Math.max(t, time(p.phaseTransitionTimestamp));
        });
        if (!t) {
            var ready = conditionOf(vm, 'Ready');
            if (ready) t = time(ready.lastTransitionTime);
        }
        if (!t && vmi) t = time(vmi.metadata.creationTimestamp);
        return t;
    }

    function runningSince(vmi) {
        var t = 0;
        (dig(vmi, 'status.phaseTransitionTimestamps') || []).forEach(function (p) {
            if (p.phase === 'Running') t = Math.max(t, time(p.phaseTransitionTimestamp));
        });
        return t || (vmi ? time(vmi.metadata.creationTimestamp) : 0);
    }

    // The virt-launcher pod running a guest: KubeVirt labels it with the
    // instance's uid, and a guest that is migrating has two for a moment --
    // the one on the node the instance says it is on is the one running it.
    function launcherOf(vmi, pods) {
        if (!vmi) return null;
        var uid = vmi.metadata.uid;
        var name = vmi.metadata.name;
        var mine = (pods || []).filter(function (p) {
            if (p.metadata.namespace !== vmi.metadata.namespace) return false;
            var l = labelsOf(p);
            return (uid && l['kubevirt.io/created-by'] === uid) || l['vm.kubevirt.io/name'] === name || l['kubevirt.io/domain'] === name;
        });
        var node = dig(vmi, 'status.nodeName');
        return (
            mine.find(function (p) {
                return dig(p, 'spec.nodeName') === node && dig(p, 'status.phase') === 'Running';
            }) ||
            mine.find(function (p) {
                return dig(p, 'status.phase') === 'Running';
            }) ||
            mine[0] ||
            null
        );
    }

    // What a pod asks the scheduler for, summed over its containers.
    function requestsOf(pod) {
        var out = { cpu: 0, memory: 0 };
        (dig(pod, 'spec.containers') || []).forEach(function (c) {
            var r = (c.resources && c.resources.requests) || {};
            out.cpu += quantity(r.cpu);
            out.memory += quantity(r.memory);
        });
        return out;
    }

    function buildMigration(m, vmisByKey) {
        var st = dig(m, 'status.migrationState') || null;
        var vmi = vmisByKey[m.metadata.namespace + '/' + dig(m, 'spec.vmiName')];
        // Older KubeVirt keeps the nodes only on the instance, and only for
        // the latest migration.
        if (!st && vmi) {
            var vs = dig(vmi, 'status.migrationState');
            if (vs && vs.migrationUid === m.metadata.uid) st = vs;
        }
        st = st || {};
        var phase = dig(m, 'status.phase') || 'Pending';
        var done = phase === 'Succeeded' || phase === 'Failed';
        var ended = time(st.endTimestamp);
        (dig(m, 'status.phaseTransitionTimestamps') || []).forEach(function (p) {
            if ((p.phase === 'Succeeded' || p.phase === 'Failed') && !ended) ended = time(p.phaseTransitionTimestamp);
        });
        return {
            key: m.metadata.namespace + '/' + m.metadata.name,
            name: m.metadata.name,
            namespace: m.metadata.namespace,
            vmi: dig(m, 'spec.vmiName') || '',
            phase: phase,
            inFlight: !done,
            failed: phase === 'Failed' || st.failed === true,
            source: st.sourceNode || '',
            target: st.targetNode || '',
            mode: st.mode || '',
            created: time(m.metadata.creationTimestamp),
            started: time(st.startTimestamp) || time(m.metadata.creationTimestamp),
            ended: done ? ended || time(m.metadata.creationTimestamp) : 0,
            reason: (dig(st, 'failureReason') || dig(m, 'status.migrationState.failureReason') || (conditionOf(m, 'Failed') || {}).message || '').trim(),
            obj: m,
        };
    }

    function buildMachine(vm, vmi, ctx) {
        ctx = ctx || {};
        var obj = vm || vmi;
        var standalone = !vm;
        var namespace = obj.metadata.namespace || '';
        var name = obj.metadata.name;
        var spec = specOf(vm, vmi);
        var itype = vm ? instancetypeOf(vm, ctx.lookups) : null;
        var status = vm ? dig(vm, 'status.printableStatus') || '' : PHASE_STATUS[dig(vmi, 'status.phase')] || dig(vmi, 'status.phase') || '';
        if (standalone && conditionIs(vmi, 'Paused', 'True')) status = 'Paused';
        if (standalone && dig(vmi, 'status.migrationState') && !dig(vmi, 'status.migrationState.completed') && status === 'Running') status = 'Migrating';
        var s = STATUS[status] || (status ? { tone: 'warn', group: 'failing' } : { tone: 'muted', group: 'stopped' });
        if (status === 'Failed') s = { tone: 'error', group: 'failing' };

        var since = sinceOf(vm, vmi);
        var transitional = s.group === 'changing';
        var stuck = transitional && since > 0 && Date.now() - since > STUCK_AFTER;

        var migrations = (ctx.migrations || [])
            .filter(function (m) {
                return m.namespace === namespace && m.vmi === name;
            })
            .sort(function (a, b) {
                return b.created - a.created;
            });
        var ms = dig(vmi, 'status.migrationState');
        var moving = migrations.find(function (m) {
            return m.inFlight;
        });
        if (!moving && ms && !ms.completed && ms.startTimestamp) {
            moving = { name: '', phase: 'Running', inFlight: true, source: ms.sourceNode || '', target: ms.targetNode || '', started: time(ms.startTimestamp) };
        }

        var migratable = conditionOf(vmi, 'LiveMigratable') || conditionOf(vm, 'LiveMigratable');
        var launcher = launcherOf(vmi, ctx.pods);
        var runStrategy = dig(vm, 'spec.runStrategy') || (dig(vm, 'spec.running') === true ? 'Always' : dig(vm, 'spec.running') === false ? 'Halted' : '');
        var conditions = [];
        var seen = {};
        [vm, vmi].forEach(function (o) {
            (dig(o, 'status.conditions') || []).forEach(function (c) {
                if (seen[c.type]) return;
                seen[c.type] = true;
                conditions.push(c);
            });
        });
        var interfaces = interfacesOf(spec, vmi);
        var ips = [];
        interfaces.forEach(function (i) {
            i.ips.forEach(function (ip) {
                if (ips.indexOf(ip) < 0) ips.push(ip);
            });
        });
        var running = !!vmi && dig(vmi, 'status.phase') === 'Running';

        return {
            key: namespace + '/' + name,
            name: name,
            namespace: namespace,
            kind: standalone ? KINDS.vmis : KINDS.vms,
            standalone: standalone,
            obj: obj,
            vm: vm,
            vmi: vmi || null,
            status: status || 'Unknown',
            tone: stuck ? 'warn' : s.tone,
            group: s.group,
            stuck: stuck,
            since: since,
            running: running,
            paused: status === 'Paused',
            runStrategy: runStrategy,
            instancetype: itype,
            preference: dig(vm, 'spec.preference.name') || '',
            cpu: cpuOf(vm, vmi, itype),
            memory: memoryOf(vm, vmi, itype),
            os: osOf(vm, vmi),
            node: dig(vmi, 'status.nodeName') || '',
            launcher: launcher,
            qos: dig(vmi, 'status.qosClass') || '',
            uptimeSince: running ? runningSince(vmi) : 0,
            interfaces: interfaces,
            ips: ips,
            disks: disksOf(vm, vmi, spec, ctx.dvs),
            migratable: migratable ? migratable.status : '',
            migratableWhy: migratable && migratable.status === 'False' ? migratable.message || migratable.reason || '' : '',
            agent: conditionIs(vmi, 'AgentConnected', 'True'),
            ready: vm ? conditionIs(vm, 'Ready', 'True') : conditionIs(vmi, 'Ready', 'True'),
            restartRequired: conditionIs(vm, 'RestartRequired', 'True'),
            evacuating: dig(vmi, 'status.evacuationNodeName') || '',
            conditions: conditions,
            reason: s.group === 'failing' || stuck || s.group === 'changing' ? reasonOf(vm, vmi, status) : '',
            migrations: migrations,
            moving: moving || null,
            created: time(obj.metadata.creationTimestamp),
            labels: labelsOf(obj),
        };
    }

    function worstFirst(a, b) {
        var ra = GROUP_RANK[a.group] - (a.stuck ? 0.5 : 0);
        var rb = GROUP_RANK[b.group] - (b.stuck ? 0.5 : 0);
        return ra - rb || a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name);
    }

    // ----- nodes -----------------------------------------------------------------

    function nodeFacts(node) {
        var l = labelsOf(node);
        var alloc = dig(node, 'status.allocatable') || {};
        var ready = conditionOf(node, 'Ready');
        return {
            name: node.metadata.name,
            obj: node,
            ready: !ready || ready.status === 'True',
            cordoned: !!dig(node, 'spec.unschedulable'),
            schedulable: l['kubevirt.io/schedulable'] === 'true',
            kvm: quantity(alloc['devices.kubevirt.io/kvm']) > 0,
            cpu: quantity(alloc.cpu),
            memory: quantity(alloc.memory),
        };
    }

    // The nodes that carry guests, or could: which machines are on each, and
    // how much of it their launcher pods have asked for.
    function buildNodes(nodes, machines, launchers) {
        var by = {};
        var order = [];
        function slot(name) {
            if (!by[name]) {
                by[name] = { name: name, obj: null, known: false, ready: true, cordoned: false, schedulable: false, kvm: false, cpu: 0, memory: 0, guests: [], requested: { cpu: 0, memory: 0 }, vcpus: 0, guestMemory: 0 };
                order.push(name);
            }
            return by[name];
        }
        (nodes || []).forEach(function (n) {
            var f = nodeFacts(n);
            if (!f.schedulable) return;
            Object.assign(slot(f.name), f, { known: true });
        });
        machines.forEach(function (m) {
            if (!m.node || !m.vmi) return;
            var s = slot(m.node);
            s.guests.push(m);
            s.vcpus += m.cpu.vcpus;
            s.guestMemory += m.memory.bytes;
        });
        // A node hosting a guest without the schedulable label is still worth
        // its facts: it is where the guest is.
        (nodes || []).forEach(function (n) {
            var s = by[n.metadata.name];
            if (s && !s.known) Object.assign(s, nodeFacts(n), { known: true });
        });
        (launchers || []).forEach(function (p) {
            var node = dig(p, 'spec.nodeName');
            var phase = dig(p, 'status.phase');
            if (!node || !by[node] || phase === 'Succeeded' || phase === 'Failed') return;
            var r = requestsOf(p);
            by[node].requested.cpu += r.cpu;
            by[node].requested.memory += r.memory;
        });
        return order
            .map(function (n) {
                var s = by[n];
                s.guests.sort(worstFirst);
                s.cpuFraction = s.cpu ? s.requested.cpu / s.cpu : 0;
                s.memoryFraction = s.memory ? s.requested.memory / s.memory : 0;
                return s;
            })
            .sort(function (a, b) {
                return b.guests.length - a.guests.length || a.name.localeCompare(b.name);
            });
    }

    // ----- KubeVirt itself -------------------------------------------------------

    function components(pods, order, strip) {
        var by = {};
        pods.forEach(function (pod) {
            var l = labelsOf(pod);
            var name = l[strip] || pod.metadata.name;
            var c = (by[name] = by[name] || { name: name, ready: 0, total: 0, restarts: 0, pods: [], nodes: [] });
            c.total++;
            var ok = dig(pod, 'status.phase') === 'Running' && conditionIs(pod, 'Ready', 'True');
            if (ok) c.ready++;
            else if (dig(pod, 'spec.nodeName')) c.nodes.push(dig(pod, 'spec.nodeName'));
            (dig(pod, 'status.containerStatuses') || []).forEach(function (cs) {
                c.restarts += cs.restartCount || 0;
            });
            c.pods.push(pod);
        });
        return Object.keys(by)
            .map(function (k) {
                var c = by[k];
                c.tone = c.ready === c.total ? 'ok' : c.ready === 0 ? 'error' : 'warn';
                return c;
            })
            .sort(function (a, b) {
                var ia = order.indexOf(a.name);
                var ib = order.indexOf(b.name);
                return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.name.localeCompare(b.name);
            });
    }

    // "quay.io/kubevirt/virt-api:v1.3.1" -> "v1.3.1".
    function versionOf(pods) {
        for (var i = 0; i < pods.length; i++) {
            var cs = dig(pods[i], 'spec.containers') || [];
            for (var j = 0; j < cs.length; j++) {
                var image = cs[j].image || '';
                var at = image.lastIndexOf(':');
                if (/virt-/.test(image) && at > image.lastIndexOf('/')) return image.slice(at + 1).replace(/@.*$/, '');
            }
        }
        return '';
    }

    function buildSystem(crs, crsOk, pods, podsOk, cdiPods) {
        var cr = crs[0] || null;
        var comps = components(pods, COMPONENTS, 'kubevirt.io');
        var cdi = components(cdiPods, CDI_COMPONENTS, 'cdi.kubevirt.io');
        var problems = [];
        if (cr) {
            var phase = dig(cr, 'status.phase') || '';
            if (conditionIs(cr, 'Degraded', 'True')) problems.push({ tone: 'error', text: 'KubeVirt reports itself degraded' + ((conditionOf(cr, 'Degraded') || {}).message ? ': ' + conditionOf(cr, 'Degraded').message : '.') });
            else if (conditionIs(cr, 'Available', 'False')) problems.push({ tone: 'error', text: 'KubeVirt reports itself unavailable' + ((conditionOf(cr, 'Available') || {}).message ? ': ' + conditionOf(cr, 'Available').message : '.') });
            else if (phase && phase !== 'Deployed') problems.push({ tone: 'warn', text: 'KubeVirt is ' + phase.toLowerCase() + (conditionIs(cr, 'Progressing', 'True') ? ' — an install or upgrade is under way.' : '.') });
        }
        comps.forEach(function (c) {
            if (c.ready === c.total) return;
            var down = c.total - c.ready;
            var where = c.name === 'virt-handler' && c.nodes.length ? ' on ' + c.nodes.join(', ') + ' — no guest can run there until it is' : '';
            problems.push({ tone: c.ready === 0 ? 'error' : 'warn', text: c.name + ': ' + down + ' of ' + c.total + ' not ready' + where + '.' });
        });
        var known = !!cr || comps.length > 0;
        var tone = !known ? 'muted' : problems.some(function (p) {
            return p.tone === 'error';
        })
            ? 'error'
            : problems.length
            ? 'warn'
            : 'ok';
        return {
            known: known,
            readable: crsOk || podsOk,
            cr: cr,
            phase: cr ? dig(cr, 'status.phase') || '' : '',
            version: (cr && (dig(cr, 'status.observedKubeVirtVersion') || dig(cr, 'status.targetKubeVirtVersion'))) || versionOf(pods),
            namespace: cr ? cr.metadata.namespace : pods[0] ? pods[0].metadata.namespace : '',
            components: comps,
            cdi: cdi,
            problems: problems,
            tone: tone,
            healthy: known && tone === 'ok',
        };
    }

    // ----- what needs a person ---------------------------------------------------

    // Everything wanting attention, worst first, with what it is about and the
    // action that fixes it, when there is one.
    function attention(machines, nodes, migrations) {
        var out = [];
        var nodeBy = {};
        nodes.forEach(function (n) {
            nodeBy[n.name] = n;
        });
        machines.forEach(function (m) {
            if (m.group === 'failing') {
                out.push({ tone: m.tone === 'warn' ? 'warn' : 'error', machine: m, what: STATUS_WORDS[m.status] || m.status, text: m.reason || STATUS_EXPLAINED[m.status] || '', fix: offer(m, 'stop') ? 'stop' : null });
                return;
            }
            if (m.stuck) {
                var starting = /Starting|Provisioning|WaitingFor/.test(m.status);
                out.push({
                    tone: 'warn',
                    machine: m,
                    what: starting ? 'Stuck starting' : 'Stuck stopping',
                    text: (STATUS_WORDS[m.status] || m.status) + ' for ' + since(m.since) + '.' + (m.reason ? ' ' + m.reason.replace(/\.?$/, '.') : ''),
                    fix: offer(m, 'stop') ? 'stop' : null,
                });
                return;
            }
            if (m.paused) {
                out.push({ tone: 'warn', machine: m, what: 'Paused', text: 'Paused ' + since(m.since) + ' ago. Its memory is still held on ' + (m.node || 'its node') + ', but nothing inside it is running.', fix: offer(m, 'unpause') ? 'unpause' : null });
                return;
            }
            var node = m.node ? nodeBy[m.node] : null;
            if (m.running && node && node.cordoned && !m.moving) {
                if (m.migratable !== 'False') {
                    out.push({ tone: 'warn', machine: m, what: 'On a cordoned node', text: m.node + ' is cordoned. Move the guest off it before the node is drained.', fix: offer(m, 'migrate') ? 'migrate' : null });
                } else {
                    out.push({ tone: 'error', machine: m, what: 'Cannot leave its node', text: m.node + ' is cordoned and this guest cannot be live-migrated' + (m.migratableWhy ? ': ' + m.migratableWhy : '.') + ' Draining the node will stop it.', fix: null });
                }
                return;
            }
            if (m.restartRequired) {
                out.push({ tone: 'warn', machine: m, what: 'Waiting for a restart', text: 'Its spec has changed in a way that only takes effect when the guest restarts.', fix: offer(m, 'restart') ? 'restart' : null });
                return;
            }
            if (m.running && !m.ready && !m.moving) {
                out.push({ tone: 'warn', machine: m, what: 'Not ready', text: reasonOf(m.vm, m.vmi, m.status) || 'The guest is running but KubeVirt does not report it ready.', fix: offer(m, 'restart') ? 'restart' : null });
                return;
            }
            var last = m.migrations[0];
            if (last && last.failed && Date.now() - (last.ended || last.created) < MIGRATION_MEMORY) {
                out.push({ tone: 'warn', machine: m, what: 'Migration failed', text: (last.target ? 'Moving to ' + last.target + ' failed ' : 'A live migration failed ') + since(last.ended || last.created) + ' ago' + (last.reason ? ': ' + last.reason : '.'), fix: offer(m, 'migrate') ? 'migrate' : null });
            }
        });
        var rank = { error: 0, warn: 1 };
        return out.sort(function (a, b) {
            return rank[a.tone] - rank[b.tone] || worstFirst(a.machine, b.machine);
        });
    }

    function since(t) {
        if (!t) return 'a while';
        var s = Math.max(0, (Date.now() - t) / 1000);
        if (s < 90) return Math.round(s) + 's';
        if (s < 5400) return Math.round(s / 60) + ' min';
        if (s < 172800) return plural(Math.round(s / 3600), 'hour');
        return plural(Math.round(s / 86400), 'day');
    }

    // ----- reading it all --------------------------------------------------------

    function soft(promise) {
        return Promise.resolve(promise).then(
            function (items) {
                return { ok: true, items: items || [], error: '' };
            },
            function (err) {
                return { ok: false, items: [], error: (err && err.message) || String(err) };
            },
        );
    }

    function version(list) {
        return list
            .map(function (o) {
                return (o.metadata.uid || o.metadata.name) + '@' + (o.metadata.resourceVersion || '');
            })
            .join(',');
    }

    function tally(list, field) {
        var out = {};
        list.forEach(function (x) {
            out[x[field]] = (out[x[field]] || 0) + 1;
        });
        return out;
    }

    // Joins what the lists say into the model. Pure: `got` is one soft answer
    // per list, in the order `load` asks for them.
    function assemble(got) {
        var vms = got.vms.items;
        var vmis = got.vmis.items;
        var vmisByKey = {};
        vmis.forEach(function (i) {
            vmisByKey[i.metadata.namespace + '/' + i.metadata.name] = i;
        });
        var migrations = got.migrations.items
            .map(function (m) {
                return buildMigration(m, vmisByKey);
            })
            .sort(function (a, b) {
                if (a.inFlight !== b.inFlight) return a.inFlight ? -1 : 1;
                return (b.ended || b.created) - (a.ended || a.created);
            });
        var ctx = {
            pods: got.launchers.items,
            migrations: migrations,
            dvs: got.datavolumes.items,
            lookups: { instancetypes: got.instancetypes.items, clusterInstancetypes: got.clusterinstancetypes.items },
        };
        var owned = {};
        var machines = vms.map(function (vm) {
            var key = vm.metadata.namespace + '/' + vm.metadata.name;
            owned[key] = true;
            return buildMachine(vm, vmisByKey[key] || null, ctx);
        });
        vmis.forEach(function (vmi) {
            var key = vmi.metadata.namespace + '/' + vmi.metadata.name;
            if (!owned[key]) machines.push(buildMachine(null, vmi, ctx));
        });
        machines.sort(worstFirst);

        var nodes = buildNodes(got.nodes.items, machines, got.launchers.items);
        var system = buildSystem(got.kubevirts.items, got.kubevirts.ok, got.components.items, got.components.ok, got.cdi.items);

        var groups = {};
        GROUPS.forEach(function (g) {
            groups[g.id] = 0;
        });
        machines.forEach(function (m) {
            groups[m.group] = (groups[m.group] || 0) + 1;
        });

        var running = machines.filter(function (m) {
            return m.running;
        });
        var namespaces = {};
        machines.forEach(function (m) {
            namespaces[m.namespace] = true;
        });

        return {
            installed: got.vms.ok || got.vmis.ok,
            missing: got.vms.error,
            machines: machines,
            nodes: nodes,
            nodesKnown: got.nodes.ok,
            migrations: migrations,
            migrationsKnown: got.migrations.ok,
            inFlight: migrations.filter(function (m) {
                return m.inFlight;
            }),
            system: system,
            attention: attention(machines, nodes, migrations),
            groups: groups,
            statuses: tally(machines, 'status'),
            namespaces: Object.keys(namespaces).sort(),
            totals: {
                machines: machines.length,
                running: running.length,
                vcpus: running.reduce(function (s, m) {
                    return s + m.cpu.vcpus;
                }, 0),
                memory: running.reduce(function (s, m) {
                    return s + m.memory.bytes;
                }, 0),
                hosts: nodes.filter(function (n) {
                    return n.guests.length > 0;
                }).length,
                disks: machines.reduce(function (s, m) {
                    return s + m.disks.length;
                }, 0),
            },
            sig: ['vms', 'vmis', 'migrations', 'kubevirts', 'launchers', 'components', 'nodes', 'datavolumes', 'cdi'].map(function (k) {
                return version(got[k].items) + (got[k].ok ? '' : '!');
            }).join('|'),
        };
    }

    var LISTS = [
        ['vms', KINDS.vms, ''],
        ['vmis', KINDS.vmis, ''],
        ['migrations', KINDS.migrations, ''],
        ['kubevirts', KINDS.kubevirts, ''],
        ['launchers', KINDS.pods, LAUNCHER_SELECTOR],
        ['components', KINDS.pods, COMPONENT_SELECTOR],
        ['nodes', KINDS.nodes, ''],
        ['datavolumes', KINDS.datavolumes, ''],
        ['instancetypes', KINDS.instancetypes, ''],
        ['clusterinstancetypes', KINDS.clusterinstancetypes, ''],
        ['cdi', KINDS.pods, CDI_SELECTOR],
    ];

    function load(sdk) {
        return Promise.all(
            LISTS.map(function (l) {
                return soft(sdk.list({ kind: l[1], namespace: '', selector: l[2] }));
            }),
        ).then(function (answers) {
            var got = {};
            LISTS.forEach(function (l, i) {
                got[l[0]] = answers[i];
            });
            return assemble(got);
        });
    }

    // One machine on its own, for the panel in a VirtualMachine's detail view.
    function loadOne(sdk, vm) {
        var ns = vm.metadata.namespace;
        var name = vm.metadata.name;
        return Promise.all([
            soft(sdk.get({ kind: KINDS.vmis, namespace: ns, name: name }).then(function (o) {
                return [o];
            })),
            soft(sdk.list({ kind: KINDS.pods, namespace: ns, selector: LAUNCHER_SELECTOR })),
            soft(sdk.list({ kind: KINDS.migrations, namespace: ns })),
            soft(sdk.list({ kind: KINDS.datavolumes, namespace: ns })),
        ]).then(function (got) {
            var vmi = got[0].items[0] || null;
            var byKey = {};
            if (vmi) byKey[ns + '/' + name] = vmi;
            var migrations = got[2].items
                .map(function (m) {
                    return buildMigration(m, byKey);
                })
                .filter(function (m) {
                    return m.vmi === name;
                });
            return buildMachine(vm, vmi, { pods: got[1].items, migrations: migrations, dvs: got[3].items });
        });
    }

    // ----- events ----------------------------------------------------------------

    var EVENT_KINDS = ['VirtualMachine', 'VirtualMachineInstance', 'VirtualMachineInstanceMigration', 'DataVolume', 'KubeVirt', 'VirtualMachinePool', 'VirtualMachineSnapshot', 'VirtualMachineRestore', 'VirtualMachineClone', 'VirtualMachineExport'];

    function isKubeVirtEvent(ev) {
        var target = ev.involvedObject || ev.regarding || {};
        if (EVENT_KINDS.indexOf(target.kind) >= 0) return true;
        var component = (ev.source && ev.source.component) || ev.reportingController || ev.reportingComponent || '';
        return /^virt-|kubevirt|^cdi/i.test(component) && target.kind !== 'Pod';
    }

    function eventOf(ev) {
        var target = ev.involvedObject || ev.regarding || {};
        return {
            uid: ev.metadata.uid,
            when: time(ev.lastTimestamp || ev.eventTime || (ev.series && ev.series.lastObservedTime) || ev.metadata.creationTimestamp),
            type: ev.type || 'Normal',
            reason: ev.reason || '',
            message: ev.message || ev.note || '',
            count: ev.count || (ev.series && ev.series.count) || 1,
            kind: target.kind || '',
            namespace: target.namespace || ev.metadata.namespace || '',
            name: target.name || '',
            component: (ev.source && ev.source.component) || ev.reportingController || '',
        };
    }

    function sortEvents(list, limit) {
        return list
            .sort(function (a, b) {
                return b.when - a.when;
            })
            .slice(0, limit);
    }

    // KubeVirt's recent events, from the namespaces its machines are in and
    // its own. Events are namespaced, so they are asked for one namespace at a
    // time rather than for the whole cluster.
    function loadEvents(sdk, model, limit) {
        var namespaces = model.namespaces.slice(0, 24);
        if (model.system.namespace && namespaces.indexOf(model.system.namespace) < 0) namespaces.push(model.system.namespace);
        return Promise.all(
            namespaces.map(function (ns) {
                return soft(sdk.list({ kind: KINDS.events, namespace: ns }));
            }),
        ).then(function (answers) {
            var out = [];
            answers.forEach(function (a) {
                a.items.forEach(function (ev) {
                    if (isKubeVirtEvent(ev)) out.push(eventOf(ev));
                });
            });
            return sortEvents(out, limit || 14);
        });
    }

    // The events about one machine: its VM, its instance, its migrations and
    // its disks.
    function loadMachineEvents(sdk, machine, limit) {
        var names = {};
        names[machine.name] = true;
        machine.migrations.forEach(function (m) {
            names[m.name] = true;
        });
        machine.disks.forEach(function (d) {
            if (d.backing.type === 'DataVolume') names[d.backing.name] = true;
        });
        return soft(sdk.list({ kind: KINDS.events, namespace: machine.namespace })).then(function (a) {
            return sortEvents(
                a.items
                    .filter(function (ev) {
                        var t = ev.involvedObject || ev.regarding || {};
                        return names[t.name] && EVENT_KINDS.indexOf(t.kind) >= 0;
                    })
                    .map(eventOf),
                limit || 8,
            );
        });
    }

    // What an event says, in fewer words where KubeVirt's own are long.
    function eventText(ev) {
        var m = ev.message;
        if (ev.reason === 'SuccessfulCreate' && /virtual machine instance|VirtualMachineInstance/i.test(m)) return 'started its guest';
        if (ev.reason === 'SuccessfulDelete' && /virtual machine instance|VirtualMachineInstance/i.test(m)) return 'stopped its guest';
        if (ev.reason === 'Started' && /VirtualMachineInstance started/i.test(m)) return 'is running';
        if (ev.reason === 'Migrated') return 'moved' + (/to node (\S+)/.exec(m) ? ' to ' + /to node (\S+)/.exec(m)[1].replace(/[.,]$/, '') : '');
        if (ev.reason === 'Paused') return 'was paused';
        if (ev.reason === 'Resumed' || ev.reason === 'Unpaused') return 'was resumed';
        return m;
    }

    window.KubeVirt = {
        KINDS: KINDS,
        STATUS: STATUS,
        GROUPS: GROUPS,
        STATUS_WORDS: STATUS_WORDS,
        ACTIONS: ACTIONS,
        load: load,
        loadOne: loadOne,
        assemble: assemble,
        buildMachine: buildMachine,
        buildMigration: buildMigration,
        buildNodes: buildNodes,
        buildSystem: buildSystem,
        attention: attention,
        loadEvents: loadEvents,
        loadMachineEvents: loadMachineEvents,
        eventText: eventText,
        isKubeVirtEvent: isKubeVirtEvent,
        fieldValue: fieldValue,
        offers: offers,
        offered: offered,
        offer: offer,
        actionById: actionById,
        worstFirst: worstFirst,
        quantity: quantity,
        bytes: bytes,
        cores: cores,
        plural: plural,
        since: since,
        dig: dig,
        time: time,
        conditionOf: conditionOf,
    };
})();
