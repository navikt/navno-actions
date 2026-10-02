import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fakeGitHub, type FakeRequest, type Routes } from '../../helpers/fake-github.ts';
import { runActionAsync, type ActionResult } from '../../helpers/run-action.ts';

// run-action.ts sets GITHUB_REPOSITORY to navikt/fixture.
const API = '/repos/navikt/fixture';
const IMAGE = `europe-north1-docker.pkg.dev/nais-management-233d/navno/app:2026.09.01-1@sha256:${'d'.repeat(64)}`;

interface Fixture {
	tag: string;
	/** The commit the tag points at. */
	commit: string;
	published: string;
	body?: string;
	draft?: boolean;
	prerelease?: boolean;
}

/** A 40-character commit SHA made of one hex digit. */
function sha(digit: string): string {
	return digit.repeat(40);
}

/** A `published_at` on the given day of September. */
function day(day: number): string {
	return `2026-09-${String(day).padStart(2, '0')}T12:00:00Z`;
}

function releaseJson({ tag, published, body, draft = false, prerelease = false }: Fixture) {
	return {
		tag_name: tag,
		draft,
		prerelease,
		published_at: draft ? null : published,
		body: body ?? `Deployed image: \`${IMAGE}\`\n\n## What's Changed\n`,
		html_url: `https://github.com/navikt/fixture/releases/tag/${encodeURIComponent(tag)}`,
	};
}

/** The routes GitHub answers for these releases, listed in this order, and their lightweight tags. */
function routes(fixtures: Fixture[]): Routes {
	const routes: Routes = { [`GET ${API}/releases`]: { body: fixtures.map(releaseJson) } };
	for (const fixture of fixtures) {
		if (!fixture.draft) routes[`GET ${API}/releases/tags/${fixture.tag}`] = { body: releaseJson(fixture) };
		routes[`GET ${API}/git/ref/tags/${fixture.tag}`] = {
			body: { ref: `refs/tags/${fixture.tag}`, object: { type: 'commit', sha: fixture.commit } },
		};
	}
	return routes;
}

/** Runs find-release against a fake GitHub API. Inputs not given get their action.yml defaults. */
async function findRelease(
	routes: Routes,
	inputs: Record<string, string> = {},
): Promise<ActionResult & { requests: FakeRequest[] }> {
	const github = await fakeGitHub(routes);
	try {
		const result = await runActionAsync(
			'find-release',
			{ tag: '', 'tag-prefix': 'release/prod@', token: 'test-token', ...inputs },
			{ env: { GITHUB_API_URL: github.url } },
		);
		return { ...result, requests: github.requests };
	} finally {
		await github.close();
	}
}

test('an empty tag picks the release before the newest', async () => {
	const { status, stdout, outputs } = await findRelease(
		routes([
			{ tag: 'release/prod@300', commit: sha('c'), published: day(3) },
			{ tag: 'release/prod@200', commit: sha('b'), published: day(2) },
			{ tag: 'release/prod@100', commit: sha('a'), published: day(1) },
		]),
	);
	assert.equal(status, 0, stdout);
	assert.deepEqual(outputs, {
		tag: 'release/prod@200',
		sha: sha('b'),
		image: IMAGE,
		url: 'https://github.com/navikt/fixture/releases/tag/release%2Fprod%40200',
	});
	assert.match(stdout, /The newest release\/prod@ release is release\/prod@300, commit c{40}/);
});

test('an older release of the newest commit is skipped', async () => {
	const { status, stdout, outputs, summary } = await findRelease(
		routes([
			{ tag: 'release/prod@300', commit: sha('c'), published: day(3) },
			{ tag: 'release/prod@250', commit: sha('c'), published: day(2) },
			{ tag: 'release/prod@200', commit: sha('b'), published: day(1) },
		]),
	);
	assert.equal(status, 0, stdout);
	assert.equal(outputs.tag, 'release/prod@200');
	assert.match(stdout, /Skipping release\/prod@250: same commit as release\/prod@300/);
	assert.match(summary, /<th>Newest release<\/th><td><a [^>]+>release\/prod@300<\/a>/);
	assert.match(summary, /<th>Skipped, same commit as the newest<\/th><td><a [^>]+>release\/prod@250<\/a><\/td>/);
});

