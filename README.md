# KubeVirt for K8s Dockside

A plugin for the [K8s Dockside](https://github.com/rogerwesterbo/k8sdockside)
desktop app that shows [KubeVirt](https://kubevirt.io/) as what it runs:
virtual machines.

It answers the questions you have about a fleet of VMs on Kubernetes: which
machines are running, stopped or failing and why, whether KubeVirt itself is
healthy, which nodes carry the guests and how full they are, what is migrating
right now, and — for any one machine — its CPU, memory, disks, networks and
addresses, where it runs, and the buttons to start, stop, pause, migrate or
reboot it. In plain words, not as rows of custom resources.

Plain HTML and script, no build step: the repository is the plugin.

## Requirements

- **K8s Dockside 0.0.15 or newer.**
- **KubeVirt** in the cluster (the `kubevirt.io` VirtualMachine and
  VirtualMachineInstance kinds). CDI, Multus, instance types, snapshots, clones
  and exports are used where the cluster has them.
- **Prometheus** is optional, for the charts. Without one everything else works
  and the overview says so.

## What it shows

**Overview**, which replaces the app's generated overview page:

- A verdict ("All 16 machines are running", "3 machines are failing",
  "KubeVirt itself is not healthy") and a sentence with the numbers: how many
  machines are running, on how many nodes, with how many vCPUs and how much
  guest memory, and how many are failing, starting or stopping, migrating,
  paused and stopped.
- **Every machine at once** as a honeycomb, one cell each, worst first:
  filled by its state, hollow when stopped, a moving rim while it migrates.
  Hover a cell for the machine, click it to open it.
- **Needs you**: the machines that want a person, each with why and the one
  button that fixes it — Stop for one that keeps crashing, cannot be placed or
  whose disk failed to import, Resume for a paused one, Restart for one whose
  changes wait for a restart, Migrate after a failed migration or for a guest
  on a cordoned node. A guest on a cordoned node that *cannot* be live-migrated
  is called out too, since draining that node will stop it.
- **Where they run**: every node that carries guests or could, its guests as
  cells, and how much CPU and memory their virt-launcher pods have asked of it.
  Cordoned nodes and nodes without KVM are marked.
- **Live migrations** in flight, drawn from source node to target, and those of
  the last day with how they ended.
- **KubeVirt itself**: the KubeVirt resource's phase and version, and
  virt-operator, virt-api, virt-controller and virt-handler (and CDI's own
  components) with a dot per pod. A virt-handler that is not ready is named
  with its node.
- KubeVirt's **recent events**, and its **charts** over the last six hours.
- Links to kubevirt.io, the user guide and GitHub.
- When the cluster has no KubeVirt, or cannot be reached, it says which, and
  which of the kinds it looked for are served.

**Machines** is the working page:

- Every virtual machine as a tile — its state, namespace and node, vCPUs,
  memory and address — grouped by state, namespace or node.
- A rail to filter by state, namespace or node, and a search box that finds a
  machine by name, namespace, node, IP address, OS or instance type.
- Click a machine for a drawer with everything about it: its lifecycle buttons,
  why it is not well when it is not, vCPUs and topology, guest memory, disks and
  their total size, the guest OS, its node and virt-launcher pod (with a link to
  the pod's logs), its network interfaces with their addresses and MACs, its
  disks and what backs each (DataVolume, PVC, container disk, cloud-init), its
  conditions, its migrations and its recent events.
- Lone VirtualMachineInstances, with no VirtualMachine of their own, are on the
  board too.

**Machine** panel in every VirtualMachine's detail view: its state and for how
long, the button group of what can be done to it now, where it runs and its
addresses, the migration in flight, its conditions and recent migrations.

**Tables** for VirtualMachines, VirtualMachineInstances, VM pools, migrations,
DataVolumes, DataSources, DataImportCrons, StorageProfiles, networks
(Multus), instance types and preferences (namespaced and cluster),
snapshots, restores, clones, exports, the KubeVirt and CDI settings, and
KubeVirt's own workloads.

**Charts**, from the cluster's Prometheus: guests by phase and by node,
migrations in flight, guest CPU, memory, disk and network across the cluster,
and nodes able to run VMs, on the overview; and CPU, vCPU wait, memory, disk
throughput, IOPS and network on every VirtualMachine and
VirtualMachineInstance, and memory left to copy on a migration.

## The buttons

These are on the action bar of every VirtualMachine, on the drawer in
**Machines**, and in the **Machine** panel. Each is offered only in the states
it makes sense in, and the app asks before any of them runs.

| Button | Offered when the VM is | What it does |
| --- | --- | --- |
| Start | Stopped | `start` on `subresources.kubevirt.io` |
| Pause | Running | `pause` on its instance |
| Resume | Paused | `unpause` on its instance |
| Restart | Running or Paused | `restart` — the guest is powered off and started again |
| Reboot | Running | `softreboot` on its instance — the guest restarts itself; needs the guest agent |
| Migrate | Running, unless KubeVirt says it is not live-migratable | creates a VirtualMachineInstanceMigration |
| Stop | anything but Stopped, Stopping or Terminating | `stop` — the guest is powered off |

VirtualMachineInstances get the same buttons, minus Start: Pause, Resume and
Reboot act on the instance; Migrate creates a migration for it; Restart and
Stop act on the VirtualMachine of the same name.

**While this plugin is switched on, its buttons replace the app's own built-in
VM buttons** on VirtualMachines and VirtualMachineInstances, rather than the
bar carrying two of each. Switch the plugin off in **Settings → Plugins** and
the app's own come back. The app's own detail view for a VM, with its console,
stays either way.

Start and Stop go through KubeVirt's subresource API, as `virtctl` does, so a
machine keeps its run strategy. That needs the `subresources.kubevirt.io`
permissions, which KubeVirt's `kubevirt.io:edit` role includes.

## Installing

In K8s Dockside, **Settings → Plugins**. KubeVirt is in the list of known
plugins with an **Install** button, and the sidebar suggests it for any cluster
that runs KubeVirt. You can also use **From a repository** with this address:

```
https://github.com/rogerwesterbo/k8sdockside-kubevirt.git
```

The app clones it into its plugins folder, and the plugin's card gets an
**Update from repository** button. Its id is `kubevirt`, the same as the
KubeVirt support older versions of the app had built in, so tabs you had open
on those views come back as they were.

To work on it, clone it anywhere and add the folder that *contains* it with
**Settings → Plugins → Watch another folder**. Press **Reload** after changing
`plugin.json`; files under `ui/` are read fresh whenever a view is opened.

## What it reads, and what it may change

The pages read, through the app's bridge and only in the cluster of the tab they
are in:

- KubeVirt's own kinds: VirtualMachines, VirtualMachineInstances, migrations,
  the KubeVirt resource, instance types, and the rest of the kinds the tables
  list (`kubevirt.io`, `cdi.kubevirt.io`, `instancetype.kubevirt.io`,
  `pool.kubevirt.io`, `snapshot.kubevirt.io`, `clone.kubevirt.io`,
  `export.kubevirt.io`, `k8s.cni.cncf.io`)
- Pods — the virt-launcher pods (`kubevirt.io=virt-launcher`) and KubeVirt's
  and CDI's own components — Nodes and Events
- PersistentVolumeClaims, so a disk's claim opens from the drawer

It never reads Secrets. Where a disk or a cloud-init volume names one, only its
name is shown, taken from the VM.

The pages cannot patch anything. The only changes the plugin can make are its
buttons, each of which the app shows you and runs only when you say so:

- `PUT` to `start`, `stop` and `restart` on
  `/apis/subresources.kubevirt.io/v1/namespaces/<ns>/virtualmachines/<name>/`
- `PUT` to `pause`, `unpause` and `softreboot` on
  `/apis/subresources.kubevirt.io/v1/namespaces/<ns>/virtualmachineinstances/<name>/`
- creating a `VirtualMachineInstanceMigration` (`kubevirt.io/v1`) for the
  machine, in its own namespace

## Charts

The queries read the `kubevirt_vmi_*` series virt-handler exports. Metric names
have moved between KubeVirt releases; if yours differ, change the queries in
`plugin.json` in your own copy of this repository.

## Checking it

The app checks the plugin when it loads it. To run the same checks without the
app, for example in CI:

```
go run github.com/rogerwesterbo/k8sdockside/cmd/plugincheck@main .
```

`.github/workflows/check.yml` does this on every push.

## Layout

```
plugin.json        the manifest: kinds, views, cards, charts, buttons, panel, links
ui/
├── model.js       reads everything once per poll and works it out
├── kit.js         shared drawing: the honeycomb, screens, meters, charts, icons
├── kubevirt.css   one stylesheet, on the app's theme tokens
├── overview.html  the overview            → overview.js
├── machines.html  Machines                → board.js
└── vm.html        the Machine panel       → vm.js
```

See the app's [plugin documentation](https://github.com/rogerwesterbo/k8sdockside/blob/main/docs/plugins.md)
for the format.
