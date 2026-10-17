import { runChecks, type CheckInput } from './rules'

// Diagram checks off the main thread (SRS §7): the editor posts the plain input, gets the problems back.
self.onmessage = (event: MessageEvent<{ seq: number; input: CheckInput }>) => {
  self.postMessage({ seq: event.data.seq, problems: runChecks(event.data.input) })
}
