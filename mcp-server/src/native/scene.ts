/** Selection, deletion and renaming of bodies. */

import { NativeCore } from "./core.js";

import { BUSY_GUARD, FIND_VIEW, READ_STATE, STUCK_CHECK } from "./snippets.js";
import { BodyInfo, MutationResult, NativeState } from "./types.js";

export class SceneTools extends NativeCore {
  /** Bodies currently selected in the window (whole Solids / Sheets / Wires, not faces or edges). */
  async getSelection(): Promise<BodyInfo[]> {
    return (await this.state()).bodies.filter((b) => b.selected);
  }

  /** Replace the selection with the given bodies; an empty list clears it. Not an undo step. */
  selectBodies(ids: number[]): Promise<BodyInfo[]> {
    return this.enqueue(async () => {
      // Resolve every id before touching the selection, so a bad id changes nothing.
      await this.call(
        `function (args) {
          ${BUSY_GUARD}
          ${FIND_VIEW}
          const views = args.ids.map(find);
          this.selection.selected.removeAll();
          for (const view of views) this.selection.selected.add(view);
        }`,
        [],
        [{ ids }],
      );
      return (await this.call<NativeState>(READ_STATE)).bodies.filter((b) => b.selected);
    });
  }

  /** Delete bodies with the native Delete command. Replaces the current selection. */
  deleteBodies(ids: number[]): Promise<MutationResult> {
    return this.mutate(
      `async function (args) {
        ${BUSY_GUARD}
        ${FIND_VIEW}
        const views = args.ids.map(find);
        this.selection.selected.removeAll();
        for (const view of views) this.selection.selected.add(view);
        let failure;
        let ran = false;
        const command = new this.commands.DeleteCommand(this);
        command.remember = false;
        const execute = command.execute.bind(command);
        command.execute = async function () {
          ran = true;
          try { return await execute(); }
          catch (error) { failure = error; throw error; }
        };
        await this.exec(command);
        if (failure) throw failure;
        ${STUCK_CHECK}
      }`,
      [],
      [{ ids }],
    );
  }

  renameBody(id: number, name: string): Promise<BodyInfo> {
    return this.enqueue(async () => {
      // Renaming has no command of its own; run it inside a native command so that it
      // becomes an undo step. GroupSelectedCommand is only the carrier, its body is replaced.
      await this.waitForBackup();
      await this.call(
        `async function (args) {
          ${BUSY_GUARD}
          ${FIND_VIEW}
          const editor = this;
          const view = find(args.id);
          let failure;
        let ran = false;
          const command = new this.commands.GroupSelectedCommand(this);
          command.remember = false;
          command.execute = async function () {
          ran = true;
            try { editor.db.nodes.setName(editor.db.nodes.item2key(view), args.name); }
            catch (error) { failure = error; throw error; }
          };
          await this.exec(command);
          if (failure) throw failure;
        ${STUCK_CHECK}
        }`,
        [],
        [{ id, name }],
      );
      const body = (await this.call<NativeState>(READ_STATE)).bodies.find((b) => b.id === id);
      if (!body) throw new Error(`Body ${id} disappeared during rename`);
      return body;
    });
  }
}
