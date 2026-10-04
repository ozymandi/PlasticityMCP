/** JavaScript snippets that run inside Plasticity's renderer with `this` = editor. */

// Runs with `this` = editor. Only bodies with a stable id are public: sketching leaves
// transient fragments without one.
export const READ_STATE = `function () {
  // Metres to millimetres, rounded to 1e-6 mm to drop float noise.
  const mm = (v) => [v.x, v.y, v.z].map((n) => Math.round(n * 1e9) / 1e6 + 0);
  const bodies = [];
  for (const [versionId, item] of this.geo.geometryModel) {
    const id = this.db.lookupStableId(versionId);
    if (!Number.isInteger(id)) continue;
    let box = null;
    try { box = item.model?.FindBox?.() ?? null; } catch {}
    const view = item.view;
    const nodes = this.db.nodes;
    const key = nodes.item2key(view);
    bodies.push({
      id,
      type: view?.constructor?.name ?? 'Unknown',
      name: nodes.getName(key) ?? null,
      boundsMm: box ? { min: mm(box.min), max: mm(box.max) } : null,
      faceCount: view?.high?.faces?.versionIds?.length ?? 0,
      edgeCount: view?.high?.edges?.versionIds?.length ?? 0,
      visible: Boolean(nodes.isVisible(key)) && !nodes.isHidden(key),
      locked: Boolean(nodes.isLocked(key)),
      selected: Boolean(this.selection.selected.has(view)),
    });
  }
  bodies.sort((a, b) => a.id - b.id);
  return {
    busy: Boolean(this.executor.isBusy),
    windowHidden: Boolean(document.hidden),
    undoDepth: this.history?.undoStack?.length ?? 0,
    redoDepth: this.history?.redoStack?.length ?? 0,
    bodies,
  };
}`;

// Snippets shared by the functions below; all run with `this` = editor.
export const BUSY_GUARD = `if (this.executor.isBusy) throw new Error('Plasticity is busy with another command');`;

// After a failure inside Plasticity's own undo / redo the editor can stop running commands
// without reporting anything. Each command wrapper sets \`ran\` when its body starts.
export const STUCK_CHECK = `if (!ran) throw new Error('Plasticity did not run the command: its editor is stuck. Restart Plasticity through native_launch.');`;

export const FIND_VIEW = `const findItem = (id) => {
    for (const [versionId, item] of this.geo.geometryModel) {
      if (this.db.lookupStableId(versionId) === id) return item;
    }
    throw new Error('Unknown body id: ' + id);
  };
  const find = (id) => findItem(id).view;`;

// Resolves face / edge ids of one body to their views. Ids are version-specific: any change
// to the body invalidates them, so a miss is reported as stale rather than guessed at.
export const PICK_TOPOLOGY = `const pick = (collection, ids, kind) => {
    const all = Array.from(collection?.versionIds ?? []).map(String);
    return ids.map((id) => {
      const index = all.indexOf(String(id));
      if (index < 0) {
        throw new Error('Stale or unknown ' + kind + ' id: ' + id + ' (re-read get_body_topology)');
      }
      return collection.get(index);
    });
  };`;

