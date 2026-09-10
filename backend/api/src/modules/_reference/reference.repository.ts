import { Injectable } from "@nestjs/common";

export interface ReferenceRecord {
  readonly id: string;
  readonly note: string;
}

/**
 * Data access only. No business rule lives here (docs/ARCHITECTURE/01 § Layering).
 *
 * From P0-11 onward every method on a tenant-owned table carries its ownership filter in
 * the query -- `findOwned(id, userId)`, never `findById(id)` followed by a check.
 */
@Injectable()
export class ReferenceRepository {
  private readonly rows: ReadonlyMap<string, ReferenceRecord> = new Map([
    [
      "reference",
      { id: "reference", note: "Controller -> Service -> Repository" },
    ],
  ]);

  findById(id: string): ReferenceRecord | undefined {
    return this.rows.get(id);
  }
}
