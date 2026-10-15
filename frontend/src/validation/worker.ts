import type { NtbData } from '../model/types'
import { runValidation } from './engine'

self.onmessage = (event: MessageEvent<NtbData>) => {
  self.postMessage(runValidation(event.data))
}
