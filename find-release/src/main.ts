import * as core from '@actions/core';
import * as github from '@actions/github';

type Octokit = ReturnType<typeof github.getOctokit>;
type Release = Awaited<ReturnType<Octokit['rest']['repos']['getReleaseByTag']>>['data'];

/** A release and its commit. For an empty `tag`, also the newest release and the ones skipped for sharing its commit. */
interface FoundRelease {
	release: Release;
	sha: string;
	newest?: Release;
	skipped?: Release[];
}

// Tags and commits.
const TAG = /^[A-Za-z0-9._/@-]+$/;
const COMMIT = /^[0-9a-f]{40}$/;
/** How many annotated tag objects to follow before giving up on reaching a commit. */
const MAX_TAG_DEPTH = 5;

// Images.
// navno-ci's release.yml writes this line from its `image` input; change the two together.
const IMAGE_LINE = /^Deployed image: `([^`]*)`$/;
// Nothing a shell treats specially, and no `,` or `=`, which would add entries to nais-deploy's `var:`.
const IMAGE = /^[A-Za-z0-9._/@:-]+$/;
// A tag like `latest` moves; only the digest says what the release deployed.
const DIGEST = /@sha256:[0-9a-f]{64}$/;

/** How many releases to list after a failure. */
const LISTED_RELEASES = 10;

async function run(): Promise<void> {
	try {
		const tag = core.getInput('tag');
		const prefix = core.getInput('tag-prefix', { required: true });
		// Checked before any request, since the tag goes into API paths.
		if (tag) assertValidTag(tag, prefix);
		await find(github.getOctokit(core.getInput('token', { required: true })), tag, prefix);
	} catch (error) {
		core.setFailed(errorMessage(error));
	}
}

function assertValidTag(tag: string, prefix: string): void {
	if (!TAG.test(tag) || tag.includes('..')) {
		throw new Error(`Invalid release tag "${tag}": use letters, digits and . _ / @ - only, and no ".."`);
	}
	if (!tag.startsWith(prefix)) throw new Error(`"${tag}" is not a ${prefix} release`);
}

/** Finds the release and sets the outputs. On failure, lists the newest releases to show which tags there are. */
async function find(octokit: Octokit, tag: string, prefix: string): Promise<void> {
	// Fetched at most once, whether to pick a release or to list them after a failure.
	let releases: Promise<Release[]> | undefined;
	const getReleases = () => (releases ??= listReleases(octokit, prefix));
	try {
		const found = tag ? await findByTag(octokit, tag) : await findBeforeNewest(octokit, await getReleases(), prefix);
		// Read after both lookups, so trying a release without an image still exercises them.
		const image = deployableImage(found.release);
		setOutputs(found, image);
		await summarize(found, image);
	} catch (error) {
		core.setFailed(errorMessage(error));
		await reportNewestReleases(getReleases, prefix);
	}
}

function setOutputs({ release, sha }: FoundRelease, image: string): void {
	core.setOutput('tag', release.tag_name);
	core.setOutput('sha', sha);
	core.setOutput('image', image);
	core.setOutput('url', release.html_url);
	core.info(`Found ${release.tag_name}: commit ${sha}, image ${image}`);
}

// Lookups.

async function findByTag(octokit: Octokit, tag: string): Promise<FoundRelease> {
	const { data: release } = await request(
		octokit.rest.repos.getReleaseByTag({ ...github.context.repo, tag }),
		`Release ${tag} does not exist`,
	);
	return { release, sha: await commitOf(octokit, tag) };
}

/** The first release older than the newest one that points at another commit. */
async function findBeforeNewest(octokit: Octokit, releases: Release[], prefix: string): Promise<FoundRelease> {
	if (releases.length === 0) throw new Error(`No ${prefix} releases found`);
	const [newest, ...older] = releases;
	const newestSha = await commitOf(octokit, newest.tag_name);
	core.info(`The newest ${prefix} release is ${newest.tag_name}, commit ${newestSha}`);

	// A release of the same commit would deploy the same code again. Usually the first older release differs.
	const skipped: Release[] = [];
	for (const release of older) {
		const sha = await commitOf(octokit, release.tag_name);
		if (sha !== newestSha) return { release, sha, newest, skipped };
		core.info(`Skipping ${release.tag_name}: same commit as ${newest.tag_name}`);
		skipped.push(release);
	}
	throw new Error(`No ${prefix} release before ${newest.tag_name} points at another commit`);
}

/** Non-draft releases whose tag starts with the prefix, newest first. Pre-releases count like any other. */
async function listReleases(octokit: Octokit, prefix: string): Promise<Release[]> {
	const releases = await request(
		octokit.paginate(octokit.rest.repos.listReleases, { ...github.context.repo, per_page: 100 }),
	);
	return releases.filter((release) => !release.draft && release.tag_name.startsWith(prefix)).sort(newestFirst);
}

/** By `published_at`, then by tag name. A release without `published_at` sorts last. */
function newestFirst(a: Release, b: Release): number {
	return descending(a.published_at ?? '', b.published_at ?? '') || descending(a.tag_name, b.tag_name);
}

/** By code unit, which sorts ISO 8601 UTC times like `published_at` correctly. */
function descending(a: string, b: string): number {
	if (a === b) return 0;
	return a > b ? -1 : 1;
}

/** The commit a tag points at, following annotated tag objects. */
async function commitOf(octokit: Octokit, tag: string): Promise<string> {
	const ref = await request(
		octokit.rest.git.getRef({ ...github.context.repo, ref: `tags/${tag}` }),
		`Tag ${tag} does not exist`,
	);
	let { object } = ref.data;
	for (let depth = 0; object.type === 'tag' && depth < MAX_TAG_DEPTH; depth++) {
		const annotated = await request(octokit.rest.git.getTag({ ...github.context.repo, tag_sha: object.sha }));
		object = annotated.data.object;
	}
	if (object.type !== 'commit' || !COMMIT.test(object.sha)) {
		throw new Error(`Tag ${tag} points at ${object.type} ${object.sha}, not a commit`);
	}
	return object.sha;
}

// Images.

/** What the first `Deployed image:` line in the release body says, if there is one. */
function parseImageLine(release: Release): string | undefined {
	for (const line of (release.body ?? '').split(/\r?\n/)) {
		const match = IMAGE_LINE.exec(line);
		if (match) return match[1];
	}
	return undefined;
}

function hasImageLine(release: Release): boolean {
	return parseImageLine(release) !== undefined;
}

/** The image the release deployed, if it is safe to deploy again. */
function deployableImage(release: Release): string {
	const image = parseImageLine(release);
	if (image === undefined) {
		throw new Error(
			`Release ${release.tag_name} has no "Deployed image: \`…\`" line. ` +
				"Only releases created with navno-ci release.yml's image input can be deployed again",
		);
	}
	const invalid = `Release ${release.tag_name} records an invalid image "${image}"`;
	if (!IMAGE.test(image)) throw new Error(`${invalid}: it may only contain letters, digits and . _ / @ : -`);
	if (!DIGEST.test(image)) throw new Error(`${invalid}: it must be pinned to a digest, ending in @sha256:<digest>`);
	return image;
}

// GitHub API errors.

/** Awaits an API call. A 404 becomes `notFound` if given; any other failure says which request failed. */
async function request<T>(call: Promise<T>, notFound?: string): Promise<T> {
	try {
		return await call;
	} catch (error) {
		if (!isRequestError(error)) throw error;
		if (error.status === 404 && notFound) throw new Error(notFound);
		const described = describeRequest(error);
		// No response at all, e.g. the connection was refused. Octokit reports those as a 500.
		if (!error.response) throw new Error(`${described} failed: ${error.message}`);
		const hint = error.status === 401 || error.status === 403 ? '. The job needs permissions: contents: read' : '';
		throw new Error(`${described} returned ${error.status}: ${error.message}${hint}`);
	}
}

/** Like `GitHub API GET /repos/owner/repo/releases?per_page=100`. */
function describeRequest(error: RequestError): string {
	const { pathname, search } = new URL(error.request.url);
	return `GitHub API ${error.request.method} ${decodeURIComponent(pathname + search)}`;
}

/** What Octokit throws for a failed request. Recognised by shape: a second copy of the class would fail `instanceof`. */
interface RequestError extends Error {
	status: number;
	request: { method: string; url: string };
	response?: unknown;
}

function isRequestError(error: unknown): error is RequestError {
	return error instanceof Error && 'status' in error && typeof error.status === 'number' && 'request' in error;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

// Log and summary.

async function summarize({ release, sha, newest, skipped }: FoundRelease, image: string): Promise<void> {
	const rows = [
		['Release', releaseLink(release)],
		['Commit', commitLink(sha)],
		['Image', `<code>${image}</code>`],
	];
	if (newest) rows.push(['Newest release', releaseLink(newest)]);
	if (skipped?.length) rows.push(['Skipped, same commit as the newest', skipped.map(releaseLink).join(', ')]);
	core.summary
		.addHeading('Found release', 3)
		.addTable(rows.map(([name, value]) => [{ data: name, header: true }, value]));
	await writeSummary();
}

/** Lists the newest releases in the log and summary. Only warns if that fails too: the error comes first. */
async function reportNewestReleases(getReleases: () => Promise<Release[]>, prefix: string): Promise<void> {
	try {
		const newest = (await getReleases()).slice(0, LISTED_RELEASES);
		if (newest.length === 0) return;
		logReleases(newest, prefix);
		await summarizeReleases(newest, prefix);
	} catch (error) {
		core.warning(`Could not list the ${prefix} releases: ${errorMessage(error)}`);
	}
}

function logReleases(releases: Release[], prefix: string): void {
	core.info(`The newest ${prefix} releases:`);
	for (const release of releases) {
		const image = hasImageLine(release) ? 'has an image line' : 'no image line';
		core.info(`  ${release.tag_name}  published ${release.published_at}  ${image}`);
	}
}

async function summarizeReleases(releases: Release[], prefix: string): Promise<void> {
	core.summary
		.addHeading(`Newest ${prefix} releases`, 3)
		.addTable([
			['Release', 'Published', 'Image line'].map((data) => ({ data, header: true })),
			...releases.map((release) => [
				releaseLink(release),
				release.published_at ?? '',
				hasImageLine(release) ? 'yes' : 'no',
			]),
		]);
	await writeSummary();
}

function releaseLink(release: Release): string {
	return `<a href="${release.html_url}">${release.tag_name}</a>`;
}

function commitLink(sha: string): string {
	const { owner, repo } = github.context.repo;
	return `<a href="${github.context.serverUrl}/${owner}/${repo}/commit/${sha}">${sha}</a>`;
}

/** Outside a runner there is no summary file, and the log already says the same. */
async function writeSummary(): Promise<void> {
	if (process.env.GITHUB_STEP_SUMMARY) await core.summary.write();
}

await run();
