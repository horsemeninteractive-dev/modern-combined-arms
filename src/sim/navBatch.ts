/**
 * Command-scoped navigation traffic.
 *
 * A mass order issues one path request per unit. Every request used to scan
 * every unit and allocate a full-map soft-traffic mask, even though all the
 * requests in one command share the same team and world state. This class
 * performs that scan once, keeps one mask per movement domain, and lets the
 * command update the mask as it marks units moving.
 *
 * Lifetime is deliberately owned by the caller: `Game.commandMove` and
 * `Game.canOrderMove` create one batch, use it for their path requests and drop
 * it. There is no module-level cache, so no state can survive a command, tick,
 * match or simulation instance.
 *
 * The batch includes the requesting unit in its own mask, unlike the old
 * per-request mask which skipped `other === e`. That difference is confined to
 * the search origin tile: A* closes the origin before expanding neighbours, and
 * `nearestWalkable` and `lineClear` never let soft traffic change passability.
 * The resulting routes are therefore identical; the equivalence tests check
 * this directly.
 */

export interface NavBatchMember {
  id: number;
  tile: number;
  domain: string;
  moving: boolean;
}

interface DomainMask {
  /** 0 = no traffic, 1 = holding position, 2 = moving. */
  soft: Uint8Array;
  /** Eligible member ids per tile, in entity iteration order. */
  byTile: Map<number, number[]>;
}

interface MemberEntry {
  tile: number;
  domain: string;
  moving: boolean;
}

export class NavBatch {
  private readonly entries = new Map<number, MemberEntry>();
  private readonly domains = new Map<string, DomainMask>();

  constructor(
    readonly width: number,
    readonly height: number,
    members: readonly NavBatchMember[],
  ) {
    for (const member of members) {
      const tile = member.tile;
      let domain = this.domains.get(member.domain);
      if (!domain) {
        domain = { soft: new Uint8Array(width * height), byTile: new Map() };
        this.domains.set(member.domain, domain);
      }
      // Last writer wins, exactly as the old per-request scan did. The per-tile
      // list lets `refresh` recover the last writer after one member changes.
      domain.soft[tile] = member.moving ? 2 : 1;
      const ids = domain.byTile.get(tile);
      if (ids) ids.push(member.id);
      else domain.byTile.set(tile, [member.id]);
      this.entries.set(member.id, { tile, domain: member.domain, moving: member.moving });
    }
  }

  /** Soft-traffic mask for a movement domain, or undefined when it has none. */
  softFor(domain: string): Uint8Array | undefined {
    return this.domains.get(domain)?.soft;
  }

  /**
   * Recompute one member's tile after its `state`/`path` changed during the
   * command. Only the changed tile is touched; untouched members are not
   * rescanned.
   */
  refresh(id: number, moving: boolean): void {
    const entry = this.entries.get(id);
    if (!entry || entry.moving === moving) return;
    entry.moving = moving;
    const domain = this.domains.get(entry.domain);
    if (!domain) return;
    const ids = domain.byTile.get(entry.tile);
    if (!ids) return;
    // The old scan assigned the tile once per entity, so the *last* entity on
    // the tile owns the value. An earlier entity changing state does not move
    // the tile; only a change in the last writer does.
    const writer = this.entries.get(ids[ids.length - 1]);
    domain.soft[entry.tile] = writer?.moving ? 2 : 1;
  }
}
