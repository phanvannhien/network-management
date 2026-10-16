import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { getSampleDevice, listSampleDevices, type ListParams } from './sampleDevices'

// Query hooks shaped like the future API calls (P1-08): only the queryFn changes then.
export function useDeviceList(orgId: string, params: ListParams) {
  return useQuery({
    queryKey: ['orgs', orgId, 'devices', params],
    queryFn: () => listSampleDevices(params),
    placeholderData: keepPreviousData,
  })
}

export function useDevice(orgId: string, deviceId: string) {
  return useQuery({
    queryKey: ['orgs', orgId, 'devices', 'detail', deviceId],
    queryFn: () => getSampleDevice(deviceId),
  })
}