test('drafts and other prefixes are ignored, and pre-releases count like any other release', async () => {
	const draft = { tag: 'release/prod@500', commit: sha('e'), published: day(5), draft: true };
	const picked = await findRelease(
		routes([
			draft,
			{ tag: 'release/dev@400', commit: sha('d'), published: day(4) },
			{ tag: 'release/prod@300', commit: sha('c'), published: day(3) },
			{ tag: 'release/prod@200', commit: sha('b'), published: day(2), prerelease: true },
			{ tag: 'release/prod@100', commit: sha('a'), published: day(1) },
		]),
	);
	assert.equal(picked.status, 0, picked.stdout);
	assert.match(picked.stdout, /The newest release\/prod@ release is release\/prod@300/);
	assert.equal(picked.outputs.tag, 'release/prod@200');

	// A draft has no published_at, so it sorts last: it could only be picked when nothing else is left.
	const onlyDraft = await findRelease(
		routes([draft, { tag: 'release/prod@300', commit: sha('c'), published: day(3) }]),
	);
	assert.equal(onlyDraft.status, 1);
	assert.match(
		onlyDraft.stdout,
		/::error::No release\/prod@ release before release\/prod@300 points at another commit/,
	);
	assert.doesNotMatch(onlyDraft.stdout, /release\/prod@500/);
});

test('order comes from published_at, not from the API or the tag names', async () => {
	// Newest first, published_at gives @1, @3, @2; the API gives @2, @1, @3; the tag names give @3, @2, @1.
	const { status, stdout, outputs } = await findRelease(
		routes([
			{ tag: 'release/prod@2', commit: sha('b'), published: day(1) },
			{ tag: 'release/prod@1', commit: sha('a'), published: day(3) },
			{ tag: 'release/prod@3', commit: sha('c'), published: day(2) },
		]),
	);
	assert.equal(status, 0, stdout);
	assert.equal(outputs.tag, 'release/prod@3');
});

test('releases published at the same time are ordered by tag name', async () => {
	const { status, stdout, outputs } = await findRelease(
		routes([
			{ tag: 'release/prod@10', commit: sha('a'), published: day(1) },
			{ tag: 'release/prod@20', commit: sha('b'), published: day(1) },
		]),
	);
	assert.equal(status, 0, stdout);
	assert.equal(outputs.tag, 'release/prod@10');
});

test('releases on every page are considered', async () => {
	const firstPage = [
		{ tag: 'release/prod@200', commit: sha('b'), published: day(2) },
		{ tag: 'release/prod@100', commit: sha('a'), published: day(1) },
	];
	const lastPage = [{ tag: 'release/prod@300', commit: sha('c'), published: day(3) }];
	const github = routes([...firstPage, ...lastPage]);
	github[`GET ${API}/releases`] = ({ url }) =>
		url.searchParams.get('page') === '2'
			? { body: lastPage.map(releaseJson) }
			: {
					headers: { link: `<${url.origin}${API}/releases?per_page=100&page=2>; rel="next"` },
					body: firstPage.map(releaseJson),
				};

	const { status, stdout, outputs, requests } = await findRelease(github);
	assert.equal(status, 0, stdout);
	assert.equal(outputs.tag, 'release/prod@200');
	assert.equal(requests.filter((request) => request.path === `${API}/releases`).length, 2);
});

test('fewer than two commits among the releases is an error', async () => {
	const sameCommit = await findRelease(
		routes([
			{ tag: 'release/prod@200', commit: sha('b'), published: day(2) },
			{ tag: 'release/prod@100', commit: sha('b'), published: day(1) },
		]),
	);
	assert.equal(sameCommit.status, 1);
	assert.match(
		sameCommit.stdout,
		/::error::No release\/prod@ release before release\/prod@200 points at another commit/,
	);
	// The listing reuses the releases fetched to pick from.
	assert.match(sameCommit.stdout, /release\/prod@100 {2}published 2026-09-01T12:00:00Z {2}has an image line/);
	assert.equal(sameCommit.requests.filter((request) => request.path === `${API}/releases`).length, 1);

	const none = await findRelease(routes([{ tag: 'release/dev@100', commit: sha('a'), published: day(1) }]));
	assert.equal(none.status, 1);
	assert.match(none.stdout, /::error::No release\/prod@ releases found/);
});

