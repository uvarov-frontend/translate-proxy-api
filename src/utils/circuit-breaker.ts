/**
 * Simple per-provider circuit breaker.
 *
 * States:
 *   closed   — normal operation; failures accumulate
 *   open     — provider is skipped entirely until RECOVERY_MS passes
 *   half-open — cooldown elapsed; exactly ONE probe is allowed through
 *   probing  — probe is in-flight; all other requests are rejected until it resolves
 *
 * Thresholds:
 *   FAILURE_THRESHOLD = 5  consecutive errors before opening
 *   RECOVERY_MS       = 30 000ms cooldown before the probe attempt
 */

type CircuitState = "closed" | "open" | "half-open" | "probing";

type CircuitBreakerState = {
  state: CircuitState;
  failures: number;
  openUntil: number;
};

const FAILURE_THRESHOLD = 5;
const RECOVERY_MS = 30_000;

const circuits = new Map<string, CircuitBreakerState>();

function getCircuit(name: string): CircuitBreakerState {
  let circuit = circuits.get(name);
  if (!circuit) {
    circuit = { state: "closed", failures: 0, openUntil: 0 };
    circuits.set(name, circuit);
  }
  return circuit;
}

/**
 * Returns true if the provider should be tried for the current request.
 * Transitions half-open → probing atomically so only one probe goes through.
 */
export function isProviderAvailable(name: string): boolean {
  const circuit = getCircuit(name);

  if (circuit.state === "closed") return true;

  if (circuit.state === "open") {
    if (Date.now() >= circuit.openUntil) {
      circuit.state = "half-open";
    } else {
      return false; // still cooling down
    }
  }

  if (circuit.state === "half-open") {
    // Exactly one probe: immediately move to "probing" so concurrent requests are blocked.
    circuit.state = "probing";
    return true;
  }

  // probing: a probe is already in-flight — reject all others
  return false;
}

/** Call after a successful provider response. Closes the circuit. */
export function recordProviderSuccess(name: string): void {
  const circuit = getCircuit(name);
  circuit.state = "closed";
  circuit.failures = 0;
}

/** Call after a failed provider response. Opens the circuit after FAILURE_THRESHOLD errors,
 *  or immediately if the probe request (half-open → probing) fails. */
export function recordProviderFailure(name: string): void {
  const circuit = getCircuit(name);
  circuit.failures++;
  // A failed probe re-opens immediately; otherwise wait for threshold.
  if (circuit.state === "probing" || circuit.failures >= FAILURE_THRESHOLD) {
    circuit.state = "open";
    circuit.openUntil = Date.now() + RECOVERY_MS;
  }
}
