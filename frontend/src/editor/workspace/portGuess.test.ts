import { describe, expect, it } from 'vitest'
import { describeGroup, guessPorts } from './portGuess'

describe('guessPorts', () => {
  it('reads copper and uplink counts from the model', () => {
    expect(guessPorts('C1300-24T-4G', 'l2_switch').map(describeGroup)).toEqual([
      '24 × GigabitEthernet1/0/1–24 (RJ45 1G)',
      '4 × GigabitEthernet1/0/25–28 (SFP 1G)',
    ])
    expect(guessPorts('CBS220-24T-4G', 'l2_switch').map(describeGroup)).toEqual([
      '24 × GigabitEthernet1–24 (RJ45 1G)',
      '4 × GigabitEthernet25–28 (SFP 1G)',
    ])
    expect(guessPorts('C9200-48P-4X').map(describeGroup)).toEqual([
      '48 × GigabitEthernet1/0/1–48 (RJ45 1G, PoE)',
      '4 × GigabitEthernet1/0/49–52 (SFP+ 10G)',
    ])
  })
  it('routers and firewalls', () => {
    expect(guessPorts('ISR4331').map(describeGroup)).toEqual([
      '3 × GigabitEthernet0/0/0–2 (RJ45 1G)',
    ])
    expect(guessPorts('FortiGate 80F').map(describeGroup)).toEqual([
      '2 × wan1–2 (RJ45 1G)',
      '7 × port1–7 (RJ45 1G)',
    ])
  })
  it('unknown models get a plain proposal', () => {
    expect(guessPorts('', 'l2_switch').map(describeGroup)).toEqual(['24 × Gi1–24 (RJ45 1G)'])
  })
})
