interface McpToolDefinition {
  name: string;
  description: string;
  /** Human-facing one-liner (fleet #1967). Optional; consumers fall back to
   *  description. Kept in step with shared/src/types.ts — scripts/lib/
   *  check-inlined-types.mjs reports drift at publish time. */
  summary?: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    anyOf?: Array<{ required: string[] }>;
    oneOf?: Array<{ required: string[] }>;
    allOf?: Array<{ required: string[] }>;
  };
  outputSchema?: Record<string, unknown>;
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * Was this failure OUR OWN web service? — the other half of `internal-db-class.ts`.
 *
 * fleet #1089 pulled failures from our own Postgres out of `upstream_down` by
 * keying on the SQLSTATE inside PostgREST's four-key error envelope. That
 * covered the majority and structurally could not cover the rest: the rest
 * never reach Postgres, so they carry no SQLSTATE. What was left, measured over
 * the 24h to 2026-09-02T15:00Z (fleet #1096):
 *
 *     5  pipeworx-catalog  get_pack_tools     Pipeworx catalog error: 522 — error code: 522
 *     3  fleet             fleet_list_open …  upstream_down: Fleet task queue did not respond within 25s
 *
 * 521/522/523/526 are Cloudflare saying its edge could not reach an ORIGIN, and
 * in both of those rows the origin is ours — `gateway.pipeworx.io` for the
 * catalog pack (it self-fetches when the gateway hasn't injected a manifest),
 * our own Supabase for fleet. There is no third party anywhere in either call.
 * Same defect as #1089: our own outage filed under `upstream_down`, the one
 * class that means "the source is unreachable and there is nothing for us to
 * fix", which is why the problem-tools triage skips it.
 *
 * WHY NOT A WORDING RULE. The obvious fix is to match `fleet db error:` and
 * `Pipeworx catalog error:` in classifyToolError. Each is emitted from exactly
 * one site today, so it would work today. It would also rot the first time
 * somebody rewords a label — silently, and in the direction of hiding our own
 * outage, which is worse than the bug being fixed. Every prose rule in
 * error-class.ts has needed widening as packs invented new wording (#409/#450/
 * #584); that history is most of that file's comment budget.
 *
 * WHAT THIS KEYS ON INSTEAD: **the host the call actually reached.** A URL's
 * hostname is a fact about the call, not a guess about its prose. Two
 * consequences that a pack-level flag could not give us, and the reason the
 * flag was rejected:
 *
 *   - It describes the CALL, not the pack. `govcon-intel` fans out to our own
 *     Supabase AND to genuine third parties; `court-listener` holds our cache
 *     in Supabase and fetches courtlistener.com. An `internallyHosted: true` on
 *     either pack would relabel a real third-party outage as ours — inventing
 *     work, which is the same class of error in the opposite direction.
 *   - It covers every future internal pack for free, instead of one declared
 *     slug at a time.
 *
 * WHY IT SURVIVES A REWORD. The marker below is not matched as a literal by two
 * separate files. `markInternalOrigin()` writes it and `internalHostMetricsClass()`
 * reads it, both from the single exported `INTERNAL_ORIGIN_MARKER` constant in
 * this module — so changing the wording changes both sides in the same edit and
 * cannot desynchronise them. The pack's own label (`fleet db error:`,
 * `Pipeworx catalog error:`) is not read at all: reword it freely, the class is
 * unaffected. That is the property `stripClassPrefix` lacked when it drifted
 * from its own classifier three times and needed a CI gate to hold them
 * together.
 *
 * WHERE THE 5xx TEST LIVES. `markInternalOrigin` is called from the places that
 * hold the real `Response` — `httpError`/`httpErrorMessage` and the timeout
 * branch of `fetchWithTimeout` in `shared/src/http.ts` — so "is this an
 * availability failure" is decided from the actual status code, never re-derived
 * by scraping a number out of a sentence. A 404 from our own registry for a slug
 * that does not exist is a caller's bad argument and is deliberately NOT marked.
 */

/**
 * OUR OWN web service was unreachable — not an upstream, and never `upstream_down`.
 *
 * ONE value, not three, unlike `internal_db_*`. That split existed because a
 * slow query, an exhausted pool and an unknown SQLSTATE have different owners
 * and different fixes. Here there is only one story to tell — an origin we run
 * did not answer the edge — and one owner. A bucket with no distinct owner per
 * value is decoration; #724 is what happens when a class holds several
 * situations, and inventing sub-values ahead of a reason to act on them
 * differently is the same mistake with the sign flipped.
 *
 * METRICS ONLY, exactly like PLATFORM_KEY_ERROR_CLASS and the internal_db
 * values. `classifyToolError` still answers `upstream_down` for the retry and
 * hint paths, which only care whether retrying or a sibling tool might work —
 * and it might. Nothing a caller sees or is charged changes here.
 *
 * READ SIDE: this value is in BROKEN_TOOL_CLASSES, FAULT_CLASSES and
 * ALL_ERROR_CLASSES in `workers/registry-api/src/index.ts`. All three, or it
 * lands on no dashboard — fleet #721 is the warning, where the #719 split
 * worked on the write side and was invisible for weeks.
 */
const INTERNAL_SERVICE_UNREACHABLE_CLASS = 'internal_service_unreachable';

/**
 * The token that carries "this origin is ours" from the call site to the
 * classifier.
 *
 * Appended to the error message rather than attached to the Error object,
 * because the object does not survive the trip: 275 packs return `{ error:
 * string }` instead of throwing, the gateway reads `observedError` as a string,
 * and the fleet pack rebuilds its error from a captured status + body across a
 * retry loop. A property on an Error would be dropped by every one of those
 * paths and the class would work in tests and vanish in production.
 *
 * WORDING IS LOAD-BEARING, same rule as labelAge's note in authority.ts. This
 * string is appended to a pack's thrown Error message (shared/src/http.ts),
 * and a thrown Error's message is exactly what the gateway hands back to the
 * caller as `content[0].text` when nothing rewrites it (workers/gateway/src
 * catches the throw and sets `rawResult.message = stripClassPrefix(error)`,
 * which does not touch this suffix) — so the original wording,
 * " [pipeworx-hosted origin — our own service, not a third party]", was not a
 * theoretical leak: it shipped live on pipeworx-catalog's 522s, 7 times in 6
 * hours on 2026-09-02 (see tests/golden-internal-service.test.ts), verbatim
 * naming Pipeworx as the host. check:hosting-claims never caught it because it
 * did not scan shared/ at all (task #2009). Reworded to describe the
 * OBSERVATION (the origin did not answer) without a claim about who runs it —
 * the identical fix labelAge got: drop the possessive, keep the fact.
 */
const INTERNAL_ORIGIN_MARKER = ' [origin did not respond — retry before concluding the named source is down]';

/**
 * Supabase's data plane for a project is `<ref>.supabase.co`, where the ref is
 * exactly twenty lowercase letters (ours is `pqauisounztsgdgfkhke`).
 *
 * Matching the shape rather than listing the ref keeps this correct when we add
 * a project — `supabaseEnv` on a pack entry already points some packs at a
 * second one — while still excluding `status.supabase.co`, which is Supabase's
 * own status page and emphatically not our database. Verified 2026-09-02 by
 * `grep -rhoE '[a-z0-9-]+\.supabase\.(co|in)' mcps shared workers scripts`: the
 * only real project ref anywhere in the tree is ours, the rest are doc
 * placeholders (`abc`, `xyz`, `example`) which this pattern also excludes. Same
 * finding internal-db-class.ts relies on for the PostgREST envelope being ours
 * by construction.
 */
const SUPABASE_PROJECT_HOST = /^[a-z]{20}\.supabase\.(co|in)$/;

/**
 * Is this a host WE run?
 *
 * Deliberately NOT including `*.workers.dev`: plenty of third-party APIs are
 * hosted on workers.dev, so the suffix says where something runs and not who
 * owns it. Every internal call we actually make goes to a `pipeworx.io`
 * hostname or to our Supabase project, both of which are ownership facts.
 *
 * `workers/gateway/src/provenance.ts`'s `OUR_HOSTS` answers the same
 * question and DOES include `workers.dev` — a documented divergence
 * (task #2051), not a bug to converge. That list decides what a response may
 * cite as a data SOURCE, where a false negative (citing our own worker as an
 * external source) is the hosting-disclosure leak this whole file exists to
 * prevent, so it errs broad. This one decides who gets BLAMED for a 5xx in
 * outage metrics read by on-call, where a false positive (crediting our own
 * infra with a third party's outage) hides the real failure, so it errs
 * narrow. Same suffix, opposite direction, because they are never called for
 * the same reason.
 *
 * Returns false on anything unparseable rather than throwing — this runs inside
 * an error path, and an error path that can itself throw turns a diagnosable
 * failure into a mystery.
 */
function isPipeworxOrigin(url: string | URL | undefined | null): boolean {
  if (!url) return false;
  let host: string;
  try {
    host = new URL(url instanceof URL ? url.href : url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === 'pipeworx.io' || host.endsWith('.pipeworx.io')) return true;
  return SUPABASE_PROJECT_HOST.test(host);
}

/**
 * Append the marker when this failure was OUR origin failing to answer.
 *
 * `status` is the HTTP status when there is one, and omitted for a timeout —
 * where there is no response at all, and "the origin did not answer" is the
 * whole observation. Statuses below 500 are left alone: a 404 from our own
 * registry for a slug that does not exist is the caller's argument, not our
 * outage, and marking it would put ordinary 404s on the incident dashboard.
 *
 * Idempotent, so a message that is wrapped and re-marked on the way up (the
 * fleet pack's retry loop re-throws through two layers) carries the marker once.
 */
function markInternalOrigin(
  message: string,
  url: string | URL | undefined | null,
  status?: number,
): string {
  if (status !== undefined && status < 500) return message;
  if (!isPipeworxOrigin(url)) return message;
  if (message.includes(INTERNAL_ORIGIN_MARKER)) return message;
  return message + INTERNAL_ORIGIN_MARKER;
}

/**
 * Which blob4 value a failure from our own web services books as, or undefined
 * if this is not one.
 *
 * Ordered AFTER `internalDbMetricsClass` at the call site: a PostgREST envelope
 * from our own Supabase is a strictly more specific statement about the same
 * row (which of our services, and why), and the two cannot disagree about
 * whether the failure is ours.
 */
function internalHostMetricsClass(error: string): string | undefined {
  return error.includes(INTERNAL_ORIGIN_MARKER) ? INTERNAL_SERVICE_UNREACHABLE_CLASS : undefined;
}


/**
 * One place to turn a failed `fetch` into an error a caller can act on.
 *
 * Nearly every pack was written the same way:
 *
 *     if (!res.ok) throw new Error(`Unsplash: ${res.status}`);
 *
 * which discards the response body — and the body is usually where the upstream
 * says what was actually wrong ("**symbol** not found: GBP", "parameter `year`
 * out of range", "unknown taxonomy id"). The caller gets a number, cannot
 * self-correct, and retries the same broken call. A 2026-07-31 sweep found this
 * shape in 481 of 1,400 packs, 47 of them PLATFORM-keyed.
 *
 * It also hides bugs one level down. Two of the first three packs audited had a
 * second defect that only existed because of this line: unsplash's rate-limit
 * branch sat BELOW a catch-all and was unreachable, and bea-gov parsed
 * `BEAAPI.Error.APIErrorDescription` below a `!res.ok` throw that made the
 * parsing dead code for every non-200.
 *
 * DELIBERATELY NOT A CLASSIFIER. It does not add `user_error:` /
 * `upstream_down:` prefixes. Those decide which tier a failure lands in, and the
 * `error` tier is what the daily problem-tools list is built from — it means
 * "Pipeworx has a defect". A 400 is genuinely ambiguous: often a caller's bad
 * argument, but sometimes a query WE built wrong (ted-eu comma-joined its CPV
 * values into something TED rejected, and that bug was found only because it sat
 * in `error`). Blanket-classifying 400s as caller mistakes would have hidden it.
 * A pack that KNOWS which it is should keep saying so explicitly; this helper is
 * for the 481 that say nothing at all.
 */

/** Longest upstream explanation we'll pass through. Enough for a real message,
 *  short enough that an HTML page or a stack trace can't swamp the error. */

const MAX_DETAIL = 300;

/**
 * Default bound for `fetchWithTimeout` when a pack doesn't state its own.
 *
 * 25s mirrors the number `epo-ops` landed on after measuring the real failure:
 * a degraded upstream that doesn't error, it just never answers, and a Worker
 * sits in `await fetch()` until ITS OWN execution budget kills the request —
 * which can take minutes, not seconds (epo_ops_search_patents measured 4-8
 * MINUTE hangs before this existed). 25s is short enough that a caller gets a
 * fast, actionable error instead of holding the connection, and long enough
 * that it doesn't false-trip on a merely-slow-but-alive upstream.
 */
const DEFAULT_FETCH_TIMEOUT_MS = 25_000;

/**
 * Read the body of a failed response and fold it into a throwable Error.
 *
 * Usage — note the `await`, which is the one thing that makes this a mechanical
 * change rather than a drop-in:
 *
 *     if (!res.ok) throw await httpError(res, 'Unsplash');
 *
 * Safe to call on any non-ok response: a body that is missing, empty, unreadable
 * or HTML degrades to exactly the old `Name: 404` string rather than throwing
 * something new from inside the error path.
 */
async function httpError(res: Response, name: string): Promise<Error> {
  return new Error(await httpErrorMessage(res, name));
}

/** The message text without constructing an Error — for packs that need to wrap
 *  it in their own envelope or add an explicit classification prefix. */
async function httpErrorMessage(res: Response, name: string): Promise<string> {
  // The one place a 5xx from a host WE run gets stamped as ours. `res.url` is
  // the URL the fetch actually resolved to (after redirects), so this is a fact
  // about the call rather than a guess from the `name` the pack passed in —
  // reword that label freely, the class does not move. See
  // internal-host-class.ts; no-op for every third-party upstream, which is why
  // this touches 481 packs' error text and changes none of it.
  return markInternalOrigin(
    `${name}: ${res.status}${detailSuffix(await readDetail(res))}`,
    res.url,
    res.status,
  );
}

/**
 * Just the upstream's own explanation — no name, no status.
 *
 * For a pack that has already said both in its own sentence. epo-ops reads
 * `EPO rejected this search as too large (HTTP 413) — ${httpErrorMessage(…)}`,
 * which rendered as `… (HTTP 413) — EPO: 413.` once the XML detail was being
 * dropped: the upstream named twice, the status twice, and the one thing EPO
 * actually said ("Not enough characters before truncation character") nowhere
 * (fleet #712). Returns '' when the body carries nothing readable, so a caller
 * can fall back to its own wording.
 */
async function upstreamDetail(res: Response): Promise<string> {
  return readDetail(res);
}

/**
 * Read a SUCCESSFUL response as JSON, failing loudly when it isn't JSON.
 *
 * `httpError` above only ever runs on `!res.ok`, which leaves the nastier half
 * of the problem unhandled: an upstream that answers **HTTP 200 with an HTML
 * page**. A bot wall, a login redirect, a maintenance interstitial and a CDN
 * error page are all 200s, so `res.ok` is true, and `res.json()` then throws
 * `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`.
 *
 * That string is the problem. It names no upstream, carries no status, and
 * reads like a parser bug in Pipeworx — so it lands in the `error` tier, which
 * means "we have a defect", and the caller is told nothing they can act on.
 * data.govt.nz sat dead behind an Imperva challenge this way and every
 * status-code health check we own reported it green (7889a845). A zero-length
 * body has the same shape: `Unexpected end of JSON input`, seen this week on
 * uk-gazette (83% of external calls) and census.
 *
 * UNLIKE `httpError`, this one DOES classify, and the asymmetry is deliberate.
 * A 400 is genuinely ambiguous — often the caller's bad argument, sometimes a
 * query we built wrong — so blanket-classifying it would hide our own bugs.
 * There is no such ambiguity here: **no argument a caller can pass makes a JSON
 * API return an HTML page.** It is always the upstream, so `upstream_down:` is
 * a statement of fact rather than a guess, and it keeps these out of the
 * problem-tools list where they crowd out real defects.
 *
 *     const data = await parseJson<Feed>(res, 'UK Gazette');
 *
 * Call it only after the `!res.ok` check — on a failed response you want
 * `httpError`, which mines the body for the upstream's own explanation.
 */
async function parseJson<T>(res: Response, name: string): Promise<T> {
  let raw: string;
  try {
    raw = await res.text();
  } catch {
    throw new Error(
      `upstream_down: ${name} returned a body that could not be read (HTTP ${res.status}). ` +
        'The connection most likely dropped mid-response; retrying is reasonable.',
    );
  }

  const type = res.headers.get('content-type') ?? 'no content-type';

  if (!raw.trim()) {
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with an EMPTY body where JSON was expected (${type}). ` +
        'Nothing about the request can cause this — it is an upstream fault, and the same call may well work on retry.',
    );
  }

  // Checked before parsing rather than in the catch, because knowing it is
  // markup is what turns "we failed to parse something" into "they served a
  // web page" — the second is diagnosable, the first is not.
  const head = raw.slice(0, 200).trimStart().toLowerCase();
  if (head.startsWith('<!doctype') || head.startsWith('<html') || head.startsWith('<?xml')) {
    const kind = head.startsWith('<?xml') ? 'an XML document' : 'an HTML page';
    // The summary, not the source. Pasting the first 120 characters of a web
    // page handed the agent `<!DOCTYPE html><html lang="en"…` — the same leak
    // this branch exists to describe (fleet #712).
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with ${kind} instead of JSON (${type}). ` +
        'That is typically a bot wall, a login redirect or a maintenance page — it is returned as a SUCCESS, ' +
        `so status-code health checks read it as fine. No argument change will get past it. ` +
        `The page says: ${summarizeErrorBody(raw) || 'nothing readable'}`,
    );
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with a body that is not valid JSON (${type}). ` +
        `It begins: ${stripMarkup(raw).slice(0, 120) || '(unreadable)'}`,
    );
  }
}

/**
 * `fetch`, but bounded — the fix for a systemic gap found 2026-08-30: a grep
 * audit of every pack's `mcps/*\/src/index.ts` found 1,339 of ~1,500 call
 * `fetch()` with NO timeout guard anywhere in the file. Two of those
 * (epo-ops, statcan) were confirmed live-hanging for 4-8 minutes before this
 * existed — every unguarded call carries the same risk, just unconfirmed.
 *
 * Mirrors the `epoFetch` wrapper `mcps/epo-ops/src/index.ts` shipped first:
 * bound the request with `AbortSignal.timeout`, and on a timeout/abort throw
 * an `upstream_down:` error that names the upstream and the bound rather than
 * letting the raw `TimeoutError`/`AbortError` (which names neither) propagate.
 * `upstream_down:` is deliberate, same reasoning as `parseJson` above — no
 * argument a caller passes can make an upstream hang, so it is always the
 * upstream's fault, and marking it that way keeps a slow API off the
 * problem-tools list where it would crowd out our own defects.
 *
 * Usage — a mechanical swap for a bare `fetch(url, init)`:
 *
 *     const res = await fetchWithTimeout(url, init, 'Some API');
 *
 * Pass `timeoutMs` as a fourth argument to override the default for a pack
 * with a known-slower upstream; the label should be the same short name you'd
 * pass to `httpError`/`httpErrorMessage` for that call.
 */
async function fetchWithTimeout(
  url: string | URL,
  init: RequestInit = {},
  name: string,
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      // States the OBSERVATION (no response in N seconds), not a diagnosis.
      // "appears to be degraded" is an inference about the vendor that we have
      // not checked, and it is wrong in a way that misdirects whoever reads it:
      // a timeout from a Worker can equally mean OUR egress is blocked.
      //
      // Measured today (2026-09-01, fleet #1047): every call to
      // mainnet.base.org failed from the x402 facilitator while the identical
      // request from a laptop returned 200. Base was entirely healthy; the
      // public RPC refuses Cloudflare Worker egress. Had this message fired
      // there it would have blamed Base by name, and the next person would have
      // waited for a vendor outage to clear that did not exist.
      // A timeout has no status to test — there is no response at all — so
      // `markInternalOrigin` is called without one: an origin we run that never
      // answered is an availability failure by definition. This is the half of
      // fleet #1096 with neither a SQLSTATE nor a status code to key on.
      throw new Error(
        markInternalOrigin(
          `upstream_down: ${name} did not respond within ${timeoutMs / 1000}s. ` +
            `That can be ${name} being slow or down, or this environment being unable to reach it ` +
            `(some hosts refuse datacenter/Worker egress) — retry shortly, and check reachability ` +
            `from elsewhere before concluding ${name} is down.`,
          url,
        ),
      );
    }
    throw err;
  }
}

function detailSuffix(detail: string): string {
  return detail ? ` — ${detail}` : '';
}

async function readDetail(res: Response): Promise<string> {
  let raw: string;
  try {
    raw = await res.text();
  } catch {
    // Body already consumed, or the connection died mid-read. The status alone
    // is still worth throwing — never let the error path throw its own error.
    return '';
  }
  return summarizeErrorBody(raw);
}

/**
 * Turn ANY error body — JSON, HTML, XML or plain text — into one short phrase
 * that never contains markup.
 *
 * This used to just drop an HTML or XML body on the floor, on the reasoning
 * that markup crowds out the status. That was half right. Dropping it loses the
 * one sentence a caller could have acted on: an `Access Denied` title, an SDMX
 * `<message:Error>` text, an OPS fault string. A 2026-08-30 support sweep
 * measured 13 of 291 caller-facing error rows carrying a raw page or document
 * verbatim, across 11 packs, and in every one of them the useful content —
 * "Access Denied", "Invalid country code", "SCRAPE_TIMEOUT" — was in there,
 * buried in markup the agent had to parse out of a string (fleet #712).
 *
 * So: extract the meaning, discard the markup. The output is passed through
 * `stripMarkup` unconditionally, which is what lets `check:error-body-leak`
 * assert mechanically that no caller-facing message can contain `<?xml`,
 * `<!DOCTYPE` or `<html`.
 */
function summarizeErrorBody(raw: string): string {
  if (!raw || !raw.trim()) return '';

  const head = raw.slice(0, 400).trimStart().toLowerCase();

  // An HTML error page (Cloudflare interstitial, nginx default, a login
  // redirect) says what it is in its <title>, and almost nowhere else.
  if (head.startsWith('<!doctype') || head.startsWith('<html')) {
    const title = htmlTitle(raw);
    return title
      ? `${title} (upstream returned an HTML error page, not an API response)`
      : 'upstream returned an HTML error page, not an API response';
  }

  // XML fault documents — EPO OPS, SDMX (`<message:Error>`), SOAP faults. The
  // human sentence sits in a child element whose tag name says what it is.
  if (head.startsWith('<?xml') || head.startsWith('<')) {
    const fault = xmlFaultText(raw);
    return fault
      ? `${stripMarkup(fault).slice(0, MAX_DETAIL)} (from the upstream's XML error document)`
      : 'upstream returned an XML error document with no readable message';
  }

  // Most JSON error bodies bury one human sentence among ids and echoed request
  // params. Prefer that sentence; fall back to the whole body when the shape is
  // unfamiliar, since an unfamiliar shape is exactly when we can least afford to
  // guess wrong and show nothing.
  const fromJson = messageFromJson(raw);
  return stripMarkup(fromJson ?? raw).slice(0, MAX_DETAIL);
}

/** The `<title>` of an HTML error page, or its first `<h1>` — the two places a
 *  bot wall, a 502 and an "Access Denied" all state what happened. */
function htmlTitle(raw: string): string | null {
  const head = raw.slice(0, 4000);
  for (const re of [/<title[^>]*>([\s\S]*?)<\/title>/i, /<h1[^>]*>([\s\S]*?)<\/h1>/i]) {
    const m = re.exec(head);
    const text = m ? stripMarkup(m[1]) : '';
    if (text) return text.slice(0, 160);
  }
  return null;
}

/** Tag names that carry the explanation in an XML fault document, namespace
 *  prefix optional (`<message:Error>`, `<com:Text>`, `<faultstring>`). */
const XML_FAULT_TAG_RE =
  /<(?:[A-Za-z0-9_.-]+:)?(?:text|message|description|faultstring|reason|detail|title|errormessage|error)\b[^>]*>([^<]{2,400})</i;

function xmlFaultText(raw: string): string | null {
  const head = raw.slice(0, 8000);
  const tagged = XML_FAULT_TAG_RE.exec(head);
  if (tagged && tagged[1].trim()) return tagged[1];

  // Nothing conventionally named — take the longest text node instead. A fault
  // document with one sentence in an oddly named element is still readable;
  // returning nothing at all is not.
  let best = '';
  for (const m of head.matchAll(/>([^<>]{8,400})</g)) {
    const text = m[1].trim();
    if (text.length > best.length) best = text;
  }
  return best || null;
}

/**
 * Remove every tag and stray angle bracket, then collapse whitespace.
 *
 * Applied to everything on the way out, including the JSON and plain-text
 * paths, because an upstream is free to embed markup in a JSON string field —
 * and a leak is a leak regardless of which branch produced it.
 */
function stripMarkup(s: string): string {
  return collapse(decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/[<>]/g, ' '));
}

/** The handful of entities that show up in error-page titles. Decoded AFTER
 *  tags are stripped and BEFORE the angle-bracket sweep, so `&lt;script&gt;`
 *  in a title cannot decode into markup that survives — EMBL-EBI's ChEMBL 500
 *  page renders as `500 Internal Server Error &lt; EMBL-EBI` otherwise. */
function decodeEntities(s: string): string {
  return s
    .replace(/&(?:amp|#0*38);/gi, '&')
    .replace(/&(?:lt|#0*60);/gi, '<')
    .replace(/&(?:gt|#0*62);/gi, '>')
    .replace(/&(?:quot|#0*34);/gi, '"')
    .replace(/&(?:#0*39|apos|#x0*27);/gi, "'")
    .replace(/&nbsp;/gi, ' ');
}

/** The conventional "what went wrong" field, under any of the names upstreams
 *  actually use. Checked in order; first non-empty string wins. */
const MESSAGE_KEYS = [
  'message', 'error_message', 'errorMessage', 'detail', 'details',
  'description', 'error_description', 'reason', 'title', 'fault',
];

function messageFromJson(raw: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return pickMessage(parsed, 0);
}

function pickMessage(node: unknown, depth: number): string | null {
  // Two levels covers `{error: {message}}` and `{errors: [{detail}]}`, the two
  // shapes that account for nearly all of them, without walking a large payload.
  if (depth > 2 || node == null) return null;

  if (typeof node === 'string') return node.trim() || null;

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = pickMessage(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  if (typeof node !== 'object') return null;
  const obj = node as Record<string, unknown>;

  for (const key of MESSAGE_KEYS) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  // `{error: …}` where error is itself an object or a string — the single most
  // common wrapper, so it is worth descending into by name rather than scanning
  // every key and risking picking up an echoed request parameter.
  for (const key of ['error', 'errors', 'fault', 'Error', 'data']) {
    if (key in obj) {
      const found = pickMessage(obj[key], depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/** Errors are read in a single line of log output; newlines and runs of
 *  whitespace make a multi-line body unreadable there. */
function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}
/**
 * SpaceX MCP — revival of the (dead) SpaceX API.
 *
 * The community "SpaceX API" (api.spacexdata.com, r-spacex/SpaceX-API) was
 * archived 2026-06-06 and its origin now returns TLS 525 — offline. That
 * project was itself an aggregator (jobs/launch-library.js → TheSpaceDevs
 * Launch Library 2; jobs/starlink.js → space-track.org) that reshaped live
 * data into the v4 schema. The sources are alive; only the hosting died.
 *
 * We rehost it on our own infra (the "Zillow pattern"):
 *   - The scraper worker's `spacex_sync` stage calls buildPayloads() on a cron,
 *     reshapes LL2 + CelesTrak to the v4 schema, and upserts into the
 *     `spacex_mirror` Supabase table (see supabase/migrations/043_spacex_mirror.sql).
 *   - This pack reads that mirror FIRST (fast, we own uptime, users never pay
 *     LL2's ~15 req/hr limit) and falls back to a LIVE buildPayloads() call if
 *     the mirror is missing/empty (e.g. before the first sync, or if a cron run
 *     is skipped). The gateway injects _supabaseUrl / _supabaseKey when the pack
 *     is wired with injectSupabase: true.
 *
 * buildPayloads() is the SINGLE source of truth for the v4 schema — imported by
 * the scraper to populate the mirror AND used here for the live fallback.
 *
 * Tools: get_latest_launch, get_next_launch, get_past_launches, get_rockets,
 * get_crew, get_starlink.
 */


// Bound the fetch() calls in this pack that pass no signal of their own — a
// file with one guarded call still reads as "guarded" to the file-level grep
// while its other call sites hang unbounded (fleet #685).
async function pwFetch(url: string | URL, init?: RequestInit): Promise<Response> {
  return fetchWithTimeout(url, init ?? {}, 'SpaceX');
}

const LL2 = 'https://ll.thespacedevs.com/2.2.0';
const SPACEX_PROVIDER = 'SpaceX'; // launch_service_provider (lsp__name) filter
const CELESTRAK_STARLINK =
  'https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=json';

// Mirror storage caps (payloads are pre-capped; the pack slices to the caller's
// requested limit). Sized to cover each tool's max limit.
const CAP_PAST = 100;
const CAP_CREW = 50;
const CAP_STARLINK = 200;

// The spacex_sync cron runs every 6h; anything older than a day means it has
// been failing, so stop trusting the mirror and re-read live.
const MAX_MIRROR_AGE_MS = 24 * 60 * 60 * 1000;

export type SpacexDataset =
  | 'latest_launch'
  | 'next_launch'
  | 'past_launches'
  | 'rockets'
  | 'crew'
  | 'starlink';

const tools: McpToolExport['tools'] = [
  {
    name: 'get_latest_launch',
    description:
      'Get the most recent SpaceX launch. Returns launch name, date (UTC), success status, mission details, rocket, launch pad, and media links (webcast, article, wikipedia).',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_next_launch',
    description:
      'Get the next upcoming SpaceX launch. Returns launch name, scheduled date (UTC, may be TBD), mission details, rocket, and launch pad.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_past_launches',
    description:
      'Get recent past SpaceX launches sorted by date descending. Returns name, date (UTC), status, and success for each launch.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: `Number of launches to return (default 10, max ${CAP_PAST})` },
      },
      required: [],
    },
  },
  {
    name: 'get_rockets',
    description:
      'List SpaceX rocket configurations (Falcon 1, Falcon 9, Falcon Heavy, Starship, …). Returns name, family, reusability, maiden flight, launch cost, launch/success counts, and success rate.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_crew',
    description:
      'List astronauts who have flown (or are assigned to) SpaceX Crew Dragon missions. Returns name, agency, in-flight status, mission, role, wikipedia, and image URL. Derived from recent crewed SpaceX launches.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: `Max crew members to return (default 20, max ${CAP_CREW})` },
      },
      required: [],
    },
  },
  {
    name: 'get_starlink',
    description:
      'Get live Starlink satellites from the public catalog (CelesTrak), sorted by most recent orbital-element epoch. Returns object name, NORAD/COSPAR id, epoch, mean motion, inclination, and eccentricity.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: `Number of satellites to return (default 20, max ${CAP_STARLINK})` },
      },
      required: [],
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const supa = supaFromArgs(args);
  // Gateway-injected Launch Library key (platformKeyEnv). The live fallback runs
  // exactly when the mirror is missing or expired — i.e. the moment we can least
  // afford to be throttled — so it needs the key at least as much as the cron.
  const apiKey = (args._apiKey as string | undefined)?.trim() || undefined;
  switch (name) {
    case 'get_latest_launch':
      return serve('latest_launch', supa, () => buildLatest(apiKey));
    case 'get_next_launch':
      return serve('next_launch', supa, () => buildNext(apiKey));
    case 'get_past_launches':
      return serve('past_launches', supa, () => buildPast(CAP_PAST, apiKey), clampNum(args.limit, 10, 1, CAP_PAST));
    case 'get_rockets':
      return serve('rockets', supa, () => buildRockets(apiKey));
    case 'get_crew':
      return serve('crew', supa, () => buildCrew(CAP_CREW, apiKey), clampNum(args.limit, 20, 1, CAP_CREW));
    case 'get_starlink':
      return serve('starlink', supa, () => buildStarlink(CAP_STARLINK), clampNum(args.limit, 20, 1, CAP_STARLINK));
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ── Serve: mirror-first, live fallback ──────────────────────────────────────

type Supa = { url: string; key: string } | null;

function supaFromArgs(args: Record<string, unknown>): Supa {
  const url = (args._supabaseUrl as string | undefined)?.trim();
  const key = (args._supabaseKey as string | undefined)?.trim();
  return url && key ? { url, key } : null;
}

async function readMirror(dataset: SpacexDataset, supa: Supa): Promise<{ payload: unknown; fetched_at: string } | null> {
  if (!supa) return null;
  try {
    const res = await pwFetch(
      `${supa.url}/rest/v1/spacex_mirror?dataset=eq.${encodeURIComponent(dataset)}&select=payload,fetched_at`,
      { headers: { apikey: supa.key, Authorization: `Bearer ${supa.key}` } },
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as Array<{ payload: unknown; fetched_at: string }>;
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * A mirrored `next_launch` whose date has already passed is not an answer, it's
 * a wrong one: "when is the next SpaceX launch?" answered with a launch from
 * last week ("the next launch has already happened") — seen live on the /try
 * page 2026-07-25. Every other dataset ages gracefully; this one expires the
 * moment the rocket flies, so re-read it live instead of serving the mirror.
 */
function mirrorIsStale(dataset: SpacexDataset, payload: unknown, fetchedAt?: string): boolean {
  // Age check, for every dataset. The cron refreshes 4×/day, so a row older
  // than a day means the sync has been failing — and because a failed dataset
  // keeps its previous row rather than being cleared, nothing else about the
  // response reveals that. past_launches served a 25-day-old payload this way.
  // Re-reading live is a strict improvement: the catch in serve() falls back to
  // this same row if the upstream is down, so the floor is today's behaviour.
  if (fetchedAt) {
    const age = Date.now() - Date.parse(fetchedAt);
    if (Number.isFinite(age) && age > MAX_MIRROR_AGE_MS) return true;
  }
  if (dataset !== 'next_launch') return false;
  const when = (payload as { date_utc?: string; net?: string } | null)?.date_utc
    ?? (payload as { net?: string } | null)?.net;
  if (!when) return true;
  const t = Date.parse(when);
  return !Number.isFinite(t) || t < Date.now();
}

/** Mirror-first, then live. `limit` (when given) slices list payloads. */
async function serve(
  dataset: SpacexDataset,
  supa: Supa,
  live: () => Promise<unknown>,
  limit?: number,
): Promise<unknown> {
  const m = await readMirror(dataset, supa);
  const stale = m ? mirrorIsStale(dataset, m.payload, m.fetched_at) : false;
  if (m && !stale) {
    return { ...slicePayload(dataset, m.payload, limit), _source: 'mirror', _fetched_at: m.fetched_at };
  }
  try {
    const payload = await live();
    return { ...slicePayload(dataset, payload, limit), _source: 'live' };
  } catch (e) {
    // Upstream (Launch Library) throttles hard. A stale mirror row plus an
    // explicit "this already flew" note is a worse answer than live data but a
    // far better one than an error — the reader can still see what we hold and
    // when we held it.
    if (!m) throw e;
    return {
      ...slicePayload(dataset, m.payload, limit),
      _source: 'mirror_stale',
      _fetched_at: m.fetched_at,
      _note:
        'Live upstream is unavailable right now, so this is the last known record — for next_launch that means the launch shown may already have happened. Treat the date as historical, not as the next flight.',
      _upstream_error: e instanceof Error ? e.message : String(e),
    };
  }
}

function slicePayload(dataset: SpacexDataset, payload: unknown, limit?: number): Record<string, unknown> {
  const p = (payload ?? {}) as Record<string, unknown>;
  if (limit == null) return { ...p };
  if (dataset === 'past_launches' && Array.isArray(p.launches)) {
    return { ...p, launches: p.launches.slice(0, limit) };
  }
  if (dataset === 'starlink' && Array.isArray(p.satellites)) {
    return { ...p, satellites: p.satellites.slice(0, limit) };
  }
  if (dataset === 'crew' && Array.isArray(p.crew)) {
    return { ...p, crew: p.crew.slice(0, limit) };
  }
  return { ...p };
}

function clampNum(v: unknown, def: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

// ── Live fetch + shape (single source of truth for the v4 schema) ───────────

const FETCH_TIMEOUT_MS = 12000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function guardedFetch(
  url: string,
  label: string,
  opts: { retries?: number; apiKey?: string } = {},
): Promise<Response> {
  const retries = opts.retries ?? 3;
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      const headers: Record<string, string> = {
        Accept: 'application/json',
        'User-Agent': 'pipeworx-mcp/1.0 (+https://pipeworx.io)',
      };
      // LL2 uses DRF token auth. Anonymous callers get ~15 req/hr scoped to the
      // egress IP — which on Cloudflare is shared with every other Worker on the
      // planet, so in practice the anonymous quota is always already spent.
      if (opts.apiKey) headers.Authorization = `Token ${opts.apiKey}`;
      res = await fetch(url, { signal: controller.signal, headers });
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') {
        throw new Error(`upstream_down: ${label} did not respond within ${FETCH_TIMEOUT_MS}ms.`);
      }
      throw e;
    } finally {
      clearTimeout(t);
    }
    // LL2's unauthenticated limiter is bursty; a short backoff usually clears a
    // 429. Retry a few times before giving up — the cron's 429s were leaving
    // the LL2-backed mirror datasets (launches/rockets/crew) stale.
    if (res.status === 429 && attempt < retries) {
      await sleep(1500 * (attempt + 1)); // 1.5s, 3s, 4.5s
      continue;
    }
    if (res.status === 429) {
      throw new Error(`upstream_throttled: ${label} rate limit hit (HTTP 429).`);
    }
    if (!res.ok) {
      const prefix = res.status >= 500 ? 'upstream_down: ' : '';
      throw new Error(`${prefix}${label} error: HTTP ${res.status}`);
    }
    return res;
  }
}

const ll2Fetch = (url: string, apiKey?: string) =>
  guardedFetch(url, 'Launch Library 2 (ll.thespacedevs.com)', { apiKey });

interface LL2Launch {
  name?: string;
  net?: string;
  status?: { name?: string; abbrev?: string };
  mission?: { description?: string; name?: string; type?: string } | null;
  rocket?: {
    configuration?: { full_name?: string; name?: string };
    spacecraft_stage?: {
      launch_crew?: {
        role?: { role?: string };
        astronaut?: {
          name?: string;
          agency?: { name?: string };
          status?: { name?: string };
          wiki?: string | null;
          image?: { image_url?: string } | null;
          profile_image?: string | null;
        };
      }[];
    } | null;
  };
  pad?: { name?: string; wiki_url?: string | null };
  vidURLs?: { url?: string }[];
  infoURLs?: { url?: string }[];
}

function successFromStatus(abbrev?: string): boolean | null {
  if (abbrev === 'Success') return true;
  if (abbrev === 'Failure' || abbrev === 'Partial Failure') return false;
  return null;
}

function mapLaunch(l: LL2Launch) {
  return {
    name: l.name ?? null,
    date_utc: l.net ?? null,
    status: l.status?.name ?? null,
    success: successFromStatus(l.status?.abbrev),
    details: l.mission?.description ?? null,
    rocket: l.rocket?.configuration?.full_name ?? l.rocket?.configuration?.name ?? null,
    pad: l.pad?.name ?? null,
    links: {
      webcast: l.vidURLs?.[0]?.url ?? null,
      article: l.infoURLs?.[0]?.url ?? null,
      wikipedia: l.pad?.wiki_url ?? null,
    },
  };
}

export async function buildLatest(apiKey?: string) {
  const res = await ll2Fetch(`${LL2}/launch/previous/?lsp__name=${encodeURIComponent(SPACEX_PROVIDER)}&limit=1&mode=detailed`, apiKey);
  const data = (await res.json()) as { results?: LL2Launch[] };
  const l = data.results?.[0];
  return l ? mapLaunch(l) : { found: false, reason: 'no_data' };
}

export async function buildNext(apiKey?: string) {
  const res = await ll2Fetch(`${LL2}/launch/upcoming/?lsp__name=${encodeURIComponent(SPACEX_PROVIDER)}&limit=1&mode=detailed`, apiKey);
  const data = (await res.json()) as { results?: LL2Launch[] };
  const l = data.results?.[0];
  return l ? mapLaunch(l) : { found: false, reason: 'no_data' };
}

export async function buildPast(limit: number, apiKey?: string) {
  const res = await ll2Fetch(
    `${LL2}/launch/previous/?lsp__name=${encodeURIComponent(SPACEX_PROVIDER)}&limit=${limit}&mode=list&ordering=-net`,
    apiKey,
  );
  const data = (await res.json()) as { count?: number; results?: LL2Launch[] };
  return {
    total: data.count ?? null,
    launches: (data.results ?? []).map((l) => ({
      name: l.name ?? null,
      date_utc: l.net ?? null,
      status: l.status?.name ?? null,
      success: successFromStatus(l.status?.abbrev),
    })),
  };
}

interface LL2LauncherConfig {
  full_name?: string;
  name?: string;
  family?: string;
  reusable?: boolean;
  maiden_flight?: string | null;
  launch_cost?: string | null;
  total_launch_count?: number;
  successful_launches?: number;
  failed_launches?: number;
  description?: string | null;
}

export async function buildRockets(apiKey?: string) {
  const res = await ll2Fetch(`${LL2}/config/launcher/?manufacturer__name=${encodeURIComponent(SPACEX_PROVIDER)}&limit=50&mode=detailed`, apiKey);
  const data = (await res.json()) as { results?: LL2LauncherConfig[] };
  return {
    rockets: (data.results ?? []).map((r) => {
      const succ = r.successful_launches ?? 0;
      const fail = r.failed_launches ?? 0;
      const total = succ + fail;
      return {
        name: r.full_name ?? r.name ?? null,
        family: r.family ?? null,
        reusable: r.reusable ?? null,
        maiden_flight: r.maiden_flight ?? null,
        launch_cost_usd: r.launch_cost ? Number(r.launch_cost) : null,
        launch_count: r.total_launch_count ?? total,
        successful_launches: succ,
        failed_launches: fail,
        success_rate_pct: total > 0 ? Math.round((succ / total) * 1000) / 10 : null,
        description: r.description ?? null,
      };
    }),
  };
}

export async function buildCrew(limit: number, apiKey?: string) {
  // Most SpaceX launches are uncrewed (Starlink); scan a wide window of recent
  // PAST launches and harvest crew from the crewed (Dragon) ones, deduped by
  // name. Uses previous/ (past-only) with a 100-launch window (~9 months of
  // SpaceX cadence) so we actually reach a Crew Dragon flight; the /launch/
  // endpoint's default ordering surfaces far-future placeholders instead.
  const res = await ll2Fetch(`${LL2}/launch/previous/?lsp__name=${encodeURIComponent(SPACEX_PROVIDER)}&limit=100&mode=detailed&ordering=-net`, apiKey);
  const data = (await res.json()) as { results?: LL2Launch[] };
  const seen = new Set<string>();
  const crew: Record<string, unknown>[] = [];
  for (const l of data.results ?? []) {
    const roster = l.rocket?.spacecraft_stage?.launch_crew;
    if (!roster?.length) continue;
    for (const c of roster) {
      const a = c.astronaut;
      const nm = a?.name;
      if (!nm || seen.has(nm)) continue;
      seen.add(nm);
      crew.push({
        name: nm,
        agency: a?.agency?.name ?? null,
        status: a?.status?.name ?? null,
        mission: l.name ?? null,
        role: c.role?.role ?? null,
        wikipedia: a?.wiki ?? null,
        image: a?.image?.image_url ?? a?.profile_image ?? null,
      });
      if (crew.length >= limit) break;
    }
    if (crew.length >= limit) break;
  }
  return { crew };
}

interface CelestrakGP {
  OBJECT_NAME?: string;
  OBJECT_ID?: string;
  NORAD_CAT_ID?: number;
  EPOCH?: string;
  MEAN_MOTION?: number;
  INCLINATION?: number;
  ECCENTRICITY?: number;
}

// Starlink source note: the original SpaceX API's jobs/starlink.js pulled from
// space-track.org (official US catalog, free account, programmatic-friendly).
// CelesTrak works keyless but aggressively IP-blocks repeated/bulk access, so
// it's a best-effort source only. When SPACETRACK_USER/PASS secrets are set on
// the scraper, spacex_sync should prefer Space-Track (see TODO in the scraper).
// The pack's live fallback stays on CelesTrak (packs aren't given those creds).
export async function buildStarlink(limit: number) {
  const res = await guardedFetch(CELESTRAK_STARLINK, 'CelesTrak (celestrak.org)');
  const data = (await res.json()) as CelestrakGP[];
  const sorted = [...data].sort((a, b) => (Date.parse(b.EPOCH ?? '') || 0) - (Date.parse(a.EPOCH ?? '') || 0));
  return {
    total: data.length,
    satellites: sorted.slice(0, limit).map((s) => ({
      OBJECT_NAME: s.OBJECT_NAME ?? null,
      OBJECT_ID: s.OBJECT_ID ?? null,
      NORAD_CAT_ID: s.NORAD_CAT_ID ?? null,
      EPOCH: s.EPOCH ?? null,
      MEAN_MOTION: s.MEAN_MOTION ?? null,
      INCLINATION: s.INCLINATION ?? null,
      ECCENTRICITY: s.ECCENTRICITY ?? null,
    })),
  };
}

/**
 * Build the six mirror payloads from live sources. Called by the scraper's
 * spacex_sync stage to populate `spacex_mirror`. Payloads are pre-capped to the
 * per-dataset storage caps; the pack slices to the caller's requested limit.
 *
 * Resilient by design: each dataset is fetched independently (allSettled) so a
 * single failing source — e.g. CelesTrak IP-blocking the Starlink pull — never
 * drops the other five. Returns only the datasets that succeeded; the caller
 * upserts those and reports the rest as failed.
 */
export async function buildPayloads(apiKey?: string): Promise<{
  ok: Partial<Record<SpacexDataset, unknown>>;
  failed: { dataset: SpacexDataset; error: string }[];
}> {
  const ok: Partial<Record<SpacexDataset, unknown>> = {};
  const failed: { dataset: SpacexDataset; error: string }[] = [];
  const record = (dataset: SpacexDataset, r: PromiseSettledResult<unknown>) => {
    if (r.status === 'fulfilled') ok[dataset] = r.value;
    else failed.push({ dataset, error: r.reason instanceof Error ? r.reason.message : String(r.reason) });
  };

  // Starlink is Space-Track (a different host) — run it alongside the LL2 work.
  const starlinkP = buildStarlink(CAP_STARLINK);

  // The 5 LL2 datasets run SEQUENTIALLY with a small gap. Firing all 5 at once
  // tripped LL2's burst limiter every cron run (429), leaving launches/rockets/
  // crew stale while only Starlink refreshed. One-at-a-time + the 429 backoff in
  // guardedFetch keeps the cron under the limit. Latency is irrelevant here —
  // only the cron calls buildPayloads (the gateway live-fallback calls the
  // individual builders directly).
  //
  // Spacing alone was never enough, though: without `apiKey` these calls are
  // anonymous, and LL2's anonymous quota is per egress IP — which Cloudflare
  // shares across every Worker, so it is effectively always spent no matter how
  // politely we pace. Starlink kept refreshing only because it comes from
  // Space-Track/CelesTrak, whose credentials the scraper already had. Pass the
  // Launch Library key and these five stop starving.
  const ll2Builders: [SpacexDataset, () => Promise<unknown>][] = [
    ['latest_launch', () => buildLatest(apiKey)],
    ['next_launch', () => buildNext(apiKey)],
    ['past_launches', () => buildPast(CAP_PAST, apiKey)],
    ['rockets', () => buildRockets(apiKey)],
    ['crew', () => buildCrew(CAP_CREW, apiKey)],
  ];
  for (const [dataset, fn] of ll2Builders) {
    record(dataset, await Promise.allSettled([fn()]).then((s) => s[0]));
    await sleep(500);
  }
  record('starlink', await Promise.allSettled([starlinkP]).then((s) => s[0]));

  return { ok, failed };
}

export default { tools, callTool, meter: { credits: 2 } } satisfies McpToolExport;
