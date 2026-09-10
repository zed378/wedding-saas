import { Global, Module } from "@nestjs/common";

import { logger, securityLogger } from "./logger";

/** Injection token for the application logger. */
export const LOGGER = Symbol("LOGGER");
/** Injection token for the separately-retained security event stream. */
export const SECURITY_LOGGER = Symbol("SECURITY_LOGGER");

/**
 * Logging is global: everything logs, and requiring each module to import a logging
 * module is the kind of friction that ends with someone reaching for `console.log`,
 * which is unredacted and unstructured.
 */
@Global()
@Module({
  providers: [
    { provide: LOGGER, useValue: logger },
    { provide: SECURITY_LOGGER, useValue: securityLogger },
  ],
  exports: [LOGGER, SECURITY_LOGGER],
})
export class LoggingModule {}
