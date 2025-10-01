import { ORIGIN } from '$env/static/private'

export interface YandexLoggedEvent {
	targetId: string // tid
	clientId: string // cid
	type: 'pageView' | 'event' // t
	params?: object | string // params
	at?: string // et
	token: string // ms
}

export interface YandexPageViewEvent extends YandexLoggedEvent {
	type: 'pageView' // t
	refer: string // dr
	url: string // dl
	header: string // dt
}

export interface YandexInternalEvent extends YandexLoggedEvent {
	type: 'event' // t
	url?: string // dl
	action: string // ea
}

function isPageView(event: YandexPageViewEvent | YandexInternalEvent): event is YandexPageViewEvent {
	return event.type === 'pageView'
}

export class Counter {
	constructor(
		public origin: string,
		public token: string,
		public targetId: string,
		public clientId: string
	) {}

	async logEvent(
		event:
			| Omit<YandexInternalEvent, 'token' | 'targetId' | 'clientId'>
			| Omit<YandexPageViewEvent, 'token' | 'targetId' | 'clientId'>
	) {
		const fullEvent = {
			...event,
			token: this.token,
			targetId: this.targetId,
			clientId: this.clientId,
		} as YandexInternalEvent | YandexPageViewEvent
		if (fullEvent.url && fullEvent.url.startsWith('/')) {
			fullEvent.url = new URL(fullEvent.url, this.origin).href
		}

		const url = new URL('/collect/', 'https://mc.yandex.ru')
		url.searchParams.set('tid', this.targetId)
		url.searchParams.set('cid', this.clientId)
		url.searchParams.set('ms', this.token)
		url.searchParams.set('t', fullEvent.type)
		if (fullEvent.params) {
			const params = typeof fullEvent.params === 'string' ? fullEvent.params : JSON.stringify(fullEvent.params)
			url.searchParams.set('params', params)
		}
		if (isPageView(fullEvent)) {
			url.searchParams.set('dr', fullEvent.refer)
			url.searchParams.set('dl', fullEvent.url)
			url.searchParams.set('dt', fullEvent.header)
		} else {
			fullEvent.url && url.searchParams.set('dl', fullEvent.url)
			url.searchParams.set('ea', fullEvent.action)
			fullEvent.at && url.searchParams.set('et', fullEvent.at)
		}

		await fetch(url.href).catch(e => console.error(e))
	}
}
