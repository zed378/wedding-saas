import type { JobContext } from "../runner.js";
import { logger } from "../logger.js";

/**
 * The end-to-end example the P0-15 card asks for.
 *
 * Not registered in production -- it exists so the tests can drive a real job through a
 * real queue: claim, work, mark, retry, dead-letter. A test that only exercises mocks
 * would confirm the wiring compiles rather than that BullMQ retries the number of times
 * the policy says.
 */
export interface ExampleData {
  readonly message: string;
  /** Set to make the handler throw, so retry and dead-lettering can be observed. */
  readonly failTimes?: number;
}

export function makeExampleHandler(): {
  handler: (data: ExampleData, context: JobContext) => Promise<void>;
  /** How many times the handler actually ran -- the idempotency assertion. */
  runs: () => number;
} {
  let runs = 0;

  return {
    runs: () => runs,
    handler: async (data: ExampleData, context: JobContext): Promise<void> => {
      runs += 1;
      if (data.failTimes !== undefined && context.attempt <= data.failTimes) {
        throw new Error(`deliberate failure on attempt ${context.attempt}`);
      }
      logger.debug(
        { context: { job_name: context.jobName, attempt: context.attempt } },
        data.message,
      );
    },
  };
}
