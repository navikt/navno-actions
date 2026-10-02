import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FakeRequest {
	method: string;
	/** The request target as sent: still percent-encoded, with the query. */
	raw: string;
	/** The decoded path without the query, which routes are matched on. */
	path: string;
	/** The full URL, e.g. for `searchParams` or a Link header back to the fake. */
	url: URL;
}

export interface FakeResponse {
	/** Defaults to 200. */
	status?: number;
	headers?: Record<string, string>;
	/** Sent as JSON. */
	body?: unknown;
}

/**
 * Keyed by `<METHOD> <decoded path>`, e.g. `GET /repos/navikt/fixture/releases/tags/release/prod@1`.
 * Matching the decoded path keeps a route independent of how Octokit percent-encodes `/` and `@`.
 * A function answers per request, e.g. per `page` in the query.
 */
export type Routes = Record<string, FakeResponse | ((request: FakeRequest) => FakeResponse)>;

export interface FakeGitHub {
	/** The API's base URL, for GITHUB_API_URL. */
	url: string;
	/** Every request it received, in order. */
	requests: FakeRequest[];
	close(): Promise<void>;
}

const notFound: FakeResponse = {
	status: 404,
	body: { message: 'Not Found', documentation_url: 'https://docs.github.com/rest', status: '404' },
};

/** A GitHub REST API on 127.0.0.1 that answers `routes` and 404s everything else, as GitHub does. */
export async function fakeGitHub(routes: Routes): Promise<FakeGitHub> {
	const requests: FakeRequest[] = [];
	let base = '';
	const server = createServer((req, res) => {
		const raw = req.url ?? '/';
		const url = new URL(raw, base);
		const request: FakeRequest = { method: req.method ?? '', raw, path: decodeURIComponent(url.pathname), url };
		requests.push(request);

		const route = routes[`${request.method} ${request.path}`] ?? notFound;
		const { status = 200, headers, body } = typeof route === 'function' ? route(request) : route;
		res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
		res.end(JSON.stringify(body));
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

	return {
		url: base,
		requests,
		close: () =>
			new Promise((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
				server.closeAllConnections();
			}),
	};
}
