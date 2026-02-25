export type NotamItem = {
  id: string
  notamId: string
  type: string | null
  category: string | null
  subtype: string | null
  description: string | null
  facility: string | null
  state: string | null
  location: string | null
  startsAt: string | null
  endsAt: string | null
  rawText: string | null
}

export type NotamProviderResult = {
  items: NotamItem[]
  message?: string
  source: string
}

export interface NotamProvider {
  fetchNotams(params: {
    icaos: string[]
    startsAtIso: string
    endsAtIso: string
  }): Promise<NotamProviderResult>
}

