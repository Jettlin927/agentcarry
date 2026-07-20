# Benchmark fixture sanitization

Benchmark fixtures must be synthetic or irreversibly sanitized before commit.
Passing the automated scan is necessary but not sufficient; every fixture also
requires human review.

## Never commit

- API keys, access tokens, cookies, passwords, private keys, or credentials;
- real user home paths, usernames, email addresses, hostnames, or IP addresses;
- proprietary repository source or transcript text;
- Git remotes or issue links from private projects;
- opaque tool output that has not been reviewed field by field.

## Synthetic fixtures

Prefer synthetic fixtures. Mark `sanitization.synthetic` true and
`humanReviewed` true. Use obvious placeholders such as `C:\Users\dev`,
`/Users/dev`, `example.com`, and repository names created for the benchmark.

## Sanitized fixtures

For a fixture derived from a real session:

1. replace names, paths, repository contents, remotes, and identifiers;
2. preserve only the event shape and continuity challenge being tested;
3. set `synthetic` false, add the reviewer name, and store only a SHA-256
   fingerprint of the private source—not its location or content;
4. run `npm run benchmark:validate`;
5. manually inspect the complete diff before commit.

## Automated high-confidence checks

The validator rejects common OpenAI/Anthropic/GitHub tokens, AWS access key IDs,
private-key headers, bearer tokens, and credential-bearing URLs. It reports only
the finding type and JSON location, never the matched value.

False negatives remain possible. Do not treat the scanner as a privacy guarantee.