// Resolves a curve to what a profile factory needs: `{ view, region }`. A closed planar curve
// yields its Region (a Solid profile); an open curve yields `region: null` (a Sheet profile).
//
// Plasticity builds Regions automatically from the closed curves of a plane, but a Region does
// not say which curve it came from. Match by bounding box instead: exactly one Region of that
// plane may lie inside the box of the curve, and it must fill it. Region boxes come from the
// display mesh, hence the tolerance.
export const PROFILE_OF = `const profileOf = (id) => {
    const item = findItem(id);
    const view = item.view;
    const type = view.constructor.name;
    if (type !== 'Wire') throw new Error('Body ' + id + ' is a ' + type + ', not a curve');
    if (!item.model?.IsClosed?.()) return { view, region: null };
    let basis;
    try { basis = editor.curves.lookup(view); }
    catch { throw new Error('Closed curve ' + id + ' is not planar, so it cannot be used as a profile'); }
    const sketch = Array.from(editor.curves.read.sketch2basis ?? []).find(([, b]) => b === basis)?.[0];
    const box = item.model.FindBox();
    const axes = ['x', 'y', 'z'];
    const tol = Math.max(1e-5, 0.01 * Math.hypot(...axes.map((k) => box.max[k] - box.min[k])));
    const inside = (b) => axes.every((k) => b.min[k] >= box.min[k] - tol && b.max[k] <= box.max[k] + tol);
    const fills = (b) => axes.every((k) => Math.abs(b.min[k] - box.min[k]) <= tol && Math.abs(b.max[k] - box.max[k]) <= tol);
    const regions = [];
    for (const [, candidate] of editor.geo.geometryModel) {
      if (candidate.view?.constructor?.name !== 'SketchIsland') continue;
      let candidateSketch;
      try { candidateSketch = editor.sketches.getSketchId(candidate.view); } catch { continue; }
      if (String(candidateSketch) !== String(sketch)) continue;
      for (let i = 0; i < (candidate.view.regions?.length ?? 0); i += 1) {
        const region = candidate.view.regions.get(i);
        if (region && inside(region.getBoundingBox())) regions.push(region);
      }
    }
    if (regions.length === 0) throw new Error('Plasticity built no region for closed curve ' + id);
    if (regions.length > 1 || !fills(regions[0].getBoundingBox())) {
      throw new Error('The profile of curve ' + id + ' is ambiguous: other curves in the same plane cross it or lie inside it. Move or delete them, or build the shape with boolean.');
    }
    return { view, region: regions[0] };
  };`;

// Setup lines shared by the profile factories (extrude, revolve, sweep): `args.id` is the curve.
export const USE_PROFILE = `if (args.regionIds) {
          factory.regions = pickRegions(args.regionIds);
        } else {
          const profile = profileOf(args.id);
          if (profile.region) factory.regions = [profile.region];
          else factory.curves = [profile.view];
        }`;

// Resolves region ids from list_regions. Like face and edge ids they are version-specific:
// any change to the curves of that plane renames them, so a miss is reported as stale.
export const PICK_REGIONS = `const pickRegions = (ids) => {
    const byId = new Map();
    for (const [, candidate] of editor.geo.geometryModel) {
      if (candidate.view?.constructor?.name !== 'SketchIsland') continue;
      for (let i = 0; i < (candidate.view.regions?.length ?? 0); i += 1) {
        const region = candidate.view.regions.get(i);
        if (region) byId.set(String(region.versionId), region);
      }
    }
    return ids.map((id) => {
      const region = byId.get(String(id));
      if (!region) throw new Error('Stale or unknown region id: ' + id + ' (re-read list_regions)');
      return region;
    });
  };`;

/**
 * Wraps a factory setup snippet into a native command. The snippet sees `factory`, `editor`,
 * `args` and the extra bindings; it must not commit. Errors raised inside `execute` are
 * rethrown, because the native executor swallows them.
 *
 * `commandName` is looked up in `editor.commands`; with `commandBinding` the command class is
 * instead passed as the second binding (for commands that only exist in the module closure).
 */
export function commandFunction(
  commandName: string,
  extraParams: string[],
  setup: string,
  commandBinding = false,
): string {
  const params = ["Factory", ...(commandBinding ? ["Command"] : []), ...extraParams, "args"];
  const commandClass = commandBinding ? "Command" : `this.commands.${commandName}`;
  return `async function (${params.join(", ")}) {
    ${BUSY_GUARD}
    ${FIND_VIEW}
    ${PICK_TOPOLOGY}
    ${PROFILE_OF}
    ${PICK_REGIONS}
    const editor = this;
    let failure;
        let ran = false;
    const command = new ${commandClass}(this);
    command.remember = false;
    command.execute = async function () {
          ran = true;
      try {
        const factory = new Factory(editor).resource(this);
        ${setup}
        const created = await factory.commit();
        if (args.name && created) {
          for (const view of (Array.isArray(created) ? created : [created])) {
            editor.db.nodes.setName(editor.db.nodes.item2key(view), args.name);
          }
        }
      } catch (error) {
        failure = error;
        throw error;
      }
    };
    await this.exec(command);
    if (failure) throw failure;
        ${STUCK_CHECK}
  }`;
}
