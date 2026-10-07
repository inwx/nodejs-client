'use strict';

const { afterEach, describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { ApiClient, Language } = require('../lib');
const { version } = require('../package.json');

const originalFetch = globalThis.fetch;
const TFA_ERROR = 'API requests two factor challenge but no shared secret is given. Aborting.';
const SHARED_SECRET = 'JBSWY3DPEHPK3PXP';
const SET_COOKIE = 'domrobot=abc; Path=/; HttpOnly';

let calls = [];

function jsonResponse(data, init) {
    return new Response(JSON.stringify(data), init);
}

// Replaces fetch with a recorder. Each call takes the next queued Response, or throws a queued Error.
// When the queue is empty, the recorder answers with code 1000.
function stubFetch(...responses) {
    calls = [];
    globalThis.fetch = async (url, options) => {
        calls.push({ url, options, body: JSON.parse(options.body) });
        const next = responses.shift() ?? jsonResponse({ code: 1000, msg: 'Command completed successfully' });
        if (next instanceof Error) {
            throw next;
        }
        return next;
    };
}

function loginResponse(data, setCookies = [SET_COOKIE]) {
    return jsonResponse(data, { headers: setCookies.map((cookie) => ['Set-Cookie', cookie]) });
}

afterEach(() => {
    globalThis.fetch = originalFetch;
});

describe('callApi() request', () => {
    test('sends the method and the parameters, with no lang and no clTRID by default', async () => {
        stubFetch();
        const client = new ApiClient(ApiClient.API_URL_OTE, Language.DE);
        await client.callApi('domain.check', { domain: 'example.com' });
        await client.callApi('domain.check', { domain: 'example.com' });

        assert.equal(calls[0].url, ApiClient.API_URL_OTE);
        assert.equal(calls[0].options.method, 'POST');
        assert.deepEqual(calls[0].body, { method: 'domain.check', params: { domain: 'example.com' } });
        assert.equal(calls[0].options.body, calls[1].options.body);
    });

    test('sends the parameters as given', async () => {
        class Params {
            toJSON() {
                return { domain: 'EXAMPLE.COM' };
            }
        }
        stubFetch();
        const client = new ApiClient();
        await client.callApi('domain.check', new Params());
        await client.callApi('domain.check', ['example.com']);

        assert.deepEqual(calls[0].body.params, { domain: 'EXAMPLE.COM' });
        assert.deepEqual(calls[1].body.params, ['example.com']);
    });

    // The behaviour of 3.3.0 and earlier. A change of it changes the requests of all package users.
    test('uses clientTransactionId and language only for keys that methodParams already has', async () => {
        stubFetch();
        const client = new ApiClient(ApiClient.API_URL_OTE, Language.DE);
        await client.callApi('domain.check', { domain: 'example.com' }, 'my-id', Language.ES);
        await client.callApi('domain.check', { clTRID: 'own-id', lang: 'en' }, 'my-id', Language.ES);
        await client.callApi('domain.check', { clTRID: 'own-id', lang: 'en' });
        await client.callApi('domain.check', { clTRID: 'own-id' }, null);

        assert.deepEqual(calls[0].body.params, { domain: 'example.com' });
        assert.deepEqual(calls[1].body.params, { clTRID: 'my-id', lang: 'es' });
        assert.match(calls[2].body.params.clTRID, /^DomRobot-\d+$/);
        assert.equal(calls[2].body.params.lang, 'de');
        assert.deepEqual(calls[3].body.params, { clTRID: 'own-id' });
    });

    test('passes the cache option and the nextjsOptions to fetch', async () => {
        stubFetch();
        const signal = new AbortController().signal;
        await new ApiClient().callApi('domain.check', {}, undefined, undefined, 'force-cache', {
            next: { revalidate: 300 },
            signal,
        });
        await new ApiClient().callApi('domain.check', {});

        assert.deepEqual(calls[0].options.next, { revalidate: 300 });
        assert.equal(calls[0].options.signal, signal);
        assert.equal(calls[0].options.cache, 'force-cache');
        assert.equal(calls[1].options.cache, 'default');
    });

    test('nextjsOptions replace all supplied fetch options, including the complete headers', async () => {
        stubFetch();
        const options = {
            method: 'PUT',
            headers: { 'X-Custom': 'replacement' },
            body: JSON.stringify({ method: 'domain.info', params: { domain: 'example.com' } }),
            cache: 'reload',
        };
        const client = new ApiClient();
        client.setCookie('domrobot=abc');
        await client.callApi('domain.check', {}, undefined, undefined, 'no-store', options);

        assert.deepEqual(calls[0].options, options);
    });
});

describe('callApi() headers', () => {
    test('sends no Cookie header when the client has no cookie', async () => {
        stubFetch();
        const client = new ApiClient();
        await client.callApi('domain.check', {});
        client.setCookie(undefined);
        await client.callApi('domain.check', {});

        assert.equal(calls[0].options.headers.has('cookie'), false);
        assert.equal(calls[1].options.headers.has('cookie'), false);
        assert.equal(calls[0].options.headers.get('content-type'), 'application/json');
    });

    test('sends a cookie from setCookie() unchanged', async () => {
        stubFetch();
        const client = new ApiClient();
        client.setCookie(SET_COOKIE);
        await client.callApi('domain.check', {});

        assert.equal(calls[0].options.headers.get('cookie'), SET_COOKIE);
    });

    test('sends the custom headers of the client', async () => {
        stubFetch();
        const client = new ApiClient(ApiClient.API_URL_OTE, Language.EN, false, { 'X-Test': '1' });
        await client.callApi('domain.check', {});
        client.setHeaders({ 'User-Agent': 'my-agent/1.0' });
        await client.callApi('domain.check', {});

        assert.equal(calls[0].options.headers.get('x-test'), '1');
        assert.equal(calls[1].options.headers.get('user-agent'), 'my-agent/1.0');
    });

    test('sends CLIENT_VERSION, which equals the package version, in the User-Agent', async () => {
        stubFetch();
        await new ApiClient().callApi('domain.check', {});

        assert.equal(ApiClient.CLIENT_VERSION, version);
        assert.equal(calls[0].options.headers.get('user-agent'), `DomRobot/${version} (Node ${process.version})`);
    });
});

describe('callApi() responses', () => {
    test('rejects a response that is not JSON with a SyntaxError that contains the method and the status', async () => {
        stubFetch(new Response('<html>Bad Gateway</html>', { status: 502, statusText: 'Bad Gateway' }));

        await assert.rejects(new ApiClient().callApi('domain.check', {}), (error) => {
            assert.ok(error instanceof SyntaxError);
            assert.match(error.message, /domain\.check/);
            assert.match(error.message, /502 Bad Gateway/);
            assert.ok(error.cause instanceof SyntaxError);
            return true;
        });
    });

    test('resolves a JSON response with an HTTP error status', async () => {
        stubFetch(jsonResponse({ code: 2400, msg: 'Command failed' }, { status: 500 }));

        assert.deepEqual(await new ApiClient().callApi('domain.check', {}), { code: 2400, msg: 'Command failed' });
    });

    test('passes an error of fetch to the caller unchanged', async () => {
        const networkError = new TypeError('fetch failed');
        stubFetch(networkError);

        await assert.rejects(new ApiClient().callApi('domain.check', {}), networkError);
    });

    test('debug mode prints the request and the response, with pass and tan masked', async (t) => {
        const lines = [];
        t.mock.method(console, 'info', (message) => lines.push(message));
        stubFetch(
            loginResponse({ code: 1000, resData: { tfa: 'GOOGLE-AUTH' } }),
            jsonResponse({ code: 1000, msg: 'unlocked' }),
        );
        const client = new ApiClient(ApiClient.API_URL_OTE, Language.EN, true);
        await client.login('user', 'secret-password', SHARED_SECRET);

        assert.deepEqual(lines, [
            'Request (account.login): {"method":"account.login","params":{"user":"user","pass":"***"}}',
            'Response (account.login): {"code":1000,"resData":{"tfa":"GOOGLE-AUTH"}}',
            'Request (account.unlock): {"method":"account.unlock","params":{"tan":"***"}}',
            'Response (account.unlock): {"code":1000,"msg":"unlocked"}',
        ]);
        assert.equal(calls[0].body.params.pass, 'secret-password');
        assert.match(calls[1].body.params.tan, /^\d{6}$/);
    });
});

describe('login()', () => {
    test('sends user and pass and stores the Set-Cookie value of the response', async () => {
        const loginData = { code: 1000, msg: 'logged in', resData: { tfa: '0' } };
        stubFetch(loginResponse(loginData));
        const client = new ApiClient(ApiClient.API_URL_OTE, Language.DE);
        const result = await client.login('user', 'secret');
        await client.callApi('account.info');

        assert.deepEqual(calls[0].body, { method: 'account.login', params: { user: 'user', pass: 'secret' } });
        assert.deepEqual(result, loginData);
        assert.equal(client.getCookie(), SET_COOKIE);
        assert.equal(calls[1].options.headers.get('cookie'), SET_COOKIE);
    });

    test('replaces the cookie with null when the login response has no Set-Cookie header', async () => {
        const loginData = { code: 2200, msg: 'Authentication error' };
        stubFetch(loginResponse(loginData, []));
        const client = new ApiClient();
        client.setCookie('old=1');

        assert.deepEqual(await client.login('user', 'wrong'), loginData);
        assert.equal(client.getCookie(), null);
    });

    test('calls account.unlock with a TAN and returns the login response', async () => {
        const loginData = { code: 1000, msg: 'logged in', resData: { tfa: 'GOOGLE-AUTH' } };
        stubFetch(loginResponse(loginData), jsonResponse({ code: 1000 }));
        const client = new ApiClient();
        const result = await client.login('user', 'secret', SHARED_SECRET);

        assert.equal(calls[1].body.method, 'account.unlock');
        assert.match(calls[1].body.params.tan, /^\d{6}$/);
        assert.equal(calls[1].options.headers.get('cookie'), SET_COOKIE);
        assert.deepEqual(result, loginData);
    });

    test('returns the unlock response when the unlock fails and keeps the cookie', async () => {
        const unlockData = { code: 2200, msg: 'Authentication error' };
        stubFetch(loginResponse({ code: 1000, resData: { tfa: 'GOOGLE-AUTH' } }), jsonResponse(unlockData));
        const client = new ApiClient();
        const result = await client.login('user', 'secret', SHARED_SECRET);

        assert.deepEqual(result, unlockData);
        assert.equal(client.getCookie(), SET_COOKIE);
    });

    for (const sharedSecret of [null, undefined]) {
        test(`rejects with a string and makes no unlock call for the secret ${sharedSecret}`, async () => {
            stubFetch(loginResponse({ code: 1000, resData: { tfa: 'GOOGLE-AUTH' } }));

            await assert.rejects(new ApiClient().login('user', 'secret', sharedSecret), (reason) => {
                assert.equal(reason, TFA_ERROR);
                return true;
            });
            assert.equal(calls.length, 1);
        });
    }

    // The behaviour of 3.3.0 and earlier: only null is a missing secret.
    test('makes the unlock call for an empty secret and returns its response', async () => {
        const unlockData = { code: 2200, msg: 'Authentication error' };
        stubFetch(loginResponse({ code: 1000, resData: { tfa: 'GOOGLE-AUTH' } }), jsonResponse(unlockData));

        assert.deepEqual(await new ApiClient().login('user', 'secret', ''), unlockData);
        assert.equal(calls[1].body.method, 'account.unlock');
    });
});

describe('logout()', () => {
    // The behaviour of 3.3.0 and earlier: the result is null, not the API response.
    test('calls account.logout, clears the cookie and resolves to null', async () => {
        stubFetch(jsonResponse({ code: 1500, msg: 'Command completed successfully; ending session' }));
        const client = new ApiClient();
        client.setCookie('domrobot=abc');
        const result = await client.logout();

        assert.equal(result, null);
        assert.equal(calls[0].body.method, 'account.logout');
        assert.equal(calls[0].options.headers.get('cookie'), 'domrobot=abc');
        assert.equal(client.getCookie(), null);
    });

    test('keeps the cookie when fetch rejects', async () => {
        const networkError = new TypeError('fetch failed');
        stubFetch(networkError);
        const client = new ApiClient();
        client.setCookie('domrobot=abc');

        await assert.rejects(client.logout(), networkError);
        assert.equal(client.getCookie(), 'domrobot=abc');
    });
});
