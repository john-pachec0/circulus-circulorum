#!/usr/bin/env node
// One-shot LinkedIn OAuth bootstrap. Zero dependencies, Node 24.
//
//   LI_CLIENT_ID=... LI_CLIENT_SECRET=... node scripts/oauth-bootstrap.mjs
//
// Serves http://localhost:8721/callback once, exchanges the code, and prints
// what to store. Its real job is step 4 of quickstart.md §A: reporting whether
// LinkedIn issued a refresh_token at all (research.md §3). Everything else is
// plumbing around that one fact.
//
// Nothing is written to disk. Secrets go to stdout for you to paste into
// `gh secret set` — never into a file in this public repo.

import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';

const PORT = 8721;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
const SCOPES = 'openid profile w_member_social';
const AUTH_URL = 'https://www.linkedin.com/oauth/v2/authorization';
const TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
const USERINFO_URL = 'https://api.linkedin.com/v2/userinfo';
const TIMEOUT_MS = 5 * 60_000;

const DAY = 86_400;
const days = (s) => (typeof s === 'number' ? `${Math.round(s / DAY)} days` : '(not reported)');

/**
 * The load-bearing branch: did LinkedIn authorise this app for programmatic
 * refresh tokens? Pure so it can be self-tested without a network round trip.
 */
export function summarize(tok) {
  const hasRefresh = typeof tok.refresh_token === 'string' && tok.refresh_token.length > 0;
  return {
    hasRefresh,
    accessTtl: days(tok.expires_in),
    refreshTtl: hasRefresh ? days(tok.refresh_token_expires_in) : null,
    scopes: (tok.scope ?? '').split(/[\s,]+/).filter(Boolean),
    // quickstart.md §B: presence is suggestive, the probe is ground truth.
    feedScope: (tok.scope ?? '').includes('w_member_social_feed'),
    secretName: hasRefresh ? 'LI_REFRESH_TOKEN' : 'LI_ACCESS_TOKEN',
    secretValue: hasRefresh ? tok.refresh_token : tok.access_token,
  };
}

async function postForm(url, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`${url} -> ${res.status}\n${body}`);
  return JSON.parse(body);
}