test('an explicit annotated tag is followed to its commit', async () => {
	const github = routes([
		{ tag: 'release/prod@200', commit: sha('b'), published: day(2) },
		{ tag: 'release/prod@100', commit: sha('a'), published: day(1) },
	]);
	github[`GET ${API}/git/ref/tags/release/prod@100`] = {
		body: { ref: 'refs/tags/release/prod@100', object: { type: 'tag', sha: sha('f') } },
	};
	github[`GET ${API}/git/tags/${sha('f')}`] = { body: { sha: sha('f'), object: { type: 'commit', sha: sha('a') } } };

	const { status, stdout, outputs, requests } = await findRelease(github, { tag: 'release/prod@100' });
	assert.equal(status, 0, stdout);
	assert.deepEqual(outputs, {
		tag: 'release/prod@100',
		sha: sha('a'),
		image: IMAGE,
		url: 'https://github.com/navikt/fixture/releases/tag/release%2Fprod%40100',
	});
	// On success an explicit tag never lists the releases.
	assert.deepEqual(
		requests.map((request) => request.path),
		[`${API}/releases/tags/release/prod@100`, `${API}/git/ref/tags/release/prod@100`, `${API}/git/tags/${sha('f')}`],
	);
});

test('a missing release fails and lists the ten newest releases', async () => {
	const fixtures = Array.from({ length: 12 }, (_, i) => ({
		tag: `release/prod@${i + 1}`,
		commit: sha('a'),
		published: day(i + 1),
		body: i === 11 ? 'Notes from before the image line' : undefined,
	}));
	const { status, stdout, summary } = await findRelease(routes(fixtures), { tag: 'release/prod@999' });
	assert.equal(status, 1);
	assert.match(stdout, /::error::Release release\/prod@999 does not exist/);
	assert.ok(
		stdout.indexOf('::error::') < stdout.indexOf('The newest release/prod@ releases:'),
		'the error comes before the listing',
	);
	assert.match(stdout, /release\/prod@12 {2}published 2026-09-12T12:00:00Z {2}no image line/);
	assert.match(stdout, /release\/prod@3 {2}published 2026-09-03T12:00:00Z {2}has an image line/);
	assert.doesNotMatch(stdout, /release\/prod@2 /);
	assert.match(summary, /<td><a [^>]+>release\/prod@12<\/a><\/td><td>2026-09-12T12:00:00Z<\/td><td>no<\/td>/);
	assert.match(summary, /<td><a [^>]+>release\/prod@3<\/a><\/td><td>2026-09-03T12:00:00Z<\/td><td>yes<\/td>/);
	assert.doesNotMatch(summary, />release\/prod@2</);
});

test('an invalid tag is rejected before any request', async () => {
	for (const tag of ['release/prod@1;id', 'release/prod@$(id)', 'release/prod@1 2', 'release/prod@../../x']) {
		const { status, stdout, requests } = await findRelease({}, { tag });
		assert.equal(status, 1);
		assert.ok(
			stdout.includes(`::error::Invalid release tag "${tag}": use letters, digits and . _ / @ - only, and no ".."`),
			stdout,
		);
		assert.deepEqual(requests, []);
	}
});

test('a tag without the prefix is rejected before any request', async () => {
	const { status, stdout, requests } = await findRelease({}, { tag: 'release/dev@1' });
	assert.equal(status, 1);
	assert.match(stdout, /::error::"release\/dev@1" is not a release\/prod@ release/);
	assert.deepEqual(requests, []);
});

test('a release without an image line is rejected after both lookups', async () => {
	const { status, stdout, requests } = await findRelease(
		routes([{ tag: 'release/prod@100', commit: sha('a'), published: day(1), body: 'Deployed image: none' }]),
		{ tag: 'release/prod@100' },
	);
	assert.equal(status, 1);
	assert.ok(
		stdout.includes(
			'::error::Release release/prod@100 has no "Deployed image: `…`" line. ' +
				"Only releases created with navno-ci release.yml's image input can be deployed again",
		),
		stdout,
	);
	assert.deepEqual(
		requests.map((request) => request.path),
		[`${API}/releases/tags/release/prod@100`, `${API}/git/ref/tags/release/prod@100`, `${API}/releases`],
	);
});

