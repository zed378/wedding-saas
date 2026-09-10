import { Injectable, NotFoundException } from "@nestjs/common";
import { SCHEMA_CONTRACT_VERSION } from "@wi/schema";
import { ReferenceRepository } from "./reference.repository";

export interface ReferenceView {
  readonly layering: string;
  readonly schemaContractVersion: number;
}

/**
 * Business logic and authorization live here, and nowhere else.
 *
 * The import from `@wi/schema` is deliberate and load-bearing: ADR-004 chose one language
 * for the whole stack so that the field-path registry and the dot-notation resolver are a
 * shared package rather than two implementations kept in step by discipline. Importing it
 * here proves the boundary resolves and compiles now, instead of that assumption being
 * tested for the first time at P0-20 when a lot more depends on it.
 */
@Injectable()
export class ReferenceService {
  constructor(private readonly repository: ReferenceRepository) {}

  describe(): ReferenceView {
    const record = this.repository.findById("reference");
    if (!record) {
      // A service raises a domain error. Mapping it to a status code is the error
      // mapper's job (P0-13), not the controller's.
      throw new NotFoundException();
    }
    return {
      layering: record.note,
      schemaContractVersion: SCHEMA_CONTRACT_VERSION,
    };
  }
}
