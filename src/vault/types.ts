export interface Scope {
	kv: string;
	path: string;
}

export interface Config {
	host: string;
	auth: {
		username: string;
		password: string;
	};
	scopes: Record<string, Scope>;
}