test('an image that could add a nais-deploy var is rejected', async () => {
	const image = `${IMAGE},versionId=evil`;
	const { status, stdout, outputs } = await findRelease(
		routes([{ tag: 'release/prod@100', commit: sha('a'), published: day(1), body: `Deployed image: \`${image}\`` }]),
		{ tag: 'release/prod@100' },
	);
	assert.equal(status, 1);
	assert.ok(
		stdout.includes(
			`::error::Release release/prod@100 records an invalid image "${image}": ` +
				'it may only contain letters, digits and . _ / @ : -',
		),
		stdout,
	);
	assert.deepEqual(outputs, {});
});

test('an image without a digest is rejected', async () => {
	const image = 'europe-north1-docker.pkg.dev/nais-management-233d/navno/app:latest';
	const { status, stdout } = await findRelease(
		routes([{ tag: 'release/prod@100', commit: sha('a'), published: day(1), body: `Deployed image: \`${image}\`` }]),
		{ tag: 'release/prod@100' },
	);
	assert.equal(status, 1);
	assert.ok(
		stdout.includes(
			`::error::Release release/prod@100 records an invalid image "${image}": ` +
				'it must be pinned to a digest, ending in @sha256:<digest>',
		),
		stdout,
	);
});

test('a CRLF body parses', async () => {
	const { status, stdout, outputs } = await findRelease(
		routes([
			{
				tag: 'release/prod@100',
				commit: sha('a'),
				published: day(1),
				body: `Deployed image: \`${IMAGE}\`\r\n\r\n## What's Changed\r\n`,
			},
		]),
		{ tag: 'release/prod@100' },
	);
	assert.equal(status, 0, stdout);
	assert.equal(outputs.image, IMAGE);
});

test('401 and 403 say which permission the job needs', async () => {
	const { status, stdout } = await findRelease(
		{
			[`GET ${API}/releases/tags/release/prod@100`]: { status: 401, body: { message: 'Bad credentials' } },
			[`GET ${API}/releases`]: { status: 403, body: { message: 'Resource not accessible by integration' } },
		},
		{ tag: 'release/prod@100' },
	);
	assert.equal(status, 1);
	assert.ok(
		stdout.includes(
			'::error::GitHub API GET /repos/navikt/fixture/releases/tags/release/prod@100 returned 401: ' +
				'Bad credentials. The job needs permissions: contents: read',
		),
		stdout,
	);
	// The listing fails too, but only warns: the error above stays the reason.
	assert.ok(
		stdout.includes(
			'::warning::Could not list the release/prod@ releases: ' +
				'GitHub API GET /repos/navikt/fixture/releases?per_page=100 returned 403: ' +
				'Resource not accessible by integration. The job needs permissions: contents: read',
		),
		stdout,
	);
});

test('the summary links the release and the commit', async () => {
	const { status, stdout, summary } = await findRelease(
		routes([{ tag: 'release/prod@100', commit: sha('a'), published: day(1) }]),
		{ tag: 'release/prod@100' },
	);
	assert.equal(status, 0, stdout);
	assert.ok(
		summary.includes(
			'<a href="https://github.com/navikt/fixture/releases/tag/release%2Fprod%40100">release/prod@100</a>',
		),
		summary,
	);
	assert.ok(
		summary.includes(`<a href="https://github.com/navikt/fixture/commit/${sha('a')}">${sha('a')}</a>`),
		summary,
	);
	assert.ok(summary.includes(`<code>${IMAGE}</code>`), summary);
});

test('every request is a GET', async () => {
	// An annotated tag without an image line: every endpoint the action uses, the listing included.
	const github = routes([{ tag: 'release/prod@100', commit: sha('a'), published: day(1), body: '' }]);
	github[`GET ${API}/git/ref/tags/release/prod@100`] = { body: { object: { type: 'tag', sha: sha('f') } } };
	github[`GET ${API}/git/tags/${sha('f')}`] = { body: { object: { type: 'commit', sha: sha('a') } } };

	const { status, requests } = await findRelease(github, { tag: 'release/prod@100' });
	assert.equal(status, 1);
	assert.equal(requests.length, 4);
	assert.deepEqual(new Set(requests.map((request) => request.method)), new Set(['GET']));
});
