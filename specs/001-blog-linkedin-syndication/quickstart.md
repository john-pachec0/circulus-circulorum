# Quickstart — LinkedIn authorisation and the permission probe

Two procedures, both one-time, both run locally by the author. The bootstrap
answers `research.md` open question 2 for free; the probe answers open
question 1, and Phase 4 is not done until it has run.

---

## A. OAuth bootstrap

~10 minutes. Steps 3–6 are automated by `scripts/oauth-bootstrap.mjs`.

### 1. Create the app

<https://www.linkedin.com/developers/apps> → **Create app**.

LinkedIn requires the app be associated with a LinkedIn **Page** you
administer, verified by a link a Page admin clicks. **If you have no Page you
will have to create one.** This is unavoidable and it is the one step that
genuinely requires logging in to LinkedIn — after this, never again.

### 2. Add products and the redirect URL

Products tab → add both, each granted immediately, no approval:

- **Share on LinkedIn** → grants `w_member_social`
- **Sign In with LinkedIn using OpenID Connect** → grants `openid`, `profile`

Auth tab → add redirect URL: `http://localhost:8721/callback`

Copy the Client ID and Client Secret.

### 3. Run the bootstrap

```bash
LI_CLIENT_ID=… LI_CLIENT_SECRET=… node scripts/oauth-bootstrap.mjs
```

It starts a one-shot `node:http` server on port 8721 and prints an authorize
URL of the form:

```
https://www.linkedin.com/oauth/v2/authorization
  ?response_type=code
  &client_id=…
  &redirect_uri=http%3A%2F%2Flocalhost%3A8721%2Fcallback
  &scope=openid%20profile%20w_member_social
  &state=…
```

Open it, approve. The server catches `?code=` and shuts down.

### 4. Read the exchange output — this is a test, not just output

The script exchanges the code (`grant_type=authorization_code`) and prints:

- `access_token` and `expires_in`
- **`refresh_token` and `refresh_token_expires_in` — or a loud notice that no
  refresh token was issued.** That one line answers `research.md` §3. No
  refresh token means the fallback path: store `LI_ACCESS_TOKEN` instead and
  re-mint every 60 days.
- **`scope` as actually granted.** Cross-check against §B. If
  `w_member_social_feed` appears here, the probe below will pass. Its absence
  is suggestive but not decisive.

### 5. Member URN

The script calls `GET https://api.linkedin.com/v2/userinfo` with the access
token. The `sub` claim is the person id ⇒ `urn:li:person:<sub>`.

### 6. Store the secrets

The script prints these; nothing is written to a file and nothing is echoed
into the repo.

```bash
gh secret set LI_CLIENT_ID     --body '…'
gh secret set LI_CLIENT_SECRET --body '…'
gh secret set LI_MEMBER_URN    --body 'urn:li:person:…'

# one of these two, per step 4:
gh secret set LI_REFRESH_TOKEN --body '…'
gh secret set LI_ACCESS_TOKEN  --body '…'

gh variable set LI_LINK_STRATEGY --body 'comment'   # revisit after §B
```

Re-authorisation in ~365 days (or ~60 in fallback mode) is this same procedure
from step 3.

---

## B. The permission probe

Settles `research.md` §2: can a `w_member_social` token create a comment, or is
`w_member_social_feed` / Community Management approval genuinely required?

**Read this first.** The probe creates a real, public LinkedIn post and deletes
it seconds later. There is a window where it is visible on your profile. Since
you do not use LinkedIn and will not be watching it, saying so plainly rather
than burying it.

```bash
set -euo pipefail

TOKEN='<access token from step 4>'
MEMBER='urn:li:person:XXXXXXXX'
VER=202608
H=(-H "Authorization: Bearer $TOKEN" -H 'X-Restli-Protocol-Version: 2.0.0'
   -H "LinkedIn-Version: $VER" -H 'Content-Type: application/json')

# 1 — throwaway post; the URN comes back in the x-restli-id header
CODE=$(curl -sS -D /tmp/li.h -o /tmp/li.b -w '%{http_code}' \
  -X POST 'https://api.linkedin.com/rest/posts' "${H[@]}" \
  --data "{\"author\":\"$MEMBER\",\"commentary\":\"API permission probe. Deleting this in a few seconds.\",\"visibility\":\"PUBLIC\",\"distribution\":{\"feedDistribution\":\"MAIN_FEED\",\"targetEntities\":[],\"thirdPartyDistributionChannels\":[]},\"lifecycleState\":\"PUBLISHED\",\"isReshareDisabledByAuthor\":false}")

# GUARD — without this, a failed step 1 produces an empty URN, step 2 POSTs to
# .../socialActions//comments, gets a meaningless 404, and the table below
# would tell you to keep the `comment` strategy on no evidence at all.
if [ "$CODE" != "201" ]; then
  echo "step 1 did not create a post (HTTP $CODE). Not a permission answer." >&2
  cat /tmp/li.b >&2
  echo "Check: products added, token scopes, LinkedIn-Version=$VER, member URN." >&2
  exit 1
fi

URN=$(grep -i '^x-restli-id:' /tmp/li.h | tr -d '\r' | awk '{print $2}')
[ -n "$URN" ] || { echo "201 but no x-restli-id — cannot probe or clean up." >&2; exit 1; }
ID=${URN##*:}
ENC=$(printf %s "$URN" | sed 's/:/%3A/g')
echo "URN=$URN"

# 2 — THE TEST: can this token comment?
curl -sS -w '\nHTTP %{http_code}\n' -X POST \
  "https://api.linkedin.com/rest/socialActions/$ENC/comments" "${H[@]}" \
  --data "{\"actor\":\"$MEMBER\",\"object\":\"$URN\",\"message\":{\"text\":\"probe\"}}"

# 2b — ONLY if step 2 returned 400 or 404: the activity-URN form
curl -sS -w '\nHTTP %{http_code}\n' -X POST \
  "https://api.linkedin.com/rest/socialActions/urn%3Ali%3Aactivity%3A$ID/comments" "${H[@]}" \
  --data "{\"actor\":\"$MEMBER\",\"object\":\"urn:li:activity:$ID\",\"message\":{\"text\":\"probe\"}}"

# 3 — clean up, always
curl -sS -w 'delete HTTP %{http_code}\n' -X DELETE \
  "https://api.linkedin.com/rest/posts/$ENC" "${H[@]}" -H 'X-RestLi-Method: DELETE'
```

### Reading the result

| Response to step 2 (or 2b) | Meaning | Action |
|---|---|---|
| `201` + `x-restli-id` | `w_member_social` covers commenting | keep `LI_LINK_STRATEGY=comment` |
| `403 ACCESS_DENIED` | needs `w_member_social_feed` / Community Management | `gh variable set LI_LINK_STRATEGY --body 'article'` |
| `400`/`404` on 2, `201` on 2b | share-URN form rejected, activity form accepted | keep `comment` — the built-in fallback (plan §7.5) handles it |
| `429` | rate limit, not a permission answer | wait a minute, re-run |
| `401`, or step 1 aborted by the guard | the probe never ran | fix products/scopes/version and re-run — **do not** read this as an answer |

Whatever the outcome, record it in `spec.md` under Adversarial Review or in the
Phase 4 task notes — it is the fact the phase was blocked on.

---

## C. Local dry run

No credentials, no network. Run before every push that touches a syndicated
post:

```bash
npm run dry-run
```

Prints the exact outbound URLs and JSON bodies, and exits non-zero on any
validation failure (FR-034). Inspect the escaped `commentary` by eye the first
few times — it is the one transform the author never sees in the source.