function awaitCode(state) {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${PORT}`);
      if (url.pathname !== '/callback') return res.writeHead(404).end();

      const done = (msg, err) => {
        res.writeHead(err ? 400 : 200, { 'Content-Type': 'text/html' });
        res.end(`<!doctype html><meta charset=utf-8><body style="font:16px system-ui;padding:3rem">
          <p>${err ?? msg}</p><p>You can close this tab and return to the terminal.</p>`);
        server.close();
        clearTimeout(timer);
        err ? reject(new Error(err)) : resolve(msg && url.searchParams.get('code'));
      };

      const err = url.searchParams.get('error');
      if (err) return done(null, `${err}: ${url.searchParams.get('error_description') ?? ''}`);
      // Cheap, but this is a credential boundary and the check is one line.
      if (url.searchParams.get('state') !== state) return done(null, 'state mismatch — aborting');
      if (!url.searchParams.get('code')) return done(null, 'no code in callback');
      done('Authorised.');
    });

    const timer = setTimeout(() => {
      server.close();
      reject(new Error(`no callback within ${TIMEOUT_MS / 60_000} minutes`));
    }, TIMEOUT_MS);

    server.listen(PORT);
  });
}

async function main() {
  const clientId = process.env.LI_CLIENT_ID;
  const clientSecret = process.env.LI_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error('Set LI_CLIENT_ID and LI_CLIENT_SECRET (Auth tab of your LinkedIn app).');
    process.exit(1);
  }

  const state = randomBytes(16).toString('hex');
  // URLSearchParams encodes spaces as '+'. Legal, but LinkedIn's own examples
  // use %20 and some OAuth servers mishandle '+' in `scope`. This URL is opened
  // exactly once, by hand, and a failure here is maximally confusing — so pay
  // the one replace rather than debug it live.
  const authorize = `${AUTH_URL}?${new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    state,
  })}`.replace(/\+/g, '%20');

  console.log(`\nRedirect URL registered in the app must be exactly:\n  ${REDIRECT_URI}\n`);
  console.log(`Open this, approve, then come back:\n\n  ${authorize}\n`);

  const code = await awaitCode(state);
  const tok = await postForm(TOKEN_URL, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const s = summarize(tok);

  const userinfo = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${tok.access_token}` },
  });
  if (!userinfo.ok) throw new Error(`userinfo -> ${userinfo.status} ${await userinfo.text()}`);
  const memberUrn = `urn:li:person:${(await userinfo.json()).sub}`;

  console.log('\n' + '='.repeat(70));
  if (s.hasRefresh) {
    console.log('REFRESH TOKEN: ISSUED. Access %s, refresh %s.', s.accessTtl, s.refreshTtl);
    console.log('research.md open question 2 answered: the automated path works.');
  } else {
    console.log('REFRESH TOKEN: *** NOT ISSUED ***  (access token only, %s)', s.accessTtl);
    console.log('research.md §3 — this app is not authorised for programmatic refresh');
    console.log('tokens. Fallback per FR-033: store LI_ACCESS_TOKEN and re-mint by hand');
    console.log('before it expires. Everything else is unchanged.');
  }
  console.log('\nGranted scopes: %s', s.scopes.join(' ') || '(none reported)');
  console.log(
    s.feedScope
      ? 'w_member_social_feed IS present — the quickstart §B probe should return 201.'
      : 'w_member_social_feed absent. Suggestive, NOT decisive — run the §B probe.',
  );
  console.log('='.repeat(70));

  console.log('\nStore these (nothing was written to disk):\n');
  console.log(`  gh secret set LI_CLIENT_ID     --body '${clientId}'`);
  console.log(`  gh secret set LI_CLIENT_SECRET --body '${clientSecret}'`);
  console.log(`  gh secret set LI_MEMBER_URN    --body '${memberUrn}'`);
  console.log(`  gh secret set ${s.secretName.padEnd(16)} --body '${s.secretValue}'`);
  if (!s.hasRefresh) {
    const minted = new Date().toISOString().slice(0, 10);
    console.log(`  gh variable set LI_TOKEN_MINTED  --body '${minted}'   # plan.md §7.7 step 4`);
  }

  console.log('\nNow run the permission probe (quickstart.md §B) with:\n');
  console.log(`  TOKEN='${tok.access_token}'`);
  console.log(`  MEMBER='${memberUrn}'`);
  console.log('  VER=202608\n');
}

// ponytail: one self-check on the only branch that matters — whether the
// "no refresh token" case is reported rather than silently treated as fine.
if (process.argv.includes('--selftest')) {
  const { strict: assert } = await import('node:assert');
  const withR = summarize({
    access_token: 'a', expires_in: 5184000,
    refresh_token: 'r', refresh_token_expires_in: 31536000, scope: 'openid profile w_member_social',
  });
  assert.equal(withR.hasRefresh, true);
  assert.equal(withR.secretName, 'LI_REFRESH_TOKEN');
  assert.equal(withR.secretValue, 'r');
  assert.equal(withR.accessTtl, '60 days');
  assert.equal(withR.refreshTtl, '365 days');
  assert.equal(withR.feedScope, false);

  const noR = summarize({ access_token: 'a', expires_in: 5184000, scope: 'w_member_social_feed' });
  assert.equal(noR.hasRefresh, false);
  assert.equal(noR.refreshTtl, null);
  assert.equal(noR.secretName, 'LI_ACCESS_TOKEN');
  assert.equal(noR.secretValue, 'a', 'must fall back to the access token, not undefined');
  assert.equal(noR.feedScope, true);

  // Non-vacuity: the two fixtures must actually differ on the branch under test.
  assert.notEqual(withR.hasRefresh, noR.hasRefresh);
  assert.notEqual(withR.secretName, noR.secretName);
  console.log('selftest ok');
} else {
  main().catch((e) => {
    console.error('\n' + e.message);
    process.exit(1);
  });
}
